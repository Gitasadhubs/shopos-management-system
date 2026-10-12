import { expect, test, type Page } from '@playwright/test'
import { anonymousContext, browserContextFor, createStaff, emailCount, formReady, ownerContext, latestEmail, linkIn, OWNER, sessionCookieName, STAFF_PASSWORD, tokenIn, uniqueEmail } from './auth-helpers'
import { createProduct, uniqueName } from './helpers'

const alert = (page: Page) => page.getByRole('main').getByRole('alert')

async function signIn(page: Page, email: string, password: string) {
  await formReady(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const path of ['/dashboard', '/', '/inventory', '/pos', '/account', '/settings/users', '/sync-log', '/customers', '/suppliers', '/purchases', '/reports', '/settings', '/billing']) {
    test(`${path} sends you to sign in`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login(\?|$)/)
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    })
  }

  test('every data API refuses requests without a session', async ({ request }) => {
    for (const [method, path] of [['GET', '/api/products'], ['POST', '/api/products'], ['GET', '/api/sales'], ['POST', '/api/sales'], ['POST', '/api/stock-moves'], ['GET', '/api/dashboard'], ['GET', '/api/users'], ['GET', '/api/auth/me'], ['GET', '/api/local-products'], ['GET', '/api/customers'], ['POST', '/api/customers'], ['GET', '/api/suppliers'], ['GET', '/api/purchases'], ['POST', '/api/purchases'], ['GET', '/api/reports'], ['GET', '/api/settings'], ['GET', '/api/billing']]) {
      const response = await request.fetch(path, { method, data: method === 'POST' ? {} : undefined })
      expect(response.status(), `${method} ${path}`).toBe(401)
    }
  })

  test('the health check and offline page stay public', async ({ request, page }) => {
    expect((await request.get('/api/health')).ok()).toBe(true)
    await page.goto('/offline')
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible()
  })

  test('signs in and returns to the page you asked for', async ({ page }) => {
    await page.goto('/inventory')
    await expect(page).toHaveURL(/\/login\?next=%2Finventory$/)
    await signIn(page, OWNER.email, OWNER.password)
    await expect(page).toHaveURL(/\/inventory$/)
  })

  test('a wrong password and an unknown email get the same answer', async ({ page }) => {
    await page.goto('/login')
    await signIn(page, OWNER.email, 'not-the-password')
    await expect(alert(page)).toHaveText('Email or password is incorrect.')
    await signIn(page, uniqueEmail('nobody'), 'not-the-password')
    await expect(alert(page)).toHaveText('Email or password is incorrect.')
  })

  test('email addresses are not case-sensitive', async ({ page }) => {
    await page.goto('/login')
    await signIn(page, OWNER.email.toUpperCase(), OWNER.password)
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('next= cannot send you to another site', async ({ page }) => {
    await page.goto('/login?next=//evil.example/steal')
    await signIn(page, OWNER.email, OWNER.password)
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('repeated wrong passwords are rate limited', async ({ request }) => {
    const email = uniqueEmail('target')
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await request.post('/api/auth/login', { data: { email, password: 'wrong-password' } })).status()).toBe(401)
    }
    const blocked = await request.post('/api/auth/login', { data: { email, password: 'wrong-password' } })
    expect(blocked.status()).toBe(429)
    expect((await blocked.json()).error).toContain('Too many attempts')
  })

  test('setup is closed once the admin exists, and shops can sign up', async ({ page, request }) => {
    expect((await (await request.get('/api/auth/setup')).json()).data.needs_setup).toBe(false)
    const again = await request.post('/api/auth/setup', { data: { email: uniqueEmail('intruder'), full_name: 'Intruder', password: 'Intruder-pass-1' } })
    expect(again.status()).toBe(409)
    await page.goto('/setup')
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/signup')
    await expect(page.getByRole('heading', { name: 'Create your shop' })).toBeVisible()
    await page.getByRole('main').getByRole('link', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('link', { name: 'Create your shop' }).click()
    await expect(page).toHaveURL(/\/signup$/)
  })

  test('signup checks its fields and refuses an email that already has an account', async ({ page, request }) => {
    expect((await request.post('/api/auth/signup', { data: { shop_name: '', full_name: 'X', email: uniqueEmail('blank'), password: 'Long-enough-1' } })).status()).toBe(400)
    expect((await request.post('/api/auth/signup', { data: { shop_name: 'Shop', full_name: 'X', email: 'not-an-email', password: 'Long-enough-1' } })).status()).toBe(400)
    expect((await request.post('/api/auth/signup', { data: { shop_name: 'Shop', full_name: 'X', email: uniqueEmail('short'), password: 'short' } })).status()).toBe(400)
    const taken = await request.post('/api/auth/signup', { data: { shop_name: 'Copycat', full_name: 'Copy Cat', email: OWNER.email.toUpperCase(), password: 'Copycat-pass-1' } })
    expect(taken.status()).toBe(409)

    await page.goto('/signup')
    await formReady(page)
    await page.getByLabel('Shop name').fill('Copycat Store')
    await page.getByLabel('Your name').fill('Copy Cat')
    await page.getByLabel('Email').fill(OWNER.email)
    await page.getByLabel('Password', { exact: true }).fill('Copycat-pass-1')
    await page.getByLabel('Confirm password').fill('Copycat-pass-2')
    await page.getByRole('button', { name: 'Create my shop' }).click()
    await expect(alert(page)).toHaveText('The passwords do not match.')
    await page.getByLabel('Confirm password').fill('Copycat-pass-1')
    await page.getByRole('button', { name: 'Create my shop' }).click()
    await expect(alert(page)).toContainText('already has an account')
  })

  test('requests from another site are blocked', async ({ request }) => {
    const response = await request.post('/api/auth/login', { headers: { origin: 'https://evil.example' }, data: { email: OWNER.email, password: OWNER.password } })
    expect(response.status()).toBe(403)
  })

  test('the session cookie is HttpOnly, SameSite=Lax and Secure over HTTPS', async ({ request, baseURL }) => {
    const response = await request.post('/api/auth/login', { data: { email: OWNER.email, password: OWNER.password } })
    expect(response.ok()).toBe(true)
    const cookie = response.headersArray().find((header) => header.name.toLowerCase() === 'set-cookie')!.value
    expect(cookie).toContain(`${sessionCookieName()}=`)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(cookie).toMatch(/Path=\//)
    if (baseURL!.startsWith('https:')) expect(cookie).toMatch(/Secure/i)
  })
})

test.describe('password reset', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('reset by email, old password stops working, link works once', async ({ page }) => {
    const owner = await ownerContext()
    const staff = await createStaff(owner, 'cashier')
    await page.goto('/login')
    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
    await formReady(page)
    await page.getByLabel('Email').fill(staff.email)
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByRole('status')).toContainText(`If an account exists for ${staff.email}`)

    const link = linkIn((await latestEmail(staff.email, 'Reset')).text, '/reset-password')
    await page.goto(link)
    await formReady(page)
    await page.getByLabel('New password').fill('Brand-new-pass-1')
    await page.getByLabel('Confirm password').fill('Brand-new-pass-1')
    await page.getByRole('button', { name: 'Save new password' }).click()
    await expect(page).toHaveURL(/\/dashboard$/)

    const fresh = await anonymousContext()
    expect((await fresh.post('/api/auth/login', { data: { email: staff.email, password: STAFF_PASSWORD } })).status()).toBe(401)
    expect((await fresh.post('/api/auth/login', { data: { email: staff.email, password: 'Brand-new-pass-1' } })).ok()).toBe(true)
    // The reset signed out the session the staff member had before.
    expect((await staff.context.get('/api/auth/me')).status()).toBe(401)
    const reused = await fresh.post('/api/auth/reset-password', { data: { token: tokenIn(link), password: 'Another-pass-123' } })
    expect(reused.status()).toBe(400)
    await Promise.all([fresh.dispose(), owner.dispose()])
  })

  test('unknown emails get the same answer and no email', async ({ page }) => {
    const email = uniqueEmail('ghost')
    await page.goto('/forgot-password')
    await formReady(page)
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByRole('status')).toContainText(`If an account exists for ${email}`)
    expect(await emailCount(email)).toBe(0)
  })

  test('a reset page without a valid link says so', async ({ page }) => {
    await page.goto('/reset-password')
    await expect(alert(page)).toHaveText('This link is invalid or has expired.')
    await page.goto('/reset-password?token=not-a-real-token-1234567890')
    await formReady(page)
    await page.getByLabel('New password').fill('Whatever-pass-1')
    await page.getByLabel('Confirm password').fill('Whatever-pass-1')
    await page.getByRole('button', { name: 'Save new password' }).click()
    await expect(alert(page)).toContainText('invalid or has expired')
  })
})

