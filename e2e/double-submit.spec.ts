import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { createProduct, getProduct, salesFor, uniqueName } from './helpers'

// A double-click (or a key pressed twice) on a button that records money must record it once.
// Sales and returns also carry a client_id; the other forms rely on their button disabling itself.

const post = async (request: APIRequestContext, path: string, data: object) => {
  const response = await request.post(path, { data })
  expect(response.status(), `${path}: ${await response.text()}`).toBe(201)
  return (await response.json()).data
}

const searchPos = async (page: Page, name: string) => {
  await page.goto('/pos')
  await expect(page.getByRole('heading', { name: 'Point of Sale' })).toBeVisible()
  await page.getByPlaceholder('Search products, SKU, or barcode').fill(name)
}

test('Complete sale: a double-click and F9 pressed twice each record one sale', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Double Tea'), sale_price: 100, stock_quantity: 10 })
  await searchPos(page, product.name)
  await page.getByRole('button', { name: new RegExp(`^${product.name}`) }).click()
  await page.getByRole('button', { name: /^Complete sale/ }).dblclick()
  await expect(page.getByRole('status')).toHaveText('Sale completed · ₨ 100')
  await expect.poll(async () => (await salesFor(request, product.name)).length).toBe(1)

  await page.getByRole('button', { name: new RegExp(`^${product.name}`) }).click()
  await page.keyboard.press('F9')
  await page.keyboard.press('F9')
  await expect(page.getByRole('status')).toHaveText('Sale completed · ₨ 100')
  await page.waitForTimeout(1_000)
  expect((await salesFor(request, product.name)).length).toBe(2)
  expect((await getProduct(request, product.name))?.stock_quantity).toBe(8)
})

test('Receive payment from a customer: a double-click records one payment', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Double Rice'), sale_price: 100, stock_quantity: 10 })
  const customer = await post(request, '/api/customers', { name: uniqueName('Double Customer') })
  await post(request, '/api/sales', { items: [{ product_id: product.id, quantity: 2 }], payment_method: 'credit', customer_id: customer.id, amount_paid: 0 })

  await page.goto('/customers')
  await page.getByLabel('Search customers').fill(customer.name)
  await page.getByRole('button', { name: `Receive payment: ${customer.name}` }).click()
  await page.getByRole('dialog').getByLabel('Amount').fill('50')
  await page.getByRole('dialog').getByRole('button', { name: 'Record payment' }).dblclick()
  await expect(page.getByRole('status')).toHaveText(`Payment of ₨ 50 recorded for ${customer.name}.`)
  await page.waitForTimeout(1_000)

  const detail = (await (await request.get(`/api/customers/${customer.id}`)).json()).data
  expect(detail.entries.filter((entry: { kind: string }) => entry.kind === 'payment')).toHaveLength(1)
  expect(detail.party.balance).toBe(150)
})

test('Pay a supplier: a double-click records one payment', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Double Flour'), stock_quantity: 1 })
  const supplier = await post(request, '/api/suppliers', { name: uniqueName('Double Supplier') })
  await post(request, '/api/purchases', { supplier_id: supplier.id, items: [{ product_id: product.id, quantity: 1, unit_cost: 500 }], amount_paid: 0 })

  await page.goto('/suppliers')
  await page.getByLabel('Search suppliers').fill(supplier.name)
  await page.getByRole('button', { name: `Pay supplier: ${supplier.name}` }).click()
  await page.getByRole('dialog').getByLabel('Amount').fill('100')
  await page.getByRole('dialog').getByRole('button', { name: 'Record payment' }).dblclick()
  await expect(page.getByRole('status')).toHaveText(`Payment of ₨ 100 recorded for ${supplier.name}.`)
  await page.waitForTimeout(1_000)

  const detail = (await (await request.get(`/api/suppliers/${supplier.id}`)).json()).data
  expect(detail.entries.filter((entry: { kind: string }) => entry.kind === 'payment')).toHaveLength(1)
  expect(detail.party.balance).toBe(400)
})

