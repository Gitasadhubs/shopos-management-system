import { expect, request as playwrightRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test'

// Accounts and the Mailpit test inbox for e2e tests.

// ADMIN runs the ShopOS service (/setup, /admin). OWNER signed up the shop most tests work in.
export const ADMIN = { email: 'admin@shopos.test', password: 'Admin-pass-2026!', name: 'Platform Admin' }
export const ADMIN_STATE = 'e2e/.auth/admin.json'
export const OWNER = { email: 'owner@shopos.test', password: 'Owner-pass-2026!', name: 'Test Owner', shop: 'Test Corner Store' }
export const OWNER_STATE = 'e2e/.auth/owner.json'
export const STAFF_PASSWORD = 'Staff-pass-2026!'

const baseURL = () => process.env.BASE_URL ?? 'http://localhost:3000'
const mailpit = () => process.env.MAILPIT_URL ?? 'http://localhost:8027'
const isHttps = () => baseURL().startsWith('https:')

export const sessionCookieName = () => (isHttps() ? '__Host-shopos_session' : 'shopos_session')

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@shopos.test`
}

// A request context with no cookies: someone who is not signed in.
export function anonymousContext() {
  return playwrightRequest.newContext({ baseURL: baseURL(), ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } })
}

type MailSummary = { ID: string; Subject: string }

// Waits for the newest email to an address (optionally with a subject) and returns its plain text.
export async function latestEmail(to: string, subject?: string, after = 0, timeout = 20_000) {
  const inbox = await playwrightRequest.newContext()
  try {
    let found: MailSummary | undefined
    await expect.poll(async () => {
      const response = await inbox.get(`${mailpit()}/api/v1/search`, { params: { query: `to:"${to}"` } })
      const messages = ((await response.json()).messages ?? []) as Array<MailSummary & { Created: string }>
      found = messages.find((message) => (!subject || message.Subject.includes(subject)) && new Date(message.Created).getTime() >= after)
      return Boolean(found)
    }, { message: `email to ${to}${subject ? ` about "${subject}"` : ''}`, timeout }).toBe(true)
    const message = await (await inbox.get(`${mailpit()}/api/v1/message/${found!.ID}`)).json()
    return { subject: message.Subject as string, text: message.Text as string }
  } finally {
    await inbox.dispose()
  }
}

export async function emailCount(to: string) {
  const inbox = await playwrightRequest.newContext()
  try {
    const response = await inbox.get(`${mailpit()}/api/v1/search`, { params: { query: `to:"${to}"` } })
    return ((await response.json()).messages ?? []).length as number
  } finally {
    await inbox.dispose()
  }
}

// The link in an email, rewritten to a path so it works from the test browser's base URL.
export function linkIn(text: string, path: string) {
  const match = text.match(new RegExp(`https?://[^\\s]+${path.replace('/', '\\/')}\\?token=[A-Za-z0-9_-]+`))
  expect(match, `link to ${path} in:\n${text}`).not.toBeNull()
  const url = new URL(match![0])
  expect(url.origin, 'email links must use SHOPOS_PUBLIC_URL').toBe(new URL(baseURL()).origin)
  return `${url.pathname}${url.search}`
}

export const tokenIn = (link: string) => new URL(link, 'http://x').searchParams.get('token')!

// Invites someone as the owner, accepts the invitation and returns their signed-in API context.
export async function createStaff(owner: APIRequestContext, role: 'manager' | 'cashier', name = `${role[0].toUpperCase()}${role.slice(1)} ${Date.now().toString(36)}`) {
  const email = uniqueEmail(role)
  const invited = await owner.post('/api/users', { data: { email, role } })
  expect(invited.status(), await invited.text()).toBe(201)
  const token = tokenIn(linkIn((await latestEmail(email, 'invited')).text, '/accept-invite'))
  const context = await anonymousContext()
  const accepted = await context.post('/api/auth/invite', { data: { token, full_name: name, password: STAFF_PASSWORD } })
  expect(accepted.status(), await accepted.text()).toBe(201)
  const user = (await accepted.json()).data.user as { id: string; email: string; full_name: string; role: string }
  return { ...user, password: STAFF_PASSWORD, context }
}

// A browser context signed in as the given API context's user.
export async function browserContextFor(browser: Browser, api: APIRequestContext) {
  return browser.newContext({ baseURL: baseURL(), ignoreHTTPSErrors: true, storageState: await api.storageState() })
}

// Auth forms keep their submit button disabled until React has loaded; typing before then is lost.
export async function formReady(page: Page) {
  await expect(page.locator('main form button[type="submit"], main button:has-text("Confirm email")').first()).toBeEnabled()
}

// The owner's API session, for tests that otherwise run signed out.
export function ownerContext() {
  return playwrightRequest.newContext({ baseURL: baseURL(), ignoreHTTPSErrors: true, storageState: OWNER_STATE })
}

export function adminContext() {
  return playwrightRequest.newContext({ baseURL: baseURL(), ignoreHTTPSErrors: true, storageState: ADMIN_STATE })
}

// Signs up a new shop through the API, confirms the email and returns the owner's signed-in context.
export async function signUpShop(shopName = `Shop ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`) {
  const email = uniqueEmail('owner')
  const password = 'Second-owner-2026!'
  const context = await anonymousContext()
  const created = await context.post('/api/auth/signup', { data: { shop_name: shopName, full_name: `Owner of ${shopName}`, email, password, country: 'PK' } })
  expect(created.status(), await created.text()).toBe(201)
  const token = tokenIn(linkIn((await latestEmail(email, 'Confirm')).text, '/verify-email'))
  expect((await context.post('/api/auth/verify-email', { data: { token } })).ok()).toBe(true)
  const login = await context.post('/api/auth/login', { data: { email, password } })
  expect(login.status(), await login.text()).toBe(200)
  const me = (await (await context.get('/api/auth/me')).json()).data.user as { id: string; shop: { id: string; name: string } }
  return { context, email, password, shopId: me.shop.id, shopName }
}
