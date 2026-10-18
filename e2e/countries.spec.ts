import { expect, test } from '@playwright/test'
import { anonymousContext, latestEmail, linkIn, tokenIn, uniqueEmail } from './auth-helpers'
import { uniqueName } from './helpers'

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
