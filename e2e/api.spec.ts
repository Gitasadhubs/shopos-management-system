import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createProduct, getProduct, uniqueCode, uniqueName } from './helpers'

test.describe('products API', () => {
  test('rejects a product without a name', async ({ request }) => {
    const response = await request.post('/api/products', { data: { name: '  ', sale_price: 10 } })
    expect(response.status()).toBe(400)
    expect((await response.json()).error).toBe('Product name is required.')
  })

  test('rejects negative prices and stock', async ({ request }) => {
    for (const field of ['sale_price', 'cost_price', 'stock_quantity', 'reorder_level']) {
      const response = await request.post('/api/products', { data: { name: uniqueName('Bad Number'), [field]: -1 } })
      expect(response.status(), field).toBe(400)
    }
  })

  test('rejects invalid JSON', async ({ request }) => {
    const response = await request.post('/api/products', { headers: { 'content-type': 'application/json' }, data: Buffer.from('{not json') })
    expect(response.status()).toBe(400)
    expect((await response.json()).error).toBe('Request body must be valid JSON.')
  })

  test('trims text and defaults the unit', async ({ request }) => {
    const name = uniqueName('Trimmed')
    const product = await createProduct(request, { name: `  ${name}  `, category: '  Snacks ' })
    expect(product).toMatchObject({ name, category: 'Snacks', unit: 'pcs' })
  })

  test('rejects duplicate SKUs and barcodes, ignoring case', async ({ request }) => {
    const sku = uniqueCode('SKU')
    const barcode = uniqueCode('BC')
    await createProduct(request, { name: uniqueName('Code Owner'), sku, barcode })

    const skuClash = await request.post('/api/products', { data: { name: uniqueName('Clash'), sku: sku.toLowerCase() } })
    expect(skuClash.status()).toBe(409)
    expect((await skuClash.json()).error).toBe('SKU is already in use by another product.')

    const barcodeClash = await request.post('/api/products', { data: { name: uniqueName('Clash'), barcode } })
    expect(barcodeClash.status()).toBe(409)
    expect((await barcodeClash.json()).error).toBe('Barcode is already in use by another product.')
  })

  test('lets products without codes coexist', async ({ request }) => {
    await createProduct(request, { name: uniqueName('No Code A') })
    await createProduct(request, { name: uniqueName('No Code B') })
  })

  test('frees a code when its product is deleted', async ({ request }) => {
    const sku = uniqueCode('REUSE')
    const old = await createProduct(request, { name: uniqueName('Retired'), sku })
    expect((await request.delete(`/api/products?id=${old.id}`)).ok()).toBe(true)
    await createProduct(request, { name: uniqueName('Replacement'), sku })
  })

  test('updates a product and rejects taking another product\'s code', async ({ request }) => {
    const owner = await createProduct(request, { name: uniqueName('Owner'), barcode: uniqueCode('OWN') })
    const product = await createProduct(request, { name: uniqueName('Updatable') })

    const updated = await request.put('/api/products', { data: { id: product.id, name: product.name, sale_price: 77 } })
    expect(updated.ok()).toBe(true)
    expect((await updated.json()).data.sale_price).toBe(77)

    const clash = await request.put('/api/products', { data: { id: product.id, name: product.name, barcode: owner.barcode } })
    expect(clash.status()).toBe(409)
  })

  test('returns 404 when updating or deleting an unknown product', async ({ request }) => {
    const id = randomUUID()
    expect((await request.put('/api/products', { data: { id, name: 'Ghost' } })).status()).toBe(404)
    expect((await request.delete(`/api/products?id=${id}`)).status()).toBe(404)
    expect((await request.delete('/api/products?id=not-a-uuid')).status()).toBe(400)
    expect((await request.put('/api/products', { data: { id: 'not-a-uuid', name: 'Ghost' } })).status()).toBe(400)
  })

  test('a deleted product cannot be deleted or edited again', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Gone') })
    expect((await request.delete(`/api/products?id=${product.id}`)).ok()).toBe(true)
    expect((await request.delete(`/api/products?id=${product.id}`)).status()).toBe(404)
    expect((await request.put('/api/products', { data: { id: product.id, name: product.name } })).status()).toBe(404)
  })

  test('local-products alias serves the same data', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Alias Check') })
    const response = await request.get(`/api/local-products?search=${encodeURIComponent(product.name)}`)
    expect((await response.json()).data).toEqual([expect.objectContaining({ id: product.id })])
  })
})