test.describe('staff invitations', () => {
  test('owner invites a cashier from the Staff page and they join', async ({ page, browser, baseURL }) => {
    const email = uniqueEmail('newcashier')
    await page.goto('/settings/users')
    await expect(page.getByText('Loading staff…')).toHaveCount(0)
    await expect(page.getByRole('main').getByRole('heading', { name: 'Staff' })).toBeVisible()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Role', { exact: true }).selectOption('cashier')
    await page.getByRole('button', { name: 'Send invitation' }).click()
    await expect(page.getByRole('status')).toHaveText(`Invitation sent to ${email}.`)
    await expect(page.getByRole('button', { name: `Cancel invitation for ${email}` })).toBeVisible()

    const link = linkIn((await latestEmail(email, 'invited')).text, '/accept-invite')
    const guest = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, ignoreHTTPSErrors: true })
    const invitee = await guest.newPage()
    await invitee.goto(link)
    await formReady(invitee)
    await expect(invitee.getByText(`You are invited as a cashier with ${email}`)).toBeVisible()
    await invitee.getByLabel('Your name').fill('Nadia Cashier')
    await invitee.getByLabel('Password', { exact: true }).fill('Nadia-pass-2026')
    await invitee.getByLabel('Confirm password').fill('Nadia-pass-2026x')
    await invitee.getByRole('button', { name: 'Join shop' }).click()
    await expect(invitee.getByRole('main').getByRole('alert')).toHaveText('The passwords do not match.')
    await invitee.getByLabel('Confirm password').fill('Nadia-pass-2026')
    await invitee.getByRole('button', { name: 'Join shop' }).click()
    await expect(invitee).toHaveURL(/\/dashboard$/)
    await expect(invitee.getByRole('complementary').getByText('Nadia Cashier')).toBeVisible()
    await guest.close()

    await page.reload()
    await expect(page.getByRole('row', { name: /Nadia Cashier/ })).toContainText(email)
    await expect(page.getByText(`Cancel invitation for ${email}`)).toHaveCount(0)
  })

  test('an invitation link works once and a cancelled one stops working', async ({ request }) => {
    const email = uniqueEmail('cancelled')
    expect((await request.post('/api/users', { data: { email, role: 'manager' } })).status()).toBe(201)
    const token = tokenIn(linkIn((await latestEmail(email, 'invited')).text, '/accept-invite'))
    const guest = await anonymousContext()
    expect((await guest.get(`/api/auth/invite?token=${token}`)).ok()).toBe(true)

    const invite = ((await (await request.get('/api/users')).json()).data.invites as Array<{ id: string; email: string }>).find((item) => item.email === email)!
    expect((await request.delete(`/api/users/invites/${invite.id}`)).ok()).toBe(true)
    expect((await guest.get(`/api/auth/invite?token=${token}`)).status()).toBe(400)
    expect((await guest.post('/api/auth/invite', { data: { token, full_name: 'Too Late', password: STAFF_PASSWORD } })).status()).toBe(400)
    await guest.dispose()
  })

  test('cancel invitation button on the Staff page', async ({ page, request }) => {
    const email = uniqueEmail('cancelui')
    await request.post('/api/users', { data: { email, role: 'cashier' } })
    await page.goto('/settings/users')
    await expect(page.getByText('Loading staff…')).toHaveCount(0)
    await page.getByRole('button', { name: `Cancel invitation for ${email}` }).click()
    await expect(page.getByRole('status')).toHaveText(`Invitation for ${email} cancelled.`)
    await expect(page.getByRole('button', { name: `Cancel invitation for ${email}` })).toHaveCount(0)
  })

  test('cannot invite an email that already has an account', async ({ page }) => {
    await page.goto('/settings/users')
    await expect(page.getByText('Loading staff…')).toHaveCount(0)
    await page.getByLabel('Email').fill(OWNER.email)
    await page.getByRole('button', { name: 'Send invitation' }).click()
    await expect(alert(page)).toHaveText('Someone with this email already has an account.')
  })
})

