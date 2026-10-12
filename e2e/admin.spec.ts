import { expect, test, type Page } from '@playwright/test'
import { ADMIN, ADMIN_STATE, browserContextFor, formReady, signUpShop } from './auth-helpers'
import { uniqueName } from './helpers'

// The platform admin panel: every shop, its subscription and payments.

test.use({ storageState: ADMIN_STATE })

async function openShop(page: Page, shopId: string) {
  await page.goto(`/admin/shops/${shopId}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

test('the admin lands on the panel and has no shop screens or data', async ({ page, request }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ADMIN.name.split(' ')[0])
  await expect(page.getByText('Total shops')).toBeVisible()
  for (const path of ['/dashboard', '/pos', '/inventory', '/customers']) {
    await page.goto(path)
    await expect(page, path).toHaveURL(/\/admin$/)
  }
  const products = await request.get('/api/products')
  expect(products.status()).toBe(403)
  expect((await products.json()).code).toBe('no_shop')
  expect((await request.get('/api/billing')).status()).toBe(403)
})

test('every admin page opens from the menu', async ({ page }) => {
  await page.goto('/admin')
  const nav = page.getByRole('navigation', { name: 'Admin' })
  for (const [label, heading] of [['Shops', 'Shops'], ['Subscriptions', 'Subscriptions'], ['Payments', 'Payments'], ['Account', 'Account'], ['Overview', /Good (morning|afternoon|evening)/]] as const) {
    await nav.getByRole('link', { name: label }).click()
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
  }
})

test('the shop list searches by name and owner email and filters by status', async ({ page }) => {
  const shop = await signUpShop(uniqueName('Searchable Mart'))
  await page.goto('/admin/shops')
  await page.getByLabel('Search shops').fill(shop.shopName)
  await page.getByLabel('Search shops').press('Enter')
  await expect(page.getByRole('row', { name: new RegExp(shop.shopName) })).toContainText(shop.email)
  await expect(page.getByRole('row')).toHaveCount(2)

  await page.getByLabel('Search shops').fill(shop.email)
  await page.getByLabel('Search shops').press('Enter')
  await expect(page.getByRole('row', { name: new RegExp(shop.shopName) })).toBeVisible()

  await page.getByRole('link', { name: 'active', exact: true }).click()
  await expect(page.getByText('No shops match.')).toBeVisible()
  await page.getByRole('link', { name: 'trialing', exact: true }).click()
  await expect(page.getByRole('row', { name: new RegExp(shop.shopName) })).toBeVisible()
  await page.getByRole('row', { name: new RegExp(shop.shopName) }).getByRole('link', { name: 'Manage' }).click()
  await expect(page.getByRole('heading', { level: 1, name: shop.shopName })).toBeVisible()
  await shop.context.dispose()
})

test('recording a payment activates the shop and shows on its Billing page', async ({ page, browser }) => {
  const shop = await signUpShop(uniqueName('Paying Store'))
  await openShop(page, shop.shopId)
  await expect(page.getByText('trialing', { exact: true })).toBeVisible()

  await page.getByLabel('Amount received (₨)').fill('3000')
  await page.getByLabel('Months').fill('2')
  await page.getByLabel('Method').selectOption('jazzcash')
  await page.getByLabel('Reference').fill('JC-778899')
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByRole('status')).toHaveText('Payment of ₨3,000 recorded. The shop is active.')
  await expect(page.getByText('active', { exact: true })).toBeVisible()
  await expect(page.getByText('JC-778899')).toBeVisible()
  await expect(page.getByText('Payment recorded')).toBeVisible()

  // Paid months are added on top of the trial that was left.
  const billing = (await (await shop.context.get('/api/billing')).json()).data
  expect(billing.shop.subscription.state).toBe('active')
  expect(billing.shop.subscription.days_left).toBeGreaterThanOrEqual(14 + 58)
  expect(billing.payments).toEqual([expect.objectContaining({ amount: 3000, method: 'jazzcash', reference: 'JC-778899', months: 2 })])

  await page.goto('/admin/payments')
  await expect(page.getByRole('row', { name: new RegExp(shop.shopName) })).toContainText('₨3,000')

  const owner = await browserContextFor(browser, shop.context)
  const ownerPage = await owner.newPage()
  await ownerPage.goto('/billing')
  await expect(ownerPage.getByRole('main').getByRole('heading', { name: 'Billing' })).toBeVisible()
  await expect(ownerPage.getByText(/^Paid until /)).toBeVisible()
  await expect(ownerPage.getByRole('row', { name: /JC-778899/ })).toContainText('₨ 3,000')
  await expect(ownerPage.getByRole('banner').getByRole('link', { name: 'Active plan' })).toBeVisible()
  await owner.close()
  await shop.context.dispose()
})

test('a suspended shop is read-only until it is resumed', async ({ page, browser }) => {
  // Visits several pages as two users; next dev compiles each on first visit.
  test.slow()
  const shop = await signUpShop(uniqueName('Paused Shop'))
  const product = (await (await shop.context.post('/api/products', { data: { name: uniqueName('Paused Item'), sale_price: 50, stock_quantity: 5 } })).json()).data

  await openShop(page, shop.shopId)
  await page.getByRole('button', { name: 'Suspend shop' }).click()
  await expect(page.getByRole('status')).toHaveText('Shop suspended. It is read-only until you resume it.')
  await expect(page.getByText('suspended', { exact: true })).toBeVisible()

  const blocked = await shop.context.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'cash' } })
  expect(blocked.status()).toBe(402)
  expect(await blocked.json()).toMatchObject({ code: 'subscription_inactive' })
  expect((await shop.context.post('/api/products', { data: { name: uniqueName('Blocked') } })).status()).toBe(402)
  // Reading still works, so the owner can see their data and renew.
  expect((await shop.context.get('/api/products')).ok()).toBe(true)
  expect((await shop.context.get('/api/billing')).ok()).toBe(true)

  const owner = await browserContextFor(browser, shop.context)
  const ownerPage = await owner.newPage()
  await ownerPage.goto('/dashboard')
  await expect(ownerPage.getByText('This shop is suspended. The shop is read-only until it is renewed.')).toBeVisible()
  await ownerPage.getByRole('link', { name: 'Renew in Billing' }).click()
  await expect(ownerPage).toHaveURL(/\/billing$/)
  await expect(ownerPage.getByText('Your shop is suspended')).toBeVisible()
  await ownerPage.goto('/pos')
  await ownerPage.getByRole('button', { name: new RegExp(`^${product.name}`) }).click()
  await ownerPage.getByRole('button', { name: /^Complete sale/ }).click()
  await expect(ownerPage.getByRole('main').getByRole('alert')).toContainText('read-only')

  await openShop(page, shop.shopId)
  await page.getByRole('button', { name: 'Resume shop' }).click()
  await expect(page.getByRole('status')).toHaveText('Shop resumed.')
  // Never paid, so it goes back to its trial.
  await expect(page.getByText('trialing', { exact: true })).toBeVisible()
  expect((await shop.context.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'cash' } })).status()).toBe(201)
  await owner.close()
  await shop.context.dispose()
})

test('ending a subscription blocks changes and adding days restores it', async ({ page }) => {
  const shop = await signUpShop(uniqueName('Lapsed Shop'))
  await openShop(page, shop.shopId)
  await page.getByRole('button', { name: 'End subscription now' }).click()
  await expect(page.getByRole('status')).toHaveText('Subscription ended. The shop is read-only until it pays.')
  await expect(page.getByText('expired', { exact: true })).toBeVisible()
  expect((await shop.context.post('/api/customers', { data: { name: 'Blocked' } })).status()).toBe(402)
  expect((await (await shop.context.get('/api/auth/me')).json()).data.user.shop.subscription).toMatchObject({ state: 'expired', can_write: false })

  await page.getByLabel('Free days to add').fill('7')
  await page.getByRole('button', { name: 'Add days' }).click()
  await expect(page.getByRole('status')).toHaveText('Days added.')
  expect((await (await shop.context.get('/api/auth/me')).json()).data.user.shop.subscription).toMatchObject({ state: 'trialing', days_left: 7, can_write: true })
  expect((await shop.context.post('/api/customers', { data: { name: 'Allowed again' } })).status()).toBe(201)
  await expect(page.getByRole('listitem').filter({ hasText: /^Days added — \+7 days/ })).toBeVisible()
  await shop.context.dispose()
})

test('the monthly price can be changed per shop', async ({ page }) => {
  const shop = await signUpShop(uniqueName('Discount Shop'))
  await openShop(page, shop.shopId)
  await page.getByLabel('Monthly price (₨)').fill('999')
  await page.getByRole('button', { name: 'Save price' }).click()
  await expect(page.getByRole('status')).toHaveText('Monthly price updated.')
  await expect(page.getByText('₨999 / month')).toBeVisible()
  expect((await (await shop.context.get('/api/billing')).json()).data.shop.subscription.price_pkr).toBe(999)
  // The payment form now suggests the new price.
  await expect(page.getByLabel('Amount received (₨)')).toHaveValue('999')
  await shop.context.dispose()
})

test('subscriptions can be filtered by status', async ({ page }) => {
  const shop = await signUpShop(uniqueName('Filter Shop'))
  await page.goto('/admin/subscriptions?state=trialing')
  await expect(page.getByRole('row', { name: new RegExp(shop.shopName) })).toContainText('trialing')
  await page.getByRole('link', { name: 'suspended', exact: true }).click()
  await expect(page).toHaveURL(/state=suspended$/)
  await expect(page.getByRole('row', { name: new RegExp(shop.shopName) })).toHaveCount(0)
  await shop.context.dispose()
})

test('an unknown shop id is a 404', async ({ page }) => {
  expect((await page.goto('/admin/shops/00000000-0000-0000-0000-000000000000'))?.status()).toBe(404)
  expect((await page.goto('/admin/shops/not-a-uuid'))?.status()).toBe(404)
})

test.describe('signing in and out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('the admin area is hidden from signed-out visitors; the admin signs in and out', async ({ page }) => {
    expect((await page.goto('/admin'))?.status()).toBe(404)
    await page.goto('/login')
    await formReady(page)
    await page.getByLabel('Email').fill(ADMIN.email)
    await page.getByLabel('Password').fill(ADMIN.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await page.getByRole('complementary').getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login\?signed_out=1$/)
    expect((await page.goto('/admin'))?.status()).toBe(404)
  })
})
