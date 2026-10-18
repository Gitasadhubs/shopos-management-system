import { expect, test } from '@playwright/test'
import { ADMIN_STATE, browserContextFor, signUpShop } from './auth-helpers'
import { uniqueName } from './helpers'

// "Pay later" (lib/local-platform.ts payLater): the owner starts a card plan now and pays within 7 days
// (a trial keeps its remaining days). Any recorded payment settles it.

test.use({ storageState: ADMIN_STATE })
const DAY = 86_400_000

test('pay later starts the plan now, shows what is due, and a payment settles it', async ({ page, browser }) => {
  const shop = await signUpShop(uniqueName('Later Store'))
  const billing = async () => (await (await shop.context.get('/api/billing')).json()).data
  const before = await billing()
  expect(before.pay_later_days).toBe(7)
  expect(before.card.open).toBe(true)
  expect(before.shop.subscription.payment_due).toBeNull()

  const started = await shop.context.post('/api/billing/pay-later', { data: { plan: 'starter', interval: 'month' } })
  expect(started.status(), await started.text()).toBe(200)
  const due = (await started.json()).data.payment_due as string
  // On a 14-day trial the due date is the trial's end (never sooner than 7 days).
  expect(new Date(due).getTime()).toBeGreaterThanOrEqual(Date.now() + 7 * DAY - 60_000)
  expect(new Date(due).getTime()).toBe(new Date(before.shop.subscription.current_period_end).getTime())

  const after = (await billing()).shop.subscription
  expect(after).toMatchObject({ plan: 'starter', state: 'active', currency: 'USD', price: 9, interval: 'month', payment_due: due, can_write: true })

  // Once per payment: not again while it is owed, and not with a bad plan.
  const again = await shop.context.post('/api/billing/pay-later', { data: { plan: 'growth', interval: 'year' } })
  expect(again.status()).toBe(409)
  expect((await again.json()).code).toBe('payment_due')
  expect((await shop.context.post('/api/billing/pay-later', { data: { plan: 'basic', interval: 'month' } })).status()).toBe(400)

  const owner = await browserContextFor(browser, shop.context)
  const ownerPage = await owner.newPage()
  await ownerPage.goto('/billing')
  await expect(ownerPage.getByRole('main').getByRole('heading', { name: 'Billing' })).toBeVisible()
  await expect(ownerPage.getByRole('note').filter({ hasText: 'Payment due by' })).toContainText('Starter')
  await expect(ownerPage.getByRole('button', { name: /^Pay later/ })).toHaveCount(0)
  await ownerPage.goto('/dashboard')
  await expect(ownerPage.getByText('Payment for your plan is due by')).toBeVisible()

  // The admin records the payment: nothing is owed any more.
  await page.goto(`/admin/shops/${shop.shopId}`)
  await expect(page.getByRole('heading', { level: 1, name: shop.shopName })).toBeVisible()
  await expect(page.getByText('Pay later (payment due)')).toBeVisible()
  await page.getByLabel('Currency').selectOption('USD')
  await page.getByLabel('Amount received').fill('9')
  await page.getByLabel('Months').fill('1')
  await page.getByLabel('Method').selectOption('bank')
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByRole('status')).toContainText('recorded')
  expect((await billing()).shop.subscription.payment_due).toBeNull()
  await ownerPage.goto('/billing')
  await expect(ownerPage.getByRole('note').filter({ hasText: 'Payment due by' })).toHaveCount(0)
  await owner.close()
  await shop.context.dispose()
})
