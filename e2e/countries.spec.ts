import { expect, test } from '@playwright/test'
import { anonymousContext, latestEmail, linkIn, tokenIn, uniqueEmail } from './auth-helpers'
import { createProduct, uniqueName } from './helpers'

// Each shop has a country (lib/countries): chosen at sign-up, changeable in Settings. It sets the
// defaults that follow from it, such as the time zone.

async function signUp(country?: string) {
  const email = uniqueEmail('country')
  const password = 'Country-owner-2026!'
  const context = await anonymousContext()
  const created = await context.post('/api/auth/signup', { data: { shop_name: uniqueName('World Shop'), full_name: 'World Owner', email, password, ...(country ? { country } : {}) } })
  expect(created.status(), await created.text()).toBe(201)
  expect((await context.post('/api/auth/verify-email', { data: { token: tokenIn(linkIn((await latestEmail(email, 'Confirm')).text, '/verify-email')) } })).ok()).toBe(true)
  expect((await context.post('/api/auth/login', { data: { email, password } })).ok()).toBe(true)
  return context
}

test('a shop gets its country at sign-up, with that country’s defaults, and can change it', async () => {
  const uk = await signUp('gb')
  const shop = (await (await uk.get('/api/settings')).json()).data
  expect(shop).toMatchObject({ country: 'GB', timezone: 'Europe/London' })
  expect((await (await uk.get('/api/auth/me')).json()).data.user.shop.country).toBe('GB')

  // Moving the shop: the country changes, the time zone stays what the owner set.
  const moved = await uk.put('/api/settings', { data: { country: 'AE' } })
  expect(moved.status(), await moved.text()).toBe(200)
  expect((await moved.json()).data).toMatchObject({ country: 'AE', timezone: 'Europe/London' })
  expect((await uk.put('/api/settings', { data: { country: 'XQ' } })).status()).toBe(400)
  await uk.dispose()

  // A country without its own entry is kept as given; with none at all (and no Cloudflare header) it is unknown.
  const brazil = await signUp('BR')
  expect((await (await brazil.get('/api/settings')).json()).data.country).toBe('BR')
  await brazil.dispose()
  const unknown = await signUp()
  expect((await (await unknown.get('/api/settings')).json()).data).toMatchObject({ country: 'ZZ', timezone: 'UTC' })
  await unknown.dispose()

  const refused = await (await anonymousContext()).post('/api/auth/signup', { data: { shop_name: 'Nowhere', full_name: 'No One', email: uniqueEmail('nowhere'), password: 'Nowhere-pass-2026', country: 'QQ' } })
  expect(refused.status()).toBe(400)
})

// Phase 2: the shop's currency and language (lib/format.ts, lib/i18n.ts) follow its country and can be
// changed in Settings; Arabic and Urdu turn the page right to left.
test('a shop sells in its own currency and language', async ({ browser }) => {
  const uk = await signUp('GB')
  expect((await (await uk.get('/api/settings')).json()).data).toMatchObject({ currency: 'GBP', language: 'en' })
  const india = await signUp('IN')
  expect((await (await india.get('/api/auth/me')).json()).data.user.shop).toMatchObject({ currency: 'INR', locale: 'en-IN', receipt: { prefix: 'INV-', padding: 6 } })
  await india.dispose()

  expect((await uk.put('/api/settings', { data: { currency: 'ABC' } })).status()).toBe(400)
  expect((await uk.put('/api/settings', { data: { language: 'de' } })).status()).toBe(400)
  await createProduct(uk, { name: uniqueName('Tea Box'), sale_price: 12.5, stock_quantity: 4 })

  const context = await browser.newContext({ storageState: await uk.storageState() })
  const page = await context.newPage()
  await page.goto('/pos')
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.getByText('£12.50').first()).toBeVisible()

  const changed = await uk.put('/api/settings', { data: { currency: 'AED', language: 'ar' } })
  expect((await changed.json()).data).toMatchObject({ currency: 'AED', language: 'ar' })
  await page.goto('/dashboard')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.getByRole('link', { name: 'المبيعات' })).toBeVisible()
  await page.goto('/pos')
  await expect(page.getByRole('heading', { name: 'نقطة البيع' })).toBeVisible()
  await expect(page.getByText(/AED|د\.إ/).first()).toBeVisible()
  await context.close()
  await uk.dispose()
})
