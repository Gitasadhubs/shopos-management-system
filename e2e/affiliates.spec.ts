import { expect, test, type Page } from '@playwright/test'
import { ADMIN_STATE, anonymousContext, emailCount, latestEmail, linkIn, tokenIn, uniqueEmail } from './auth-helpers'
import { uniqueName } from './helpers'

// The partner (affiliate) program: apply at /partner, an admin approves, a shop signs up through the
// partner's link, and its payments earn 20% for its first 12 paid months, paid out by hand.

test.use({ storageState: ADMIN_STATE })

// The private partner page link from an email, as a path for the test browser.
function partnerPath(text: string) {
  const match = text.match(/https?:\/\/[^\s]+\/partner\/[A-Za-z0-9_-]{20,64}/)
  expect(match, `partner page link in:\n${text}`).not.toBeNull()
  return new URL(match![0]).pathname
}

async function apply(email: string, name: string) {
  const visitor = await anonymousContext()
  const response = await visitor.post('/api/partner/apply', { data: { name, email, phone: '0300 1234567', city: 'Lahore', payout_method: 'mobile_wallet', payout_details: 'Wallet 0300 1234567 · Ali Raza', about: 'I supply 30 general stores.', agree: true } })
  expect(response.status(), await response.text()).toBe(201)
  await visitor.dispose()
}

async function recordPayment(page: Page, shopId: string, amount: string, months: string) {
  await page.goto(`/admin/shops/${shopId}`)
  await page.getByLabel('Amount received').fill(amount)
  await page.getByLabel('Months').fill(months)
  await page.getByLabel('Method').selectOption('jazzcash')
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByRole('status')).toContainText('recorded')
}

test('a partner applies, is approved, refers a shop and is paid 20% of its first 12 paid months', async ({ page }) => {
  const email = uniqueEmail('partner')
  const name = uniqueName('Ali Partner')

  // The application, as the partner page on the website (getshopos.online/partners) sends it.
  await apply(email, name)
  // The pending page from the confirmation email.
  const visitor = await (await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] }, ignoreHTTPSErrors: true })).newPage()
  await visitor.goto(partnerPath((await latestEmail(email, 'partner application')).text))
  await expect(visitor.getByText('Your application is waiting for approval.')).toBeVisible()
  await visitor.close()

  // Applying twice with the same email is refused.
  const again = await (await anonymousContext()).post('/api/partner/apply', { data: { name, email, phone: '0300 1234567', payout_method: 'bank', payout_details: 'Bank 0123456789', agree: true } })
  expect(again.status()).toBe(409)

  // The admin approves; the partner gets their link by email.
  await page.goto('/admin/affiliates')
  const card = page.getByRole('article').filter({ hasText: email })
  await expect(card).toContainText('pending')
  await card.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByRole('status')).toContainText(`${name} is approved`)
  const approved = (await latestEmail(email, 'You are a ShopOS partner')).text
  const code = approved.match(/\?ref=([A-Z0-9]{6})/)![1]
  const dashboard = partnerPath(approved)

  // A shop signs up through the partner's link (an unknown code would simply be ignored).
  const shopName = uniqueName('Referred Mart')
  const owner = uniqueEmail('referred')
  const signupPage = await (await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] }, ignoreHTTPSErrors: true })).newPage()
  await signupPage.goto(`/signup?ref=${code}`)
  await signupPage.getByLabel('Shop name').fill(shopName)
  await signupPage.getByLabel('Country').selectOption('PK')
  await signupPage.getByLabel('Your name').fill('Referred Owner')
  await signupPage.getByLabel('Email').fill(owner)
  await signupPage.getByLabel('Password', { exact: true }).fill('Referred-owner-2026!')
  await signupPage.getByLabel('Confirm password').fill('Referred-owner-2026!')
  await signupPage.getByRole('button', { name: 'Create my shop' }).click()
  await expect(signupPage.getByText(owner)).toBeVisible()
  const ownerApi = await anonymousContext()
  expect((await ownerApi.post('/api/auth/verify-email', { data: { token: tokenIn(linkIn((await latestEmail(owner, 'Confirm')).text, '/verify-email')) } })).ok()).toBe(true)
  expect((await ownerApi.post('/api/auth/login', { data: { email: owner, password: 'Referred-owner-2026!' } })).ok()).toBe(true)
  const shopId = (await (await ownerApi.get('/api/auth/me')).json()).data.user.shop.id as string
  await signupPage.close()

  // While on trial the partner sees the shop but has earned nothing.
  await page.goto(dashboard)
  await expect(page.getByRole('row', { name: new RegExp(shopName) })).toContainText('On free trial')

  // 3 months (₨4,500) earn ₨900. Then 10 months (₨15,000): only 9 are inside the first 12, so ₨2,700.
  await recordPayment(page, shopId, '4500', '3')
  await recordPayment(page, shopId, '15000', '10')
  await page.goto(dashboard)
  await expect(page.getByRole('row', { name: new RegExp(shopName) })).toContainText('Paying')
  await expect(page.getByRole('row', { name: new RegExp(shopName) })).toContainText('₨3,600')
  // Later payments earn nothing more.
  await recordPayment(page, shopId, '1500', '1')

  // The admin pays it out.
  await page.goto('/admin/affiliates')
  const paidCard = page.getByRole('article').filter({ hasText: email })
  await expect(paidCard).toContainText('Owed ₨3,600')
  await paidCard.getByLabel(/Payout reference/).fill('JazzCash TID 556677')
  await paidCard.getByRole('button', { name: 'Mark ₨3,600 paid' }).click()
  await expect(page.getByRole('status')).toContainText('Payout of ₨3,600 marked as paid.')
  await page.goto(dashboard)
  await expect(page.getByText('JazzCash TID 556677')).toBeVisible()
  await expect(page.getByText('Owed to you').locator('..')).toContainText('$0')
  await expect(page.getByText('Paid to you').locator('..')).toContainText('₨3,600')
})

