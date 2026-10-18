import { expect, test, type APIRequestContext } from '@playwright/test'
import { browserContextFor, createStaff } from './auth-helpers'
import { createProduct, getProduct, uniqueName } from './helpers'

// Sales history, invoice numbers and returns (refunds).

type Sale = { id: string; number: number; total: number; refunded: number; customer_name: string | null; items: Array<{ product_id: string; product_name: string; quantity: number; returned_quantity: number }> }
type SaleDetail = Sale & { returns: Array<{ amount: number; khata_amount: number; refund_method: string; reason: string | null; items: Array<{ product_name: string; quantity: number }> }> }

async function sell(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.post('/api/sales', { data })
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json()).data as Sale
}

async function returnItems(request: APIRequestContext, sale: Sale, items: Array<{ product_id: string; quantity: number }>, extra: Record<string, unknown> = {}) {
  return request.post(`/api/sales/${sale.id}/returns`, { data: { items, ...extra } })
}

async function returned(request: APIRequestContext, sale: Sale, items: Array<{ product_id: string; quantity: number }>, extra: Record<string, unknown> = {}) {
  const response = await returnItems(request, sale, items, extra)
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json()).data as SaleDetail
}

async function today(request: APIRequestContext) {
  return ((await (await request.get('/api/day-end')).json()).data.today) as string
}

async function revenueOn(request: APIRequestContext, day: string) {
  return ((await (await request.get(`/api/reports?from=${day}&to=${day}`)).json()).data.totals) as { revenue: number; returns: number; profit: number }
}

