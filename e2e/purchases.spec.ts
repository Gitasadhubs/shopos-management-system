import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { createProduct, getProduct, uniqueName } from './helpers'

// Suppliers and purchases: receiving stock adds it to inventory and records what the shop owes.

async function createSupplier(request: APIRequestContext, name = uniqueName('Supplier')) {
  const response = await request.post('/api/suppliers', { data: { name, phone: '042 1234567' } })
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json()).data as { id: string; name: string; balance: number }
}

async function supplierBalance(request: APIRequestContext, id: string) {
  return (await (await request.get(`/api/suppliers/${id}`)).json()).data.party.balance as number
}

test.describe('purchases API', () => {
  test('receiving stock adds to inventory, updates cost and records what is owed', async ({ request }) => {
    const supplier = await createSupplier(request)
    const flour = await createProduct(request, { name: uniqueName('Flour'), cost_price: 90, sale_price: 120, stock_quantity: 2 })
    const sugar = await createProduct(request, { name: uniqueName('Sugar'), cost_price: 140, sale_price: 160, stock_quantity: 0 })

    const response = await request.post('/api/purchases', { data: { supplier_id: supplier.id, reference: 'INV-1001', amount_paid: 1000, items: [{ product_id: flour.id, quantity: 10, unit_cost: 95 }, { product_id: sugar.id, quantity: 5, unit_cost: 150 }] } })
    expect(response.status(), await response.text()).toBe(201)
    expect((await response.json()).data).toMatchObject({ total: 1700, amount_paid: 1000, supplier_name: supplier.name, reference: 'INV-1001' })

    expect(await getProduct(request, flour.name)).toMatchObject({ stock_quantity: 12, cost_price: 95 })
    expect(await getProduct(request, sugar.name)).toMatchObject({ stock_quantity: 5, cost_price: 150 })
    expect(await supplierBalance(request, supplier.id)).toBe(700)

    // Paying the supplier lowers the balance; overpaying is refused.
    expect((await request.post(`/api/suppliers/${supplier.id}/payment`, { data: { amount: 701 } })).status()).toBe(400)
    expect((await request.post(`/api/suppliers/${supplier.id}/payment`, { data: { amount: 700 } })).status()).toBe(201)
    expect(await supplierBalance(request, supplier.id)).toBe(0)
    const ledger = (await (await request.get(`/api/suppliers/${supplier.id}`)).json()).data.entries as Array<{ kind: string; amount: number }>
    expect(ledger.map((entry) => [entry.kind, entry.amount])).toEqual([['payment', -700], ['purchase', 700]])
  })

  test('can keep the old cost price', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Keep Cost'), cost_price: 50, stock_quantity: 1 })
    expect((await request.post('/api/purchases', { data: { update_cost: false, items: [{ product_id: product.id, quantity: 4, unit_cost: 70 }] } })).status()).toBe(201)
    expect(await getProduct(request, product.name)).toMatchObject({ stock_quantity: 5, cost_price: 50 })
  })

  test('rejects bad purchases without changing stock', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Bad Purchase'), stock_quantity: 3 })
    const line = { product_id: product.id, quantity: 2, unit_cost: 10 }
    const cases: Array<[unknown, number, string?]> = [
      [{ items: [] }, 400, 'Add at least one product.'],
      [{ items: [{ ...line, quantity: 0 }] }, 400],
      [{ items: [{ ...line, unit_cost: -1 }] }, 400],
      [{ items: [line, line] }, 400, 'Each product can only appear once in a purchase.'],
      [{ amount_paid: 5, items: [line] }, 400, 'Choose a supplier to buy on credit.'],
      [{ amount_paid: 50, items: [line] }, 400, 'The amount paid cannot be more than the purchase total.'],
      [{ items: [{ ...line, product_id: randomUUID() }] }, 404],
      [{ supplier_id: randomUUID(), items: [line] }, 404, 'Supplier not found.'],
    ]
    for (const [data, status, message] of cases) {
      const response = await request.post('/api/purchases', { data })
      expect(response.status(), JSON.stringify(data)).toBe(status)
      if (message) expect((await response.json()).error).toBe(message)
    }
    expect((await getProduct(request, product.name))?.stock_quantity).toBe(3)
  })

  test('a supplier with a balance cannot be removed', async ({ request }) => {
    const supplier = await createSupplier(request)
    const product = await createProduct(request, { name: uniqueName('Owed Item') })
    await request.post('/api/purchases', { data: { supplier_id: supplier.id, amount_paid: 0, items: [{ product_id: product.id, quantity: 1, unit_cost: 40 }] } })
    expect((await request.delete(`/api/suppliers/${supplier.id}`)).status()).toBe(409)
  })
})