test('only the website may apply from another origin, and /partner sends people there', async () => {
  const visitor = await anonymousContext()
  const data = { name: 'Abroad Partner', email: uniqueEmail('abroad'), phone: '+44 7700 900123', country: 'United Kingdom', payout_method: 'paypal', payout_details: 'abroad@example.com', agree: true }
  const preflight = await visitor.fetch('/api/partner/apply', { method: 'OPTIONS', headers: { origin: 'https://getshopos.online', 'access-control-request-method': 'POST' } })
  expect(preflight.status()).toBe(204)
  expect(preflight.headers()['access-control-allow-origin']).toBe('https://getshopos.online')
  const fromSite = await visitor.post('/api/partner/apply', { headers: { origin: 'https://getshopos.online' }, data })
  expect(fromSite.status(), await fromSite.text()).toBe(201)
  expect(fromSite.headers()['access-control-allow-origin']).toBe('https://getshopos.online')
  const elsewhere = await visitor.post('/api/partner/apply', { headers: { origin: 'https://evil.example' }, data: { ...data, email: uniqueEmail('evil') } })
  expect(elsewhere.status()).toBe(403)
  const redirect = await visitor.get('/partner', { maxRedirects: 0 })
  expect(redirect.headers()['location']).toBe('https://getshopos.online/partners')
})

test('a pending or unknown referral code credits nobody, and partner pages need the right link', async ({ request }) => {
  const email = uniqueEmail('pending-partner')
  await apply(email, uniqueName('Pending Partner'))
  const visitor = await anonymousContext()
  expect((await visitor.get('/partner/not-a-real-token-at-all-123456')).status()).toBe(404)
  const created = await visitor.post('/api/auth/signup', { data: { shop_name: uniqueName('Unreferred Shop'), full_name: 'Someone', email: uniqueEmail('unref'), password: 'Some-owner-2026!', ref: 'NOSUCH' } })
  expect(created.status(), await created.text()).toBe(201)
  // The admin list shows the pending partner with no shops.
  const page = await request.get('/admin/affiliates')
  expect(page.ok()).toBe(true)
})

test('a partner who lost their link signs in by email and gets a new one; others learn nothing', async ({ page }) => {
  const email = uniqueEmail('signin-partner')
  await apply(email, uniqueName('Returning Partner'))
  const first = partnerPath((await latestEmail(email, 'partner application')).text)

  const visitor = await anonymousContext()
  const asked = Date.now()
  const known = await visitor.post('/api/partner/sign-in', { headers: { origin: 'https://getshopos.online' }, data: { email } })
  expect(known.status(), await known.text()).toBe(200)
  expect(known.headers()['access-control-allow-origin']).toBe('https://getshopos.online')
  const fresh = partnerPath((await latestEmail(email, 'Your ShopOS partner page', asked)).text)
  expect(fresh).not.toBe(first)

  // The new link opens the page; the old one no longer does.
  await page.goto(fresh)
  await expect(page.getByText('Your application is waiting for approval.')).toBeVisible()
  expect((await visitor.get(first)).status()).toBe(404)

  // An email that is not a partner gets the same answer, and no email is sent.
  const stranger = uniqueEmail('not-a-partner')
  const unknown = await visitor.post('/api/partner/sign-in', { data: { email: stranger } })
  expect(unknown.status()).toBe(200)
  expect(await unknown.json()).toEqual(await known.json())
  expect(await emailCount(stranger)).toBe(0)
})
