import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { ER_DUP_ENTRY, getPool, isDbError, LocalDataError, withTransaction } from '@/lib/local-db'
import { createShopWithTrial, subscriptionFromRow, type ShopSubscription } from '@/lib/local-platform'
import { sendInviteEmail, sendPasswordResetEmail, sendVerificationEmail } from '@/lib/mailer'
import { dummyPasswordHash, hashPassword, verifyPassword } from '@/lib/password'
import type { Role } from '@/lib/permissions'
import { DEFAULT_TIMEZONE } from '@/lib/time'

// Email + password accounts for self-hosted mode.
//  - The first account (/setup) is the platform admin, who runs the service and belongs to no shop.
//  - Anyone can sign up a shop (/signup) and becomes its owner; the owner invites staff.

export type AccountRole = Role | 'admin'

export type LocalUser = {
  id: string
  shop_id: string | null
  email: string
  full_name: string
  role: AccountRole
  email_verified: boolean
  is_active: boolean
  last_login_at: string | null
  created_at: string
}

// The shop a signed-in user works in, with what its subscription allows.
export type SessionShop = { id: string; name: string; timezone: string; subscription: ShopSubscription }
export type SessionUser = LocalUser & { shop: SessionShop | null }

export type PendingInvite = { id: string; email: string; full_name: string | null; role: Role; created_at: string; expires_at: string }

const SESSION_MAX_DAYS = 30
const SESSION_IDLE_DAYS = 7
const TOKEN_HOURS = { verify: 24, reset: 1, invite: 24 * 7 } as const
const USER_COLUMNS = 'id, shop_id, email, full_name, role, email_verified_at, is_active, last_login_at, created_at'

const DAY = 24 * 60 * 60 * 1000
const addMs = (ms: number) => new Date(Date.now() + ms)
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

function userFromRow(row: RowDataPacket): LocalUser {
  return {
    id: row.id,
    shop_id: row.shop_id ?? null,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    email_verified: Boolean(row.email_verified_at),
    is_active: Boolean(row.is_active),
    last_login_at: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
  }
}

type Db = Awaited<ReturnType<typeof getPool>> | PoolConnection

async function findUserByEmail(db: Db, email: string) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`, [normalizeEmail(email)])
  return rows[0]
}

async function findUserById(db: Db, id: string) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [id])
  return rows[0] ? userFromRow(rows[0]) : null
}

// --- rate limiting -------------------------------------------------------------------------

async function attemptCount(db: Db, bucket: string, windowMinutes: number) {
  const [[row]] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM auth_attempts WHERE bucket = ? AND created_at > ?', [bucket, addMs(-windowMinutes * 60_000)])
  return Number(row.count)
}

async function recordAttempt(db: Db, bucket: string) {
  await db.query('INSERT INTO auth_attempts (bucket, created_at) VALUES (?, ?)', [bucket, new Date()])
  // Housekeeping without a scheduler: occasionally drop rows nothing reads any more.
  if (Math.random() < 0.02) {
    await db.query('DELETE FROM auth_attempts WHERE created_at < ?', [addMs(-DAY)])
    await db.query('DELETE FROM sessions WHERE expires_at < ?', [new Date()])
    await db.query('DELETE FROM email_tokens WHERE expires_at < ?', [addMs(-DAY)])
  }
}

async function enforceLimit(db: Db, bucket: string, limit: number, windowMinutes: number) {
  if ((await attemptCount(db, bucket, windowMinutes)) >= limit) {
    throw new LocalDataError(`Too many attempts. Wait ${windowMinutes} minutes and try again.`, 429, 'rate_limited')
  }
}

const emailBucket = (kind: string, email: string) => `${kind}:email:${sha256(normalizeEmail(email)).slice(0, 40)}`
const ipBucket = (kind: string, ip: string) => `${kind}:ip:${ip.slice(0, 60)}`

// --- sessions ------------------------------------------------------------------------------

async function createSession(db: Db, userId: string, client: ClientInfo) {
  const token = newToken()
  const now = new Date()
  await db.query(
    'INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [sha256(token), userId, now, now, addMs(SESSION_MAX_DAYS * DAY), client.userAgent?.slice(0, 255) ?? null, client.ip.slice(0, 64)],
  )
  return token
}

export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_DAYS * 24 * 60 * 60

export type ClientInfo = { ip: string; userAgent?: string | null }

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null
  const pool = await getPool()
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${USER_COLUMNS.split(', ').map((column) => `users.${column}`).join(', ')}, sessions.last_seen_at AS session_seen_at,
       shops.name AS shop_name, shops.timezone AS shop_timezone,
       subscriptions.plan AS sub_plan, subscriptions.status AS sub_status, subscriptions.price_pkr AS sub_price, subscriptions.current_period_end AS sub_period_end
     FROM sessions JOIN users ON users.id = sessions.user_id
     LEFT JOIN shops ON shops.id = users.shop_id
     LEFT JOIN subscriptions ON subscriptions.shop_id = users.shop_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND sessions.last_seen_at > ? AND users.is_active = 1`,
    [sha256(token), new Date(), addMs(-SESSION_IDLE_DAYS * DAY)],
  )
  const row = rows[0]
  if (!row) return null
  // Keep idle sessions alive without a write on every request.
  if (new Date(row.session_seen_at).getTime() < Date.now() - 5 * 60_000) {
    await pool.query('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', [new Date(), sha256(token)])
  }
  const shop = row.shop_id && row.sub_status
    ? { id: row.shop_id as string, name: row.shop_name as string, timezone: (row.shop_timezone as string) || DEFAULT_TIMEZONE, subscription: subscriptionFromRow(row) }
    : null
  return { ...userFromRow(row), shop }
}

