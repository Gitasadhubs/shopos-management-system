import { expect, test, type Page } from '@playwright/test'
import { createProduct, getProduct, salesFor, uniqueCode, uniqueName } from './helpers'

const productCard = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) })
const completeButton = (page: Page) => page.getByRole('button', { name: /^Complete sale/ })
const cartQuantity = (page: Page, name: string) => page.getByRole('button', { name: `Remove one ${name}` }).locator('xpath=following-sibling::span[1]')

async function openPos(page: Page, search: string) {
  await page.goto('/pos')
  await expect(page.getByRole('heading', { name: 'Point of Sale' })).toBeVisible()
  await page.getByPlaceholder('Search products, SKU, or barcode').fill(search)
}

test('completes a cash sale with a discount', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Green Tea'), sale_price: 100, stock_quantity: 5 })
  await openPos(page, product.name)
  await expect(page.getByText('Select products to begin.')).toBeVisible()
  await expect(completeButton(page)).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Clear sale' })).toBeDisabled()

  await productCard(page, product.name).click()
  await productCard(page, product.name).click()
  await expect(productCard(page, product.name)).toContainText('2')
  await expect(cartQuantity(page, product.name)).toHaveText('2')
  await expect(page.getByText('Subtotal').locator('..')).toContainText('₨ 200')

  await page.getByLabel('Discount').fill('50')
  await expect(completeButton(page)).toHaveText('Complete sale · ₨ 150')
  await completeButton(page).click()

  await expect(page.getByRole('status')).toHaveText('Sale completed · ₨ 150')
  await expect(page.getByText('Select products to begin.')).toBeVisible()
  await expect(page.getByLabel('Discount')).toHaveValue('0')
  await expect(page.getByText(`${product.name} × 2`)).toBeVisible()
  await expect(productCard(page, product.name)).toContainText('Stock 3')
  expect((await getProduct(request, product.name))?.stock_quantity).toBe(3)
})

test('records a card sale', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Phone Charger'), sale_price: 300, stock_quantity: 2 })
  await openPos(page, product.name)

  await productCard(page, product.name).click()
  await expect(page.getByLabel('Payment method')).toContainText('Cash')
  await page.getByLabel('Payment method').click()
  await page.getByRole('option', { name: 'Card', exact: true }).click()
  await expect(page.getByLabel('Payment method')).toContainText('Card')
  await completeButton(page).click()

  await expect(page.getByRole('status')).toHaveText('Sale completed · ₨ 300')
  const [sale] = await salesFor(request, product.name)
  expect(sale.payment_method).toBe('card')
})

test('payment method can be switched back to cash', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Cash Again'), sale_price: 20 })
  await openPos(page, product.name)
  await productCard(page, product.name).click()
  await page.getByLabel('Payment method').click()
  await page.getByRole('option', { name: 'Card', exact: true }).click()
  await page.getByLabel('Payment method').click()
  await page.getByRole('option', { name: 'Cash', exact: true }).click()
  await completeButton(page).click()
  await expect(page.getByRole('status')).toHaveText('Sale completed · ₨ 20')
  expect((await salesFor(request, product.name))[0].payment_method).toBe('cash')
})

test('cart + and − buttons change quantity and − removes the line at zero', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Biscuits'), sale_price: 30, stock_quantity: 5 })
  await openPos(page, product.name)
  await productCard(page, product.name).click()

  await page.getByRole('button', { name: `Add one ${product.name}` }).click()
  await page.getByRole('button', { name: `Add one ${product.name}` }).click()
  await expect(cartQuantity(page, product.name)).toHaveText('3')
  await expect(completeButton(page)).toHaveText('Complete sale · ₨ 90')

  await page.getByRole('button', { name: `Remove one ${product.name}` }).click()
  await expect(cartQuantity(page, product.name)).toHaveText('2')
  await page.getByRole('button', { name: `Remove one ${product.name}` }).click()
  await page.getByRole('button', { name: `Remove one ${product.name}` }).click()
  await expect(page.getByText('Select products to begin.')).toBeVisible()
  await expect(completeButton(page)).toBeDisabled()
})