test.describe('roles', () => {
  test('a cashier can sell but not manage inventory or staff', async ({ request, browser }) => {
    const cashier = await createStaff(request, 'cashier')
    const product = await createProduct(request, { name: uniqueName('Cashier Sale'), stock_quantity: 3 })

    expect((await cashier.context.get('/api/products')).ok()).toBe(true)
    expect((await cashier.context.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'cash' } })).status()).toBe(201)
    expect((await cashier.context.post('/api/products', { data: { name: uniqueName('Forbidden') } })).status()).toBe(403)
    expect((await cashier.context.post('/api/stock-moves', { data: { product_id: product.id, delta: 5, reason: 'Not allowed' } })).status()).toBe(403)
    expect((await cashier.context.delete(`/api/products?id=${product.id}`)).status()).toBe(403)
    expect((await cashier.context.get('/api/users')).status()).toBe(403)
    // Cashiers keep the khata at the counter, but suppliers, purchases, reports and billing are not theirs.
    expect((await cashier.context.post('/api/customers', { data: { name: uniqueName('Counter Customer') } })).status()).toBe(201)
    expect((await cashier.context.get('/api/customers')).ok()).toBe(true)
    for (const path of ['/api/suppliers', '/api/purchases', '/api/reports', '/api/billing', '/api/expenses', '/api/day-end']) expect((await cashier.context.get(path)).status(), path).toBe(403)
    expect((await cashier.context.put('/api/settings', { data: { name: 'Hijacked', timezone: 'Asia/Karachi' } })).status()).toBe(403)

    const context = await browserContextFor(browser, cashier.context)
    const page = await context.newPage()
    await page.goto('/dashboard')
    await expect(page.getByRole('navigation').getByRole('link')).toHaveText(['Dashboard', 'POS', 'Customers', 'Settings', 'Account'])
    await page.goto('/inventory')
    await expect(page).toHaveURL(/\/dashboard$/)
    await page.goto('/settings/users')
    await expect(page.getByText('Loading staff…')).toHaveCount(0)
    await expect(page).toHaveURL(/\/dashboard$/)
    for (const path of ['/reports', '/suppliers', '/purchases', '/billing', '/expenses', '/day-end']) {
      await page.goto(path)
      await expect(page, path).toHaveURL(/\/dashboard$/)
    }
    await page.goto('/pos')
    await expect(page.getByRole('heading', { name: 'Point of Sale' })).toBeVisible()
    await context.close()
  })

  test('a manager runs inventory but cannot manage staff', async ({ request, browser }) => {
    const manager = await createStaff(request, 'manager')
    expect((await manager.context.post('/api/products', { data: { name: uniqueName('Manager Product') } })).status()).toBe(201)
    expect((await manager.context.get('/api/users')).status()).toBe(403)
    expect((await manager.context.post('/api/users', { data: { email: uniqueEmail('sneaky'), role: 'manager' } })).status()).toBe(403)
    // Managers run the shop floor, reports included, but not the subscription or shop profile.
    expect((await manager.context.get('/api/reports')).ok()).toBe(true)
    expect((await manager.context.get('/api/billing')).status()).toBe(403)
    expect((await manager.context.put('/api/settings', { data: { name: 'Manager Rename', timezone: 'Asia/Karachi' } })).status()).toBe(403)

    const context = await browserContextFor(browser, manager.context)
    const page = await context.newPage()
    await page.goto('/dashboard')
    await expect(page.getByRole('navigation').getByRole('link')).toHaveText(['Dashboard', 'POS', 'Inventory', 'Customers', 'Suppliers', 'Purchases', 'Expenses', 'Reports', 'Day end', 'Settings', 'Account'])
    await page.goto('/settings/users')
    await expect(page.getByText('Loading staff…')).toHaveCount(0)
    await expect(page).toHaveURL(/\/dashboard$/)
    await context.close()
  })

  test('owner changes a role and it takes effect immediately', async ({ page, request }) => {
    const staff = await createStaff(request, 'cashier', `Promote ${Date.now().toString(36)}`)
    expect((await staff.context.post('/api/products', { data: { name: uniqueName('Before') } })).status()).toBe(403)
    await page.goto('/settings/users')
    await expect(page.getByText('Loading staff…')).toHaveCount(0)
    await page.getByLabel(`Role for ${staff.full_name}`).selectOption('manager')
    await expect(page.getByRole('status')).toHaveText(`${staff.full_name} is now a manager.`)
    expect((await staff.context.post('/api/products', { data: { name: uniqueName('After') } })).status()).toBe(201)
  })

  test('disabling an account signs it out everywhere and blocks sign-in until re-enabled', async ({ page, request }) => {
    const staff = await createStaff(request, 'cashier', `Disable ${Date.now().toString(36)}`)
    await page.goto('/settings/users')
    await expect(page.getByText('Loading staff…')).toHaveCount(0)
    await page.getByRole('button', { name: `Disable ${staff.full_name}` }).click()
    await expect(page.getByRole('status')).toHaveText(`${staff.full_name} can no longer sign in.`)
    await expect(page.getByRole('row', { name: new RegExp(staff.full_name) })).toContainText('Disabled')

    expect((await staff.context.get('/api/auth/me')).status()).toBe(401)
    const guest = await anonymousContext()
    const login = await guest.post('/api/auth/login', { data: { email: staff.email, password: staff.password } })
    expect(login.status()).toBe(403)
    expect((await login.json()).error).toContain('disabled')

    await page.getByRole('button', { name: `Enable ${staff.full_name}` }).click()
    await expect(page.getByRole('status')).toHaveText(`${staff.full_name} can sign in again.`)
    expect((await guest.post('/api/auth/login', { data: { email: staff.email, password: staff.password } })).ok()).toBe(true)
    await guest.dispose()
  })

  test('the owner cannot be changed or disabled', async ({ request }) => {
    const me = (await (await request.get('/api/auth/me')).json()).data.user
    expect((await request.patch(`/api/users/${me.id}`, { data: { is_active: false } })).status()).toBe(400)
    expect((await request.patch(`/api/users/${me.id}`, { data: { role: 'cashier' } })).status()).toBe(400)
  })
})

