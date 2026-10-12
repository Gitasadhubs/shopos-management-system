import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { browserContextFor, createStaff, signUpShop } from './auth-helpers'
import { createProduct, uniqueCode, uniqueName } from './helpers'

// Many shops share one install. Nothing one shop does may be seen or changed by another.

test('a second shop sees none of the first shop\'s data and cannot touch it', async ({ request }) => {
  const sku = uniqueCode('SHARED')
  const product = await createProduct(request, { name: uniqueName('Shop A Tea'), sku, stock_quantity: 5 })
  const clientId = randomUUID()
  const sale = await request.post('/api/sales', { data: { client_id: clientId, items: [{ product_id: product.id, quantity: 1 }], payment_method: 'cash' } })
  expect(sale.status()).toBe(201)
  const saleA = (await sale.json()).data
  const customer = (await (await request.post('/api/customers', { data: { name: uniqueName('Shop A Customer') } })).json()).data
  const supplier = (await (await request.post('/api/suppliers', { data: { name: uniqueName('Shop A Supplier') } })).json()).data

  const shopB = await signUpShop()
  const b = shopB.context

  // Lists are empty for the new shop.
  expect((await (await b.get('/api/products')).json()).data).toEqual([])
  expect((await (await b.get('/api/sales')).json()).data).toEqual([])
  expect((await (await b.get('/api/customers')).json()).data).toEqual([])
  expect((await (await b.get('/api/suppliers')).json()).data).toEqual([])
  expect((await (await b.get('/api/purchases')).json()).data).toEqual([])
  expect((await (await b.get('/api/dashboard')).json()).data).toMatchObject({ sales: 0, salesCount: 0, lowStock: 0 })
  expect((await (await b.get('/api/reports')).json()).data.totals.count).toBe(0)

  // Codes only have to be unique within a shop.
  const sameSku = await b.post('/api/products', { data: { name: uniqueName('Shop B Tea'), sku, stock_quantity: 3, sale_price: 10 } })
  expect(sameSku.status(), await sameSku.text()).toBe(201)
  const productB = (await sameSku.json()).data

  // Shop A's records look missing from shop B.
  expect((await b.put('/api/products', { data: { id: product.id, name: 'Hijacked' } })).status()).toBe(404)
  expect((await b.delete(`/api/products?id=${product.id}`)).status()).toBe(404)
  expect((await b.post('/api/stock-moves', { data: { product_id: product.id, delta: -1, reason: 'Steal' } })).status()).toBe(404)
  expect((await b.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'cash' } })).status()).toBe(404)
  expect((await b.get(`/api/customers/${customer.id}`)).status()).toBe(404)
  expect((await b.put(`/api/customers/${customer.id}`, { data: { name: 'Hijacked' } })).status()).toBe(404)
  expect((await b.post(`/api/customers/${customer.id}/payment`, { data: { amount: 1 } })).status()).toBe(404)
  expect((await b.get(`/api/suppliers/${supplier.id}`)).status()).toBe(404)
  expect((await b.post('/api/sales', { data: { customer_id: customer.id, items: [{ product_id: productB.id, quantity: 1 }], payment_method: 'credit' } })).status()).toBe(404)
  expect((await b.post('/api/purchases', { data: { supplier_id: supplier.id, items: [{ product_id: productB.id, quantity: 1, unit_cost: 1 }] } })).status()).toBe(404)

  // Reusing shop A's checkout id does not return shop A's sale.
  const replay = await b.post('/api/sales', { data: { client_id: clientId, items: [{ product_id: productB.id, quantity: 1 }], payment_method: 'cash' } })
  expect(replay.status()).toBe(201)
  const replayId = (await replay.json()).data.id as string
  expect(replayId).not.toBe(saleA.id)

  // Shop A is unchanged.
  const listed = ((await (await request.get(`/api/products?search=${encodeURIComponent(product.name)}`)).json()).data as Array<{ name: string; stock_quantity: number }>)
  expect(listed).toEqual([expect.objectContaining({ name: product.name, stock_quantity: 4 })])
  expect(((await (await request.get('/api/sales')).json()).data as Array<{ id: string }>).some((item) => item.id === replayId)).toBe(false)
  await b.dispose()
})

test('an owner cannot manage staff of another shop', async ({ request }) => {
  const staffA = await createStaff(request, 'cashier')
  const shopB = await signUpShop()
  const changed = await shopB.context.patch(`/api/users/${staffA.id}`, { data: { is_active: false } })
  expect(changed.status()).toBe(404)
  expect((await staffA.context.get('/api/auth/me')).ok()).toBe(true)
  const staffList = (await (await shopB.context.get('/api/users')).json()).data
  expect(staffList.users.map((user: { email: string }) => user.email)).toEqual([shopB.email])
  await Promise.all([shopB.context.dispose(), staffA.context.dispose()])
})

test('a new shop starts on a 14-day trial and sees its own name', async ({ browser }) => {
  const shop = await signUpShop(uniqueName('Bakery'))
  const me = (await (await shop.context.get('/api/auth/me')).json()).data.user
  expect(me).toMatchObject({ role: 'owner', shop: { name: shop.shopName, subscription: { state: 'trialing', days_left: 14, can_write: true } } })

  const context = await browserContextFor(browser, shop.context)
  const page = await context.newPage()
  await page.goto('/dashboard')
  await expect(page.getByRole('complementary').getByText(shop.shopName, { exact: true })).toBeVisible()
  await expect(page.getByRole('banner').getByRole('link', { name: 'Trial · 14 days left' })).toBeVisible()
  await expect(page.getByText('No sales recorded today.')).toBeVisible()
  await context.close()
  await shop.context.dispose()
})