test.describe('sales API', () => {
  test('rejects a sale larger than available stock', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Scarce Item'), stock_quantity: 1 })
    const response = await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 2 }], payment_method: 'cash' } })
    expect(response.status()).toBe(409)
    expect((await response.json()).error).toBe(`Not enough stock for ${product.name}.`)
  })

  test('rejects an empty sale, unknown payment methods and credit without a customer', async ({ request }) => {
    expect((await request.post('/api/sales', { data: { items: [], payment_method: 'cash' } })).status()).toBe(400)
    const product = await createProduct(request, { name: uniqueName('Credit Item') })
    expect((await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'bitcoin' } })).status()).toBe(400)
    const noCustomer = await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'credit' } })
    expect(noCustomer.status()).toBe(400)
    expect((await noCustomer.json()).error).toBe('Choose a customer for a credit (khata) sale.')
    expect((await getProduct(request, product.name))?.stock_quantity).toBe(10)
  })

  test('rejects zero and negative quantities', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Zero Qty') })
    for (const quantity of [0, -1]) {
      expect((await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity }], payment_method: 'cash' } })).status()).toBe(400)
    }
  })

  test('rejects a discount above the subtotal', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Discount Item'), sale_price: 10 })
    const response = await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 1 }], discount: 11, payment_method: 'cash' } })
    expect(response.status()).toBe(400)
  })

  test('rejects underpayment', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Underpaid Item'), sale_price: 100 })
    const response = await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 1 }], amount_paid: 50, payment_method: 'cash' } })
    expect(response.status()).toBe(400)
    expect((await response.json()).error).toBe('Amount paid must cover the sale total.')
  })

  test('rejects duplicate products in one sale', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Duplicate Line') })
    const response = await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 1 }, { product_id: product.id, quantity: 1 }], payment_method: 'cash' } })
    expect(response.status()).toBe(400)
  })

  test('calculates change and is idempotent per client_id', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Retry Item'), sale_price: 75, stock_quantity: 5 })
    const sale = { client_id: randomUUID(), items: [{ product_id: product.id, quantity: 2 }], payment_method: 'cash', amount_paid: 200 }

    const first = await request.post('/api/sales', { data: sale })
    expect(first.status()).toBe(201)
    const created = (await first.json()).data
    expect(created).toMatchObject({ total: 150, amount_paid: 200, change_given: 50 })

    const retry = await request.post('/api/sales', { data: sale })
    expect(retry.ok()).toBe(true)
    expect((await retry.json()).data.id).toBe(created.id)
    expect((await getProduct(request, product.name))?.stock_quantity).toBe(3)
  })

  test('rounds money to two decimals', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Float Item'), sale_price: 0.1, cost_price: 0.05, stock_quantity: 10 })
    const response = await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 3 }], discount: 0.1, amount_paid: 1, payment_method: 'cash' } })
    expect(response.status()).toBe(201)
    const sale = (await response.json()).data
    expect(sale).toMatchObject({ total: 0.2, change_given: 0.8 })
    expect(sale.items[0].subtotal).toBe(0.3)
  })

  test('records the sale price and cost at the time of sale', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Price Change'), sale_price: 50, cost_price: 30 })
    const response = await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'cash' } })
    const sale = (await response.json()).data
    await request.put('/api/products', { data: { id: product.id, name: product.name, sale_price: 80, cost_price: 60 } })
    const listed = ((await (await request.get('/api/sales')).json()).data as Array<{ id: string; items: Array<{ unit_price: number; cost_price: number }> }>).find((item) => item.id === sale.id)
    expect(listed?.items[0]).toMatchObject({ unit_price: 50, cost_price: 30 })
  })

  test('cannot sell a deleted product', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Deleted Item') })
    await request.delete(`/api/products?id=${product.id}`)
    const response = await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'cash' } })
    expect(response.status()).toBe(404)
  })
})

test.describe('stock moves API', () => {
  test('adds and removes stock', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Moves'), stock_quantity: 5 })
    const added = await request.post('/api/stock-moves', { data: { product_id: product.id, delta: 3, reason: 'Delivery' } })
    expect((await added.json()).data.stock_quantity).toBe(8)
    const removed = await request.post('/api/stock-moves', { data: { product_id: product.id, delta: -8, reason: 'Write-off' } })
    expect((await removed.json()).data.stock_quantity).toBe(0)
  })

  test('rejects a zero change, a short reason, and unknown products', async ({ request }) => {
    const product = await createProduct(request, { name: uniqueName('Stock Rules') })
    expect((await request.post('/api/stock-moves', { data: { product_id: product.id, delta: 0, reason: 'Recount' } })).status()).toBe(400)
    expect((await request.post('/api/stock-moves', { data: { product_id: product.id, delta: 1, reason: 'x' } })).status()).toBe(400)
    expect((await request.post('/api/stock-moves', { data: { product_id: randomUUID(), delta: 1, reason: 'Recount' } })).status()).toBe(404)
  })
})

test.describe('features not available in self-hosted mode', () => {
  test('the hosted-only credit sync endpoint returns 501', async ({ request }) => {
    expect((await request.post('/api/credit-moves', { data: { client_id: 'x', customer_id: randomUUID(), amount: 1 } })).status()).toBe(501)
  })
})
