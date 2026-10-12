import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { signUpShop } from './auth-helpers'
import { uniqueName } from './helpers'

// Reports run in a fresh shop so the figures are exact.

test('figures, top products, payment mix and khata aging match the recorded sales', async () => {
  const shop = await signUpShop(uniqueName('Report Shop'))
  const api = shop.context
  const make = async (name: string, cost: number, price: number) => (await (await api.post('/api/products', { data: { name, cost_price: cost, sale_price: price, stock_quantity: 50 } })).json()).data
  const tea = await make('Report Tea', 60, 100)
  const cake = await make('Report Cake', 150, 250)
  const customer = (await (await api.post('/api/customers', { data: { name: 'Report Khata' } })).json()).data

  await api.post('/api/sales', { data: { items: [{ product_id: tea.id, quantity: 3 }], payment_method: 'cash' } })
  await api.post('/api/sales', { data: { items: [{ product_id: cake.id, quantity: 2 }], discount: 20, payment_method: 'card' } })
  await api.post('/api/sales', { data: { customer_id: customer.id, items: [{ product_id: tea.id, quantity: 1 }, { product_id: cake.id, quantity: 1 }], payment_method: 'credit', amount_paid: 50 } })
  await api.post('/api/purchases', { data: { items: [{ product_id: tea.id, quantity: 10, unit_cost: 60 }] } })

  const report = (await (await api.get('/api/reports')).json()).data
  // Revenue 300 + 480 + 350 = 1130; cost 180 + 300 + 210 = 690.
  expect(report.totals).toMatchObject({ revenue: 1130, cogs: 690, profit: 440, count: 3, discounts: 20, creditGiven: 300, purchases: 600, purchaseCount: 1 })
  expect(report.totals.margin).toBeCloseTo(38.9, 1)
  expect(report.topProducts.map((product: { name: string; quantity: number; revenue: number }) => [product.name, product.quantity, product.revenue])).toEqual([['Report Cake', 3, 750], ['Report Tea', 4, 400]])
  expect(report.methods.map((method: { method: string; total: number }) => [method.method, method.total])).toEqual([['card', 480], ['credit', 350], ['cash', 300]])
  expect(report.credit).toMatchObject({ total: 300, customers: 1, top: [expect.objectContaining({ name: 'Report Khata', balance: 300 })] })
  expect(report.credit.buckets[0]).toMatchObject({ label: '0–30 days', total: 300, share: 100 })
  expect(report.daily).toHaveLength(30)
  expect(report.daily.at(-1)).toMatchObject({ revenue: 1130, profit: 440, count: 3 })

  // Ranges are checked.
  expect((await api.get('/api/reports?from=2026-02-10&to=2026-02-01')).status()).toBe(400)
  expect((await api.get('/api/reports?from=2020-01-01&to=2026-01-01')).status()).toBe(400)
  expect((await api.get('/api/reports?from=yesterday')).status()).toBe(400)
  const empty = (await (await api.get('/api/reports?from=2020-01-01&to=2020-01-31')).json()).data
  expect(empty.totals.count).toBe(0)
  await api.dispose()
})

test('the reports page shows the period, switches presets and exports CSV', async ({ page, request }) => {
  test.slow()
  const product = (await (await request.post('/api/products', { data: { name: uniqueName('Report Page Item'), cost_price: 10, sale_price: 900000, stock_quantity: 20 } })).json()).data
  await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 2 }], payment_method: 'cash' } })

  await page.goto('/reports')
  await expect(page.getByRole('main').getByRole('heading', { name: 'Reports' })).toBeVisible()
  await expect(page.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Revenue', { exact: true }).first().locator('..')).not.toContainText('Loading…')
  await expect(page.getByText('Sales and profit by day')).toBeVisible()

  await page.getByRole('button', { name: 'Today' }).click()
  await expect(page.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(product.name)).toBeVisible()

  await page.getByRole('button', { name: 'Custom' }).click()
  await expect(page.getByLabel('From', { exact: true })).toBeVisible()
  await page.getByLabel('From', { exact: true }).fill('2020-01-01')
  await page.getByLabel('To', { exact: true }).fill('2020-01-31')
  await expect(page.getByText('No sales in this period')).toBeVisible()
  await expect(page.getByText('2020-01-01 → 2020-01-31')).toBeVisible()

  await page.getByRole('button', { name: 'Today' }).click()
  await expect(page.getByText(product.name)).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^shopos-report-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = await readFile((await file.path())!, 'utf8')
  expect(csv).toContain('Top products,Quantity,Revenue,Profit')
  expect(csv).toContain(product.name)
})