export async function endSession(token: string | undefined) {
  if (token) await (await getPool()).query('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)])
}

// --- email delivery ------------------------------------------------------------------------

// When the person acting needs to know the email did not go out.
async function mailOrFail(sending: Promise<unknown>, message: string) {
  try {
    await sending
  } catch (error) {
    console.error('[mail] send failed:', error)
    throw new LocalDataError(message, 502, 'email_failed')
  }
}

// When an error would reveal whether an account exists (reset, resend); the failure is only logged.
async function mailOrLog(sending: Promise<unknown>) {
  try {
    await sending
  } catch (error) {
    console.error('[mail] send failed:', error)
  }
}

// --- email tokens --------------------------------------------------------------------------

type TokenPurpose = keyof typeof TOKEN_HOURS

async function issueToken(db: Db, purpose: TokenPurpose, fields: { email: string; shop_id?: string | null; user_id?: string | null; role?: Role | null; full_name?: string | null; created_by?: string | null }) {
  // A new link replaces any earlier unused one for the same purpose, email and shop.
  await db.query('UPDATE email_tokens SET used_at = ? WHERE purpose = ? AND email = ? AND shop_id <=> ? AND used_at IS NULL', [new Date(), purpose, fields.email, fields.shop_id ?? null])
  const token = newToken()
  await db.query(
    'INSERT INTO email_tokens (token_hash, purpose, shop_id, email, user_id, role, full_name, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [sha256(token), purpose, fields.shop_id ?? null, fields.email, fields.user_id ?? null, fields.role ?? null, fields.full_name ?? null, fields.created_by ?? null, new Date(), addMs(TOKEN_HOURS[purpose] * 60 * 60 * 1000)],
  )
  return token
}

async function claimToken(db: PoolConnection, purpose: TokenPurpose, token: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT token_hash, shop_id, email, user_id, role, full_name FROM email_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? FOR UPDATE',
    [sha256(token), purpose, new Date()],
  )
  if (!rows[0]) throw new LocalDataError('This link is invalid or has expired. Ask for a new one.', 400, 'invalid_token')
  await db.query('UPDATE email_tokens SET used_at = ? WHERE token_hash = ?', [new Date(), rows[0].token_hash])
  return rows[0]
}

// --- setup, signup, login, logout ----------------------------------------------------------

// Once an admin exists that never changes, so a positive answer is remembered.
const memo = globalThis as typeof globalThis & { shoposHasAdmin?: boolean }

export async function hasPlatformAdmin() {
  if (memo.shoposHasAdmin) return true
  const [rows] = await (await getPool()).query<RowDataPacket[]>("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1")
  memo.shoposHasAdmin = rows.length > 0
  return memo.shoposHasAdmin
}