test('Record a return: a double-click records one return', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Double Soap'), sale_price: 100, stock_quantity: 10 })
  const sale = await post(request, '/api/sales', { items: [{ product_id: product.id, quantity: 2 }], payment_method: 'cash' })

  await page.goto('/sales')
  await page.getByLabel('Search sales').fill(String(sale.number))
  await page.getByRole('button', { name: `Open receipt #${sale.number}` }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Return items' }).click()
  await dialog.getByRole('button', { name: 'Return everything' }).click()
  await dialog.getByRole('button', { name: /^Record return/ }).dblclick()
  await expect(dialog.getByRole('status')).toContainText(`Return saved on receipt #${sale.number}: ₨ 200.`)
  await page.waitForTimeout(1_000)

  const detail = (await (await request.get(`/api/sales/${sale.id}`)).json()).data
  expect(detail.returns).toHaveLength(1)
  expect(detail.refunded).toBe(200)
  expect((await getProduct(request, product.name))?.stock_quantity).toBe(10)
})

test('Save a purchase: a double-click records one purchase and adds the stock once', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Double Sugar'), stock_quantity: 5, cost_price: 40 })

  await page.goto('/purchases')
  await page.getByRole('button', { name: 'Record purchase' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Product 1').selectOption({ label: `${product.name} (stock 5)` })
  await dialog.getByLabel('Quantity 1').fill('3')
  await dialog.getByLabel('Unit cost 1').fill('50')
  await dialog.getByRole('button', { name: /^Save purchase/ }).dblclick()
  await expect(page.getByRole('status')).toHaveText('Purchase saved · ₨ 150 · stock updated.')
  await page.waitForTimeout(1_000)

  const purchases = (await (await request.get('/api/purchases')).json()).data as Array<{ items: Array<{ product_name: string }> }>
  expect(purchases.filter((purchase) => purchase.items.some((item) => item.product_name === product.name))).toHaveLength(1)
  expect((await getProduct(request, product.name))?.stock_quantity).toBe(8)
})

test('Add an expense: a double-click records one expense', async ({ page, request }) => {
  const note = uniqueName('Double chai')
  await page.goto('/expenses')
  await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'Electricity & gas' }).click()
  await page.getByLabel('Amount (₨)').fill('333')
  await page.getByLabel('Note').fill(note)
  await page.getByRole('button', { name: 'Add expense' }).dblclick()
  await expect(page.getByRole('status')).toHaveText('Electricity & gas expense of ₨ 333 saved.')
  await page.waitForTimeout(1_000)

  const list = (await (await request.get('/api/expenses')).json()).data as { expenses: Array<{ note: string | null }> }
  expect(list.expenses.filter((expense) => expense.note === note)).toHaveLength(1)
})

test('Add a product or a customer: a double-click adds one', async ({ page, request }) => {
  const name = uniqueName('Double Product')
  await page.goto('/inventory')
  await page.getByRole('button', { name: 'Add product' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Product name').fill(name)
  await dialog.getByLabel('Sale price').fill('120')
  await dialog.getByRole('button', { name: 'Add product' }).dblclick()
  await expect(page.getByRole('status')).toHaveText('Product added.')
  await page.waitForTimeout(1_000)
  const products = (await (await request.get(`/api/products?search=${encodeURIComponent(name)}`)).json()).data as Array<{ name: string }>
  expect(products.filter((product) => product.name === name)).toHaveLength(1)

  const customer = uniqueName('Double New Customer')
  await page.goto('/customers')
  await page.getByRole('button', { name: 'Add customer' }).first().click()
  await page.getByRole('dialog').getByLabel('Name').fill(customer)
  await page.getByRole('dialog').getByRole('button', { name: 'Add customer' }).dblclick()
  await expect(page.getByRole('status')).toHaveText(`${customer} added.`)
  await page.waitForTimeout(1_000)
  const customers = (await (await request.get(`/api/customers?search=${encodeURIComponent(customer)}`)).json()).data as Array<{ name: string }>
  expect(customers.filter((item) => item.name === customer)).toHaveLength(1)
})