test.describe('suppliers and purchases pages', () => {
  test('add a supplier, receive stock on credit, then pay the supplier', async ({ page, request }) => {
    const supplierName = uniqueName('Hafiz Traders')
    const product = await createProduct(request, { name: uniqueName('Cooking Oil'), cost_price: 500, sale_price: 560, stock_quantity: 1 })

    await page.goto('/suppliers')
    await expect(page.getByRole('main').getByRole('heading', { name: 'Suppliers' })).toBeVisible()
    await page.getByRole('button', { name: 'Add supplier' }).first().click()
    await page.getByRole('dialog').getByLabel('Name').fill(supplierName)
    await page.getByRole('dialog').getByRole('button', { name: 'Add supplier' }).click()
    await expect(page.getByRole('status')).toHaveText(`${supplierName} added.`)

    await page.getByRole('navigation').getByRole('link', { name: 'Purchases' }).click()
    await expect(page.getByRole('main').getByRole('heading', { name: 'Purchases' })).toBeVisible()
    await page.getByRole('button', { name: 'Record purchase' }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Supplier').selectOption({ label: supplierName })
    await dialog.getByLabel('Bill / reference').fill('B-42')
    await dialog.getByLabel('Product 1').selectOption({ label: `${product.name} (stock 1)` })
    // Choosing a product fills in its current cost.
    await expect(dialog.getByLabel('Unit cost 1')).toHaveValue('500')
    await dialog.getByLabel('Quantity 1').fill('6')
    await dialog.getByLabel('Unit cost 1').fill('480')
    await expect(dialog.getByRole('button', { name: /^Save purchase/ })).toHaveText('Save purchase · Rs 2,880')
    await dialog.getByLabel('Amount paid now').fill('2000')
    await expect(dialog.getByText('Owed to supplier').locator('..')).toContainText('Rs 880')
    await dialog.getByRole('button', { name: /^Save purchase/ }).click()
    await expect(page.getByRole('status')).toHaveText('Purchase saved · Rs 2,880 · stock updated.')
    const row = page.getByRole('listitem').filter({ hasText: supplierName })
    await expect(row).toContainText('#B-42')
    await expect(row).toContainText(`${product.name} × 6`)
    await expect(row).toContainText('Rs 880 unpaid')
    expect(await getProduct(request, product.name)).toMatchObject({ stock_quantity: 7, cost_price: 480 })

    await page.goto('/suppliers')
    await page.getByLabel('Search suppliers').fill(supplierName)
    await expect(page.getByRole('listitem').filter({ hasText: supplierName })).toContainText('You owe Rs 880')
    await page.getByRole('button', { name: `Pay supplier: ${supplierName}` }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Record payment' }).click()
    await expect(page.getByRole('status')).toHaveText(`Payment of Rs 880 recorded for ${supplierName}.`)
    await expect(page.getByRole('listitem').filter({ hasText: supplierName })).toContainText('Settled')
  })

  test('the purchase form adds and removes lines and can be cancelled', async ({ page, request }) => {
    await createProduct(request, { name: uniqueName('Line Item') })
    await page.goto('/purchases')
    await page.getByRole('button', { name: 'Record purchase' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Remove line 1' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Add line' }).click()
    await expect(dialog.getByLabel('Product 2')).toBeVisible()
    await dialog.getByRole('button', { name: 'Remove line 2' }).click()
    await expect(dialog.getByLabel('Product 2')).toHaveCount(0)
    await dialog.getByRole('button', { name: /^Save purchase/ }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Add at least one product.')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
  })
})