// First run only: the person installing ShopOS becomes its platform admin.
export async function createPlatformAdmin(input: { email: string; full_name: string; password: string }) {
  const email = normalizeEmail(input.email)
  const passwordHash = await hashPassword(input.password)
  const { user, token } = await withTransaction(async (connection) => {
    // Two people opening a fresh install at once must not both become admin.
    const [[lock]] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK('shopos_setup', 10) AS acquired")
    if (!lock?.acquired) throw new LocalDataError('Setup is busy. Try again.', 503)
    try {
      const [existing] = await connection.query<RowDataPacket[]>("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1")
      if (existing.length) throw new LocalDataError('ShopOS is already set up. Sign in instead.', 409, 'setup_complete')
      if (await findUserByEmail(connection, email)) throw new LocalDataError('Someone with this email already has an account.', 409, 'email_taken')
      const id = randomUUID()
      const now = new Date()
      await connection.query(
        'INSERT INTO users (id, shop_id, email, full_name, password_hash, role, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)',
        [id, email, input.full_name.trim(), passwordHash, 'admin', now, now],
      )
      return { user: (await findUserById(connection, id))!, token: await issueToken(connection, 'verify', { email, user_id: id }) }
    } finally {
      await connection.query("SELECT RELEASE_LOCK('shopos_setup')")
    }
  })
  memo.shoposHasAdmin = true
  await mailOrFail(sendVerificationEmail(email, user.full_name, token), 'Your account was created, but the confirmation email could not be sent. Check the mail settings, then use "Send a new link" on the sign-in page.')
  return user
}

// Public signup: a new shop on a free trial, with the person signing up as its owner.
export async function signUpShop(input: { shop_name: string; phone?: string; full_name: string; email: string; password: string }, client: ClientInfo) {
  const pool = await getPool()
  const email = normalizeEmail(input.email)
  // New shops per IP per hour; tests raise it with SHOPOS_SIGNUP_LIMIT since they sign up many shops.
  await enforceLimit(pool, ipBucket('signup', client.ip), Number(process.env.SHOPOS_SIGNUP_LIMIT) || 10, 60)
  await recordAttempt(pool, ipBucket('signup', client.ip))
  const passwordHash = await hashPassword(input.password)
  try {
    const { user, token } = await withTransaction(async (connection) => {
      if (await findUserByEmail(connection, email)) throw new LocalDataError('Someone with this email already has an account. Sign in instead.', 409, 'email_taken')
      const shopId = await createShopWithTrial(connection, { name: input.shop_name, phone: input.phone })
      const id = randomUUID()
      const now = new Date()
      await connection.query(
        'INSERT INTO users (id, shop_id, email, full_name, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, shopId, email, input.full_name.trim(), passwordHash, 'owner', now, now],
      )
      return { user: (await findUserById(connection, id))!, token: await issueToken(connection, 'verify', { email, user_id: id }) }
    })
    await mailOrFail(sendVerificationEmail(email, user.full_name, token), 'Your shop was created, but the confirmation email could not be sent. Use "Send a new link" on the sign-in page.')
    return user
  } catch (error) {
    if (isDbError(error, ER_DUP_ENTRY)) throw new LocalDataError('Someone with this email already has an account. Sign in instead.', 409, 'email_taken')
    throw error
  }
}