test.describe('sales API', () => {
  test('sales get invoice numbers 1, 2, 3… and can be found by number', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Numbered'), sale_price: 10 })
    const first = await sell(request, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'cash' })
    const second = await sell(request, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'cash' })
    expect(first.number).toBeGreaterThan(0)
    expect(second.number).toBe(first.number + 1)

    for (const search of [String(second.number), `#${second.number}`]) {
      const found = (await (await request.get(`/api/sales?search=${encodeURIComponent(search)}`)).json()).data as Sale[]
      // Other sales whose customer or product name contains the digits may match too.
      expect(found.map((sale) => sale.id), search).toContain(second.id)
      expect(found.map((sale) => sale.id), search).not.toContain(first.id)
    }
    const byProduct = (await (await request.get(`/api/sales?search=${encodeURIComponent(product.name)}&limit=5`)).json()).data as Sale[]
    expect(byProduct.map((sale) => sale.number).sort((a, b) => a - b)).toEqual([first.number, second.number])
    expect((await request.get('/api/sales?from=2026-13-40')).status()).toBe(400)
    expect((await request.get('/api/sales?limit=500')).status()).toBe(400)
  })

  test('a return refunds the items’ share of the discounted total and puts them back in stock', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Return Soap'), sale_price: 100, cost_price: 60, stock_quantity: 10 })
    const sale = await sell(request, { items: [{ product_id: product.id, quantity: 3 }], discount: 30, payment_method: 'cash' })
    expect(sale.total).toBe(270)
    expect((await getProduct(request, product.name))?.stock_quantity).toBe(7)

    const once = await returned(request, sale, [{ product_id: product.id, quantity: 1 }], { reason: 'Damaged' })
    expect(once.refunded).toBe(90)
    expect(once.returns).toHaveLength(1)
    expect(once.returns[0]).toMatchObject({ amount: 90, khata_amount: 0, refund_method: 'cash', reason: 'Damaged' })
    expect(once.items[0].returned_quantity).toBe(1)
    expect((await getProduct(request, product.name))?.stock_quantity).toBe(8)

    // Cannot return more than is left.
    const tooMany = await returnItems(request, sale, [{ product_id: product.id, quantity: 3 }])
    expect(tooMany.status()).toBe(409)
    expect((await tooMany.json()).error).toBe(`Only 2 of ${product.name} can still be returned.`)

    // The last return settles the sale exactly.
    const rest = await returned(request, sale, [{ product_id: product.id, quantity: 2 }])
    expect(rest.refunded).toBe(270)
    expect(rest.returns.map((item) => item.amount)).toEqual([90, 180])
    expect((await getProduct(request, product.name))?.stock_quantity).toBe(10)
    expect((await returnItems(request, sale, [{ product_id: product.id, quantity: 1 }])).status()).toBe(409)
  })

  test('a credit sale’s return comes off the khata first, then cash once it is paid', async ({ request }) => {
    const customer = (await (await request.post('/api/customers', { data: { name: uniqueName('Return Khata') } })).json()).data as { id: string; name: string }
    const product = await createProduct(request, { name: uniqueName('Return Rice'), sale_price: 250, stock_quantity: 10 })
    const balance = async () => (await (await request.get(`/api/customers/${customer.id}`)).json()).data as { party: { balance: number }; entries: Array<{ kind: string; amount: number; note: string }> }
    const sale = await sell(request, { customer_id: customer.id, items: [{ product_id: product.id, quantity: 4 }], payment_method: 'credit', amount_paid: 200 })
    expect(sale.total).toBe(1000)
    expect((await balance()).party.balance).toBe(800)

    const first = await returned(request, sale, [{ product_id: product.id, quantity: 2 }])
    expect(first.returns[0]).toMatchObject({ amount: 500, khata_amount: 500 })
    const ledger = await balance()
    expect(ledger.party.balance).toBe(300)
    expect(ledger.entries[0]).toMatchObject({ kind: 'return', amount: -500, note: `Return on sale #${sale.number}` })

    // Once the customer has paid off the khata, the rest comes back in cash.
    expect((await request.post(`/api/customers/${customer.id}/payment`, { data: { amount: 300 } })).status()).toBe(201)
    const second = await returned(request, sale, [{ product_id: product.id, quantity: 2 }])
    expect(second.returns[1]).toMatchObject({ amount: 500, khata_amount: 0, refund_method: 'cash' })
    expect((await balance()).party.balance).toBe(0)
  })

  test('a card sale is refunded to the card', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Return Card'), sale_price: 80 })
    const sale = await sell(request, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'card' })
    const result = await returned(request, sale, [{ product_id: product.id, quantity: 1 }])
    expect(result.returns[0]).toMatchObject({ amount: 80, refund_method: 'card' })
  })

  test('a retried return with the same client_id is recorded once', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Return Retry'), sale_price: 50, stock_quantity: 5 })
    const sale = await sell(request, { items: [{ product_id: product.id, quantity: 2 }], payment_method: 'cash' })
    const client_id = uniqueName('return')
    await returned(request, sale, [{ product_id: product.id, quantity: 1 }], { client_id })
    const again = await returned(request, sale, [{ product_id: product.id, quantity: 1 }], { client_id })
    expect(again.returns).toHaveLength(1)
    expect((await getProduct(request, product.name))?.stock_quantity).toBe(4)
  })

  test('two returns at once cannot take back more than was sold', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Return Race'), sale_price: 40, stock_quantity: 5 })
    const sale = await sell(request, { items: [{ product_id: product.id, quantity: 3 }], payment_method: 'cash' })
    const results = await Promise.all([1, 2].map(() => returnItems(request, sale, [{ product_id: product.id, quantity: 2 }])))
    expect(results.map((response) => response.status()).sort()).toEqual([201, 409])
    expect((await getProduct(request, product.name))?.stock_quantity).toBe(4)
    expect(((await (await request.get(`/api/sales/${sale.id}`)).json()).data as SaleDetail).refunded).toBe(80)
  })

  test('rejects returns of unknown sales and products not in the sale', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Return Bad'), sale_price: 10 })
    const other = await createProduct(request, { name: uniqueName('Return Other'), sale_price: 10 })
    const sale = await sell(request, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'cash' })
    expect((await request.post('/api/sales/00000000-0000-4000-8000-000000000000/returns', { data: { items: [{ product_id: product.id, quantity: 1 }] } })).status()).toBe(404)
    expect((await request.get('/api/sales/not-a-uuid')).status()).toBe(404)
    expect((await returnItems(request, sale, [{ product_id: other.id, quantity: 1 }])).status()).toBe(400)
    expect((await returnItems(request, sale, [])).status()).toBe(400)
    expect((await returnItems(request, sale, [{ product_id: product.id, quantity: 0 }])).status()).toBe(400)
  })

  test('returns lower the day’s revenue and profit in reports and the day-end report', async ({ request }) => {
    const day = await today(request)
    const product = await createProduct(request, { name: uniqueName('Return Report'), sale_price: 200, cost_price: 120 })
    const sale = await sell(request, { items: [{ product_id: product.id, quantity: 2 }], payment_method: 'cash' })
    const before = await revenueOn(request, day)
    const dayEndBefore = (await (await request.get(`/api/day-end?day=${day}`)).json()).data.report
    await returned(request, sale, [{ product_id: product.id, quantity: 1 }])

    const after = await revenueOn(request, day)
    expect(after.revenue).toBeCloseTo(before.revenue - 200, 2)
    expect(after.returns).toBeCloseTo(before.returns + 200, 2)
    expect(after.profit).toBeCloseTo(before.profit - 80, 2)
    const dayEnd = (await (await request.get(`/api/day-end?day=${day}`)).json()).data.report
    expect(dayEnd.sales.revenue).toBeCloseTo(dayEndBefore.sales.revenue - 200, 2)
    expect(dayEnd.returns.total).toBeCloseTo(dayEndBefore.returns.total + 200, 2)
    expect(dayEnd.cash.expected).toBeCloseTo(dayEndBefore.cash.expected - 200, 2)
  })
})