test('sells several products in one sale', async ({ page, request }) => {
  const tag = uniqueName('Basket')
  const bread = await createProduct(request, { name: `${tag} Bread`, sale_price: 120, stock_quantity: 4 })
  const eggs = await createProduct(request, { name: `${tag} Eggs`, sale_price: 25, stock_quantity: 12 })
  await openPos(page, tag)
  await productCard(page, bread.name).click()
  await productCard(page, eggs.name).click()
  await page.getByRole('button', { name: `Add one ${eggs.name}` }).click()
  await expect(completeButton(page)).toHaveText('Complete sale · ₨ 170')
  await completeButton(page).click()
  await expect(page.getByRole('status')).toHaveText('Sale completed · ₨ 170')
  expect((await getProduct(request, bread.name))?.stock_quantity).toBe(3)
  expect((await getProduct(request, eggs.name))?.stock_quantity).toBe(10)
})

test('cannot add more than available stock', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Limited Jam'), stock_quantity: 2 })
  await openPos(page, product.name)
  await productCard(page, product.name).click()
  await productCard(page, product.name).click()
  await productCard(page, product.name).click()
  await expect(page.getByRole('button', { name: `Add one ${product.name}` })).toBeDisabled()
  await expect(cartQuantity(page, product.name)).toHaveText('2')
})

test('out-of-stock products cannot be selected', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Sold Out Milk'), stock_quantity: 0 })
  await openPos(page, product.name)
  await expect(productCard(page, product.name)).toBeDisabled()
})

test('search finds products by SKU and shows an empty state', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Scanned Item'), sku: uniqueCode('SCAN') })
  await openPos(page, product.sku!)
  await expect(productCard(page, product.name)).toBeVisible()
  await expect(page.getByText('1 product', { exact: true })).toBeVisible()
  await page.getByPlaceholder('Search products, SKU, or barcode').fill('no-such-product-xyz')
  await expect(page.getByText('No products found. Add products in Inventory.')).toBeVisible()
})

test('rejects a discount larger than the subtotal', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Candle'), sale_price: 40, stock_quantity: 5 })
  await openPos(page, product.name)
  await productCard(page, product.name).click()
  await page.getByLabel('Discount').fill('100')
  await expect(completeButton(page)).toHaveText('Complete sale · ₨ 0')
  await completeButton(page).click()
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Discount cannot exceed the subtotal.')
  expect((await getProduct(request, product.name))?.stock_quantity).toBe(5)
})

test('Clear sale empties the cart and resets the discount', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Notebook') })
  await openPos(page, product.name)
  await productCard(page, product.name).click()
  await page.getByLabel('Discount').fill('10')
  await page.getByRole('button', { name: 'Clear sale' }).click()
  await expect(page.getByText('Select products to begin.')).toBeVisible()
  await expect(page.getByLabel('Discount')).toHaveValue('0')
  expect(await salesFor(request, product.name)).toHaveLength(0)
})

test('double-clicking Complete sale records one sale', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Double Click'), sale_price: 10, stock_quantity: 5 })
  await openPos(page, product.name)
  await productCard(page, product.name).click()
  await completeButton(page).dblclick()
  await expect(page.getByRole('status')).toHaveText('Sale completed · ₨ 10')
  expect(await salesFor(request, product.name)).toHaveLength(1)
  expect((await getProduct(request, product.name))?.stock_quantity).toBe(4)
})

