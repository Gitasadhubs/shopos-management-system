import { expect, test } from '@playwright/test'
import { createProduct, uniqueName } from './helpers'

type DashboardStats = { sales: number; profit: number; lowStock: number; salesCount: number }

async function stats(request: import('@playwright/test').APIRequestContext) {
  return (await (await request.get('/api/dashboard')).json()).data as DashboardStats
}

test('stat cards, recent sales and low stock reflect a new sale', async ({ page, request }) => {
  const before = await stats(request)
  const product = await createProduct(request, { name: uniqueName('Dash Coffee'), cost_price: 70, sale_price: 120, stock_quantity: 4, reorder_level: 2 })
  const sale = await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 3 }], discount: 10, payment_method: 'cash' } })
  expect(sale.status()).toBe(201)

  const after = await stats(request)
  expect(after.salesCount).toBe(before.salesCount + 1)
  expect(after.sales).toBeCloseTo(before.sales + 350)
  expect(after.profit).toBeCloseTo(before.profit + (120 - 70) * 3 - 10)
  expect(after.lowStock).toBe(before.lowStock + 1)

  await page.goto('/dashboard')
  const money = (value: number) => `Rs ${value.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`
  await expect(page.getByText('Sales today').locator('..')).toContainText(money(after.sales))
  await expect(page.getByText('Gross profit today').locator('..')).toContainText(money(after.profit))
  await expect(page.getByText('Transactions').locator('..')).toContainText(String(after.salesCount))
  await expect(page.getByText(`${after.salesCount} completed sale${after.salesCount === 1 ? '' : 's'}`)).toBeVisible()

  const row = page.getByRole('row', { name: new RegExp(`${product.name} × 3`) })
  await expect(row).toContainText('Rs 350')
  await expect(row).toContainText('cash')
  await expect(page.getByText(product.name, { exact: true }).locator('..')).toContainText('1 left')
})

test('Refresh reloads today\'s figures', async ({ page, request }) => {
  await page.goto('/dashboard')
  await expect(page.getByText('Loading…')).toHaveCount(0)

  const product = await createProduct(request, { name: uniqueName('Refresh Tea'), sale_price: 45 })
  await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'card' } })
  await expect(page.getByText(`${product.name} × 1`)).toHaveCount(0)

  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.getByRole('row', { name: new RegExp(`${product.name} × 1`) })).toContainText('card')
})

test('New sale and Open POS links open the POS', async ({ page }) => {
  await page.goto('/dashboard')
  await page.getByRole('link', { name: 'New sale' }).click()
  await expect(page).toHaveURL(/\/pos$/)

  await page.goto('/dashboard')
  await page.getByRole('link', { name: 'Open POS' }).click()
  await expect(page).toHaveURL(/\/pos$/)
})

test('shows an error with Retry when the dashboard cannot load', async ({ page }) => {
  let fail = true
  await page.route('**/api/dashboard', async (route) => {
    if (fail) return route.fulfill({ status: 500, json: { data: null, error: 'Unable to load dashboard statistics.' } })
    return route.continue()
  })
  await page.goto('/dashboard')
  const alert = page.getByRole('main').getByRole('alert')
  await expect(alert).toContainText('Unable to load dashboard statistics.')

  fail = false
  await alert.getByRole('button', { name: 'Retry' }).click()
  await expect(alert).toBeHidden()
  await expect(page.getByText('Loading…')).toHaveCount(0)
})