export async function login(input: { email: string; password: string }, client: ClientInfo) {
  const pool = await getPool()
  const email = normalizeEmail(input.email)
  await enforceLimit(pool, emailBucket('login', email), 5, 15)
  await enforceLimit(pool, ipBucket('login', client.ip), 30, 15)

  const row = await findUserByEmail(pool, email)
  // Hash even when the email is unknown, so response time does not reveal which emails have accounts.
  const valid = await verifyPassword(input.password, row?.password_hash ?? (await dummyPasswordHash()))
  if (!row || !valid) {
    await recordAttempt(pool, emailBucket('login', email))
    await recordAttempt(pool, ipBucket('login', client.ip))
    throw new LocalDataError('Email or password is incorrect.', 401, 'invalid_credentials')
  }
  if (!row.is_active) throw new LocalDataError('This account has been disabled. Ask the shop owner.', 403, 'disabled')
  if (!row.email_verified_at) throw new LocalDataError('Confirm your email first. Check your inbox or send a new link.', 403, 'unverified')

  await pool.query('DELETE FROM auth_attempts WHERE bucket = ?', [emailBucket('login', email)])
  await pool.query('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date(), row.id])
  return { token: await createSession(pool, row.id, client), user: userFromRow(row) }
}

// --- email verification and password reset -------------------------------------------------

export async function resendVerification(emailInput: string, client: ClientInfo) {
  const pool = await getPool()
  const email = normalizeEmail(emailInput)
  await enforceLimit(pool, emailBucket('verify', email), 3, 15)
  await enforceLimit(pool, ipBucket('mail', client.ip), 20, 15)
  await recordAttempt(pool, emailBucket('verify', email))
  await recordAttempt(pool, ipBucket('mail', client.ip))
  const row = await findUserByEmail(pool, email)
  // Same response either way, so this cannot be used to discover accounts.
  if (!row || row.email_verified_at || !row.is_active) return
  await mailOrLog(sendVerificationEmail(email, row.full_name, await issueToken(pool, 'verify', { email, user_id: row.id })))
}

export async function verifyEmail(token: string) {
  return withTransaction(async (connection) => {
    const claimed = await claimToken(connection, 'verify', token)
    await connection.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?', [new Date(), new Date(), claimed.user_id])
    return (await findUserById(connection, claimed.user_id))!
  })
}

export async function requestPasswordReset(emailInput: string, client: ClientInfo) {
  const pool = await getPool()
  const email = normalizeEmail(emailInput)
  await enforceLimit(pool, emailBucket('reset', email), 3, 15)
  await enforceLimit(pool, ipBucket('mail', client.ip), 20, 15)
  await recordAttempt(pool, emailBucket('reset', email))
  await recordAttempt(pool, ipBucket('mail', client.ip))
  const row = await findUserByEmail(pool, email)
  if (!row || !row.is_active) return
  await mailOrLog(sendPasswordResetEmail(email, row.full_name, await issueToken(pool, 'reset', { email, user_id: row.id })))
}

export async function resetPassword(token: string, password: string, client: ClientInfo) {
  const passwordHash = await hashPassword(password)
  return withTransaction(async (connection) => {
    const claimed = await claimToken(connection, 'reset', token)
    const now = new Date()
    // The link proves the email address, so it also counts as verification.
    await connection.query('UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?', [passwordHash, now, now, claimed.user_id])
    await connection.query('DELETE FROM sessions WHERE user_id = ?', [claimed.user_id])
    const user = (await findUserById(connection, claimed.user_id))!
    if (!user.is_active) throw new LocalDataError('This account has been disabled. Ask the shop owner.', 403, 'disabled')
    return { user, token: await createSession(connection, user.id, client) }
  })
}

export async function changePassword(user: LocalUser, currentSessionToken: string, input: { current_password: string; new_password: string }) {
  const pool = await getPool()
  await enforceLimit(pool, `password:user:${user.id}`, 5, 15)
  const row = await findUserByEmail(pool, user.email)
  if (!row || !(await verifyPassword(input.current_password, row.password_hash))) {
    await recordAttempt(pool, `password:user:${user.id}`)
    throw new LocalDataError('Current password is incorrect.', 400, 'invalid_credentials')
  }
  await pool.query('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [await hashPassword(input.new_password), new Date(), user.id])
  // Sign out every other device.
  await pool.query('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [user.id, sha256(currentSessionToken)])
}

// --- staff management (shop owner only, within their own shop) ------------------------------

function ownerShop(actor: SessionUser) {
  if (actor.role !== 'owner' || !actor.shop) throw new LocalDataError('Only the shop owner can manage staff.', 403, 'forbidden')
  return actor.shop
}

export async function listStaff(actor: SessionUser) {
  const shop = ownerShop(actor)
  const pool = await getPool()
  const [users] = await pool.query<RowDataPacket[]>(`SELECT ${USER_COLUMNS} FROM users WHERE shop_id = ? ORDER BY role = 'owner' DESC, full_name`, [shop.id])
  const [invites] = await pool.query<RowDataPacket[]>(
    "SELECT token_hash, email, full_name, role, created_at, expires_at FROM email_tokens WHERE shop_id = ? AND purpose = 'invite' AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC",
    [shop.id, new Date()],
  )
  return {
    users: users.map(userFromRow),
    invites: invites.map((row): PendingInvite => ({ id: row.token_hash, email: row.email, full_name: row.full_name, role: row.role, created_at: new Date(row.created_at).toISOString(), expires_at: new Date(row.expires_at).toISOString() })),
  }
}

export async function inviteStaff(actor: SessionUser, input: { email: string; role: 'manager' | 'cashier'; full_name?: string }) {
  const shop = ownerShop(actor)
  const pool = await getPool()
  const email = normalizeEmail(input.email)
  await enforceLimit(pool, `invite:user:${actor.id}`, 30, 60)
  if (await findUserByEmail(pool, email)) throw new LocalDataError('Someone with this email already has an account.', 409, 'email_taken')
  await recordAttempt(pool, `invite:user:${actor.id}`)
  const token = await issueToken(pool, 'invite', { email, shop_id: shop.id, role: input.role, full_name: input.full_name?.trim() || null, created_by: actor.id })
  await mailOrFail(sendInviteEmail(email, actor.full_name, shop.name, input.role, token), 'The invitation was saved, but the email could not be sent. Check the mail settings and send the invitation again.')
}

export async function revokeInvite(actor: SessionUser, inviteId: string) {
  const shop = ownerShop(actor)
  const [result] = await (await getPool()).query<ResultSetHeader>(
    "UPDATE email_tokens SET used_at = ? WHERE token_hash = ? AND shop_id = ? AND purpose = 'invite' AND used_at IS NULL",
    [new Date(), inviteId, shop.id],
  )
  if (!result.affectedRows) throw new LocalDataError('Invitation not found.', 404)
}

export async function getInvite(token: string) {
  const [rows] = await (await getPool()).query<RowDataPacket[]>(
    "SELECT email_tokens.email, email_tokens.role, email_tokens.full_name, shops.name AS shop_name FROM email_tokens JOIN shops ON shops.id = email_tokens.shop_id WHERE email_tokens.token_hash = ? AND email_tokens.purpose = 'invite' AND email_tokens.used_at IS NULL AND email_tokens.expires_at > ?",
    [sha256(token), new Date()],
  )
  return rows[0] ? { email: rows[0].email as string, role: rows[0].role as Role, full_name: rows[0].full_name as string | null, shop_name: rows[0].shop_name as string } : null
}

export async function acceptInvite(token: string, input: { full_name: string; password: string }, client: ClientInfo) {
  const passwordHash = await hashPassword(input.password)
  try {
    return await withTransaction(async (connection) => {
      const invite = await claimToken(connection, 'invite', token)
      if (!invite.shop_id) throw new LocalDataError('This link is invalid or has expired. Ask for a new one.', 400, 'invalid_token')
      const id = randomUUID()
      const now = new Date()
      // The invite link was sent to this address, so the email is already verified.
      await connection.query(
        'INSERT INTO users (id, shop_id, email, full_name, password_hash, role, email_verified_at, last_login_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, invite.shop_id, invite.email, input.full_name.trim(), passwordHash, invite.role, now, now, now, now],
      )
      return { user: (await findUserById(connection, id))!, token: await createSession(connection, id, client) }
    })
  } catch (error) {
    if (isDbError(error, ER_DUP_ENTRY)) throw new LocalDataError('Someone with this email already has an account.', 409, 'email_taken')
    throw error
  }
}

export async function updateStaff(actor: SessionUser, userId: string, changes: { role?: 'manager' | 'cashier'; is_active?: boolean }) {
  const shop = ownerShop(actor)
  if (userId === actor.id) throw new LocalDataError('You cannot change your own role or disable your own account.', 400)
  return withTransaction(async (connection) => {
    const target = await findUserById(connection, userId)
    // Someone in another shop is reported as missing, not as forbidden.
    if (!target || target.shop_id !== shop.id) throw new LocalDataError('User not found.', 404)
    if (target.role === 'owner') throw new LocalDataError('The owner account cannot be changed here.', 400)
    const now = new Date()
    if (changes.role) await connection.query('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [changes.role, now, userId])
    if (changes.is_active !== undefined) {
      await connection.query('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?', [changes.is_active ? 1 : 0, now, userId])
      // Disabling takes effect immediately on every device.
      if (!changes.is_active) await connection.query('DELETE FROM sessions WHERE user_id = ?', [userId])
    }
    return (await findUserById(connection, userId))!
  })
}