test.describe('account', () => {
  test('sign out ends the session', async ({ request, browser }) => {
    const staff = await createStaff(request, 'cashier')
    const context = await browserContextFor(browser, staff.context)
    const page = await context.newPage()
    await page.goto('/dashboard')
    await page.getByRole('complementary').getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login\?signed_out=1$/)
    await expect(page.getByRole('status')).toHaveText('You have been signed out.')
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login(\?|$)/)
    await context.close()
  })

  test('change password checks the current one and signs out other devices', async ({ request, browser }) => {
    const staff = await createStaff(request, 'manager')
    const other = await anonymousContext()
    expect((await other.post('/api/auth/login', { data: { email: staff.email, password: staff.password } })).ok()).toBe(true)

    const context = await browserContextFor(browser, staff.context)
    const page = await context.newPage()
    await page.goto('/account')
    await expect(page.getByText(staff.email)).toBeVisible()
    await page.getByLabel('Current password').fill('wrong-current-pass')
    await page.getByLabel('New password', { exact: true }).fill('Changed-pass-2026')
    await page.getByLabel('Confirm new password').fill('Changed-pass-2026')
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(alert(page)).toHaveText('Current password is incorrect.')

    await page.getByLabel('Current password').fill(staff.password)
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.getByRole('status')).toHaveText('Password changed. Other devices have been signed out.')

    expect((await other.get('/api/auth/me')).status()).toBe(401)
    expect((await staff.context.get('/api/auth/me')).ok()).toBe(true)
    const fresh = await anonymousContext()
    expect((await fresh.post('/api/auth/login', { data: { email: staff.email, password: 'Changed-pass-2026' } })).ok()).toBe(true)
    await Promise.all([other.dispose(), fresh.dispose(), context.close()])
  })
})