test('a sale that fails is not duplicated when retried', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Flaky Network'), sale_price: 15, stock_quantity: 5 })
  await openPos(page, product.name)
  await productCard(page, product.name).click()

  // The server saves the sale but the response is lost. The till keeps the sale and sends it again
  // with the same client_id, so the server returns the sale it already has instead of a second one.
  let dropResponse = true
  await page.route('**/api/sales', async (route) => {
    if (route.request().method() !== 'POST' || !dropResponse) return route.continue()
    dropResponse = false
    await route.fetch()
    await route.abort('connectionreset')
  })
  await completeButton(page).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this till' })).toContainText('₨ 15')
  await expect(page.getByText(/Waiting to be sent/)).toHaveCount(0, { timeout: 30_000 })
  expect(await salesFor(request, product.name)).toHaveLength(1)
  expect((await getProduct(request, product.name))?.stock_quantity).toBe(4)
})

test('shows the server error and current stock when another till sold the item first', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Last Units'), stock_quantity: 3 })
  await openPos(page, product.name)
  await productCard(page, product.name).click()
  await productCard(page, product.name).click()

  const other = await request.post('/api/stock-moves', { data: { product_id: product.id, delta: -2, reason: 'Sold at till 2' } })
  expect(other.ok()).toBe(true)

  await completeButton(page).click()
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(`Not enough stock for ${product.name}.`)
  await expect(productCard(page, product.name)).toContainText('Stock 1')
  expect((await getProduct(request, product.name))?.stock_quantity).toBe(1)
})

test('the success message clears when the next sale starts', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Next Sale'), sale_price: 5 })
  await openPos(page, product.name)
  await productCard(page, product.name).click()
  await completeButton(page).click()
  await expect(page.getByRole('status')).toHaveText('Sale completed · ₨ 5')
  await productCard(page, product.name).click()
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('decimal prices total to the paisa', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Decimal'), sale_price: 33.33, stock_quantity: 10 })
  await openPos(page, product.name)
  for (let i = 0; i < 3; i += 1) await productCard(page, product.name).click()
  await expect(completeButton(page)).toHaveText('Complete sale · ₨ 99.99')
  await completeButton(page).click()
  await expect(page.getByRole('status')).toHaveText('Sale completed · ₨ 99.99')
  expect((await salesFor(request, product.name))[0].total).toBe(99.99)
})

test('recent sales list shows the newest sale first', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Recent'), sale_price: 12 })
  await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'card' } })
  await page.goto('/pos')
  const first = page.getByText(/^Receipt /).first()
  await expect(first.locator('..')).toContainText(`${product.name} × 1`)
})

test('a barcode scan (code + Enter) adds the product and clears the search', async ({ page, request }) => {
  const barcode = uniqueCode('890')
  const product = await createProduct(request, { name: uniqueName('Scanner Juice'), barcode, sale_price: 70, stock_quantity: 3 })
  await openPos(page, barcode)
  await expect(productCard(page, product.name)).toBeVisible()
  await page.getByPlaceholder('Search products, SKU, or barcode').press('Enter')
  await expect(cartQuantity(page, product.name)).toHaveText('1')
  await expect(page.getByPlaceholder('Search products, SKU, or barcode')).toHaveValue('')
  // Partial codes do not add anything.
  await page.getByPlaceholder('Search products, SKU, or barcode').fill(barcode.slice(0, 5))
  await page.getByPlaceholder('Search products, SKU, or barcode').press('Enter')
  await expect(cartQuantity(page, product.name)).toHaveText('1')
})

test('cash received shows the change to give and is saved on the sale', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Change Bread'), sale_price: 130, stock_quantity: 4 })
  await openPos(page, product.name)
  await productCard(page, product.name).click()
  await page.getByLabel('Cash received').fill('100')
  await completeButton(page).click()
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Cash received is less than the total.')
  await page.getByLabel('Cash received').fill('500')
  await expect(page.getByText('Change to give').locator('..')).toContainText('₨ 370')
  await completeButton(page).click()
  await expect(page.getByRole('status')).toHaveText('Sale completed · ₨ 130')
  const [sale] = await salesFor(request, product.name)
  expect(sale).toMatchObject({ amount_paid: 500, change_given: 370 })
  await expect(page.locator('.print-receipt')).toContainText('₨ 370')
})