test.describe('roles', () => {
  test('cashiers can look up sales but not refund them; managers can', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Return Role'), sale_price: 30 })
    const sale = await sell(request, { items: [{ product_id: product.id, quantity: 2 }], payment_method: 'cash' })
    const cashier = await createStaff(request, 'cashier')
    expect((await cashier.context.get(`/api/sales/${sale.id}`)).ok()).toBe(true)
    expect((await cashier.context.post(`/api/sales/${sale.id}/returns`, { data: { items: [{ product_id: product.id, quantity: 1 }] } })).status()).toBe(403)
    const manager = await createStaff(request, 'manager')
    expect((await manager.context.post(`/api/sales/${sale.id}/returns`, { data: { items: [{ product_id: product.id, quantity: 1 }] } })).status()).toBe(201)
  })
})

test.describe('Sales page', () => {
  test('finds a sale, shows its receipt and records a full return', async ({ page, request }) => {
    const product = await createProduct(request, { name: uniqueName('Page Return'), sale_price: 150, stock_quantity: 5 })
    const sale = await sell(request, { items: [{ product_id: product.id, quantity: 2 }], payment_method: 'cash' })

    await page.goto('/sales')
    await expect(page.getByRole('main').getByRole('heading', { name: 'Sales' })).toBeVisible()
    await page.getByLabel('Search sales').fill(String(sale.number))
    await page.getByRole('button', { name: `Open receipt #${sale.number}` }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(`Receipt #${sale.number} ·`)).toBeVisible()
    await expect(dialog.getByText('DUPLICATE COPY')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Print receipt' })).toBeVisible()

    await dialog.getByRole('button', { name: 'Return items' }).click()
    await dialog.getByRole('button', { name: 'Return everything' }).click()
    await expect(dialog.getByLabel(`Quantity of ${product.name} returned`)).toHaveValue('2')
    await dialog.getByLabel('Reason (optional)').fill('Wrong size')
    await dialog.getByRole('button', { name: 'Record return · Rs 300' }).click()

    await expect(dialog.getByRole('status')).toHaveText(`Return saved on receipt #${sale.number}: Rs 300. Give Rs 300 back in cash.`)
    await expect(dialog.getByText('Wrong size', { exact: false })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Return items' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: `Open receipt #${sale.number}` })).toContainText('Returned')
    expect((await getProduct(request, product.name))?.stock_quantity).toBe(5)
  })

  test('a cashier sees the receipt but no return button', async ({ request, browser }) => {
    const product = await createProduct(request, { name: uniqueName('Cashier View'), sale_price: 40 })
    const sale = await sell(request, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'cash' })
    const cashier = await createStaff(request, 'cashier')
    const context = await browserContextFor(browser, cashier.context)
    const page = await context.newPage()
    await page.goto('/sales')
    await page.getByLabel('Search sales').fill(String(sale.number))
    await page.getByRole('button', { name: `Open receipt #${sale.number}` }).click()
    await expect(page.getByRole('dialog').getByText('Returns are recorded by a manager or the owner.')).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Return items' })).toHaveCount(0)
    await context.close()
  })
})