test('category chips filter the product grid', async ({ page, request }) => {
  const tag = uniqueName('Chip')
  const drink = await createProduct(request, { name: `${tag} Cola`, category: `${tag} Drinks` })
  const snack = await createProduct(request, { name: `${tag} Chips`, category: `${tag} Snacks` })
  await openPos(page, tag)
  await expect(productCard(page, drink.name)).toBeVisible()
  await expect(productCard(page, snack.name)).toBeVisible()
  await page.getByRole('group', { name: 'Filter by category' }).getByRole('button', { name: `${tag} Drinks` }).click()
  await expect(productCard(page, snack.name)).toBeHidden()
  await expect(productCard(page, drink.name)).toBeVisible()
  await page.getByRole('group', { name: 'Filter by category' }).getByRole('button', { name: 'All' }).click()
  await expect(productCard(page, snack.name)).toBeVisible()
})

// Offline till (lib/offline/till.ts): with no connection the sale is kept on the device, and it reaches
// the server, once, when the connection is back.
test('keeps selling offline and sends the sale when the connection is back', async ({ page, context, request }) => {
  const product = await createProduct(request, { name: uniqueName('Offline Rice'), sale_price: 80, stock_quantity: 5 })
  await page.goto('/pos')
  // The shop name in the subtitle means the till knows its shop and can queue sales for it.
  await expect(page.getByText(/ · Products and sales are saved by the server\./)).toBeVisible()
  await expect(productCard(page, product.name)).toBeVisible()

  await context.setOffline(true)
  await productCard(page, product.name).click()
  await productCard(page, product.name).click()
  await completeButton(page).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this till' })).toContainText('₨ 160')
  await expect(page.getByText('Offline · 1 waiting')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Waiting to be sent (1)' }).or(page.getByText('Waiting to be sent (1)'))).toBeVisible()
  await expect(productCard(page, product.name)).toContainText('Stock 3')
  // Nothing reached the server yet.
  expect((await getProduct(request, product.name))?.stock_quantity).toBe(5)

  await context.setOffline(false)
  await expect(page.getByText(/Waiting to be sent/)).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByText(/waiting$/)).toHaveCount(0)
  expect((await getProduct(request, product.name))?.stock_quantity).toBe(3)
  const sales = await salesFor(request, product.name)
  expect(sales).toHaveLength(1)
  expect(Number(sales[0].total)).toBe(160)
})

test('an offline sale keeps its time and is recorded even if stock ran short', async ({ request }) => {
  const product = await createProduct(request, { name: uniqueName('Offline Oil'), sale_price: 50, stock_quantity: 1 })
  const sale = { items: [{ product_id: product.id, quantity: 3 }], payment_method: 'cash' }
  // A sale made online still cannot sell more than there is.
  expect((await request.post('/api/sales', { data: sale })).status()).toBe(409)

  const soldAt = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()
  const clientId = uniqueCode('offline')
  const first = await request.post('/api/sales', { data: { ...sale, client_id: clientId, offline: true, sold_at: soldAt } })
  expect(first.status(), await first.text()).toBe(201)
  const recorded = (await first.json()).data
  expect(Math.abs(Date.parse(recorded.created_at) - Date.parse(soldAt))).toBeLessThan(1000)
  expect(Number(recorded.total)).toBe(150)
  expect((await getProduct(request, product.name))?.stock_quantity).toBe(0)

  // Sending it again (the till retried) changes nothing.
  const again = await request.post('/api/sales', { data: { ...sale, client_id: clientId, offline: true, sold_at: soldAt } })
  expect((await again.json()).data.id).toBe(recorded.id)
  expect((await getProduct(request, product.name))?.stock_quantity).toBe(0)

  // A time in the future is not believed: the sale is dated now.
  const future = await request.post('/api/sales', { data: { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'cash', offline: true, sold_at: new Date(Date.now() + 86_400_000).toISOString() } })
  expect(future.status()).toBe(201)
  expect(Math.abs(Date.parse((await future.json()).data.created_at) - Date.now())).toBeLessThan(60_000)
})
