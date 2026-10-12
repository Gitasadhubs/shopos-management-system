import { expect, test, type Page } from '@playwright/test'
import { createProduct, getProduct, uniqueCode, uniqueName } from './helpers'

const row = (page: Page, name: string) => page.getByRole('row', { name: new RegExp(name) })
const searchBox = (page: Page) => page.getByPlaceholder('Search name, SKU, or barcode')

test.beforeEach(async ({ page }) => {
  await page.goto('/inventory')
  await expect(page.getByRole('main').getByRole('heading', { name: 'Inventory' })).toBeVisible()
})

test.describe('add product', () => {
  test('saves every field from the form', async ({ page, request }) => {
    const name = uniqueName('Basmati Rice')
    const sku = uniqueCode('RICE')
    const barcode = uniqueCode('890')
    await page.getByRole('button', { name: 'Add product' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Add product' })).toBeVisible()
    await expect(dialog.getByLabel('Unit')).toHaveValue('pcs')
    await dialog.getByLabel('Product name').fill(name)
    await dialog.getByLabel('SKU').fill(sku)
    await dialog.getByLabel('Barcode').fill(barcode)
    await dialog.getByLabel('Category').fill('Grocery')
    await dialog.getByLabel('Unit').fill('kg')
    await dialog.getByLabel('Cost price').fill('180.5')
    await dialog.getByLabel('Sale price').fill('220.75')
    await dialog.getByLabel('Stock quantity').fill('25')
    await dialog.getByLabel('Reorder level').fill('5')
    await dialog.getByRole('button', { name: 'Add product' }).click()

    await expect(dialog).toBeHidden()
    await expect(page.getByRole('status')).toHaveText('Product added.')
    await expect(row(page, name)).toContainText('Grocery')
    await expect(row(page, name)).toContainText(sku)
    await expect(row(page, name)).toContainText('₨ 220.75')
    expect(await getProduct(request, name)).toMatchObject({ sku, barcode, category: 'Grocery', unit: 'kg', cost_price: 180.5, sale_price: 220.75, stock_quantity: 25, reorder_level: 5 })
  })

  test('shows placeholders for missing category and codes', async ({ page }) => {
    const name = uniqueName('Plain Item')
    await page.getByRole('button', { name: 'Add product' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Product name').fill(name)
    await dialog.getByRole('button', { name: 'Add product' }).click()
    await expect(row(page, name)).toContainText('Uncategorized')
    await expect(row(page, name)).toContainText('No SKU or barcode')
  })

  test('requires a product name', async ({ page }) => {
    await page.getByRole('button', { name: 'Add product' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Add product' }).click()
    await expect(dialog).toBeVisible()
    expect(await dialog.getByLabel('Product name').evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true)
  })

  test('rejects negative numbers in the browser', async ({ page }) => {
    await page.getByRole('button', { name: 'Add product' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Product name').fill(uniqueName('Negative'))
    await dialog.getByLabel('Sale price').fill('-5')
    await dialog.getByRole('button', { name: 'Add product' }).click()
    await expect(dialog).toBeVisible()
    expect(await dialog.getByLabel('Sale price').evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true)
  })

  test('shows the server error for a duplicate SKU and keeps the form open', async ({ page, request }) => {
    const existing = await createProduct(request, { name: uniqueName('SKU Owner'), sku: uniqueCode('DUP') })
    const name = uniqueName('SKU Clash')
    await page.getByRole('button', { name: 'Add product' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Product name').fill(name)
    await dialog.getByLabel('SKU').fill(existing.sku!.toLowerCase())
    await dialog.getByRole('button', { name: 'Add product' }).click()

    await expect(dialog.getByRole('alert')).toHaveText('SKU is already in use by another product.')
    await expect(dialog.getByLabel('Product name')).toHaveValue(name)
    expect(await getProduct(request, name)).toBeUndefined()
  })

  test('Cancel closes without saving', async ({ page, request }) => {
    const name = uniqueName('Cancelled')
    await page.getByRole('button', { name: 'Add product' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Product name').fill(name)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(await getProduct(request, name)).toBeUndefined()
  })

  test('the X button closes without saving', async ({ page, request }) => {
    const name = uniqueName('Closed')
    await page.getByRole('button', { name: 'Add product' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Product name').fill(name)
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
    expect(await getProduct(request, name)).toBeUndefined()
  })

  test('reopening the form starts empty', async ({ page }) => {
    await page.getByRole('button', { name: 'Add product' }).click()
    await page.getByRole('dialog').getByLabel('Product name').fill('Draft name')
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.getByRole('button', { name: 'Add product' }).click()
    await expect(page.getByRole('dialog').getByLabel('Product name')).toHaveValue('')
  })
})

test.describe('edit product', () => {
  test('prefills every field and saves changes', async ({ page, request }) => {
    const product = await createProduct(request, { name: uniqueName('Cooking Oil'), sku: uniqueCode('OIL'), barcode: uniqueCode('B'), category: 'Pantry', unit: 'ltr', cost_price: 400, sale_price: 500, stock_quantity: 8, reorder_level: 3 })
    await page.reload()
    await page.getByRole('button', { name: `Edit ${product.name}` }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Edit product' })).toBeVisible()
    await expect(dialog.getByLabel('Product name')).toHaveValue(product.name)
    await expect(dialog.getByLabel('SKU')).toHaveValue(product.sku!)
    await expect(dialog.getByLabel('Barcode')).toHaveValue(product.barcode!)
    await expect(dialog.getByLabel('Category')).toHaveValue('Pantry')
    await expect(dialog.getByLabel('Unit')).toHaveValue('ltr')
    await expect(dialog.getByLabel('Cost price')).toHaveValue('400')
    await expect(dialog.getByLabel('Sale price')).toHaveValue('500')
    await expect(dialog.getByLabel('Stock quantity')).toHaveValue('8')
    await expect(dialog.getByLabel('Reorder level')).toHaveValue('3')

    const renamed = `${product.name} Gold`
    await dialog.getByLabel('Product name').fill(renamed)
    await dialog.getByLabel('Sale price').fill('550')
    await dialog.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByRole('status')).toHaveText('Product updated.')
    await expect(row(page, renamed)).toContainText('₨ 550')
    expect(await getProduct(request, renamed)).toMatchObject({ id: product.id, sale_price: 550 })
  })

  test('can keep its own SKU but not take another product\'s', async ({ page, request }) => {
    const other = await createProduct(request, { name: uniqueName('Other Code'), sku: uniqueCode('TAKEN') })
    const product = await createProduct(request, { name: uniqueName('Own Code'), sku: uniqueCode('MINE') })
    await page.reload()

    await page.getByRole('button', { name: `Edit ${product.name}` }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Category').fill('Kept')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toHaveText('Product updated.')

    await page.getByRole('button', { name: `Edit ${product.name}` }).click()
    await dialog.getByLabel('SKU').fill(other.sku!)
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('SKU is already in use by another product.')
    expect((await getProduct(request, product.name))?.sku).toBe(product.sku)
  })

  test('Cancel discards edits', async ({ page, request }) => {
    const product = await createProduct(request, { name: uniqueName('Unchanged'), sale_price: 90 })
    await page.reload()
    await page.getByRole('button', { name: `Edit ${product.name}` }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Sale price').fill('999')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect((await getProduct(request, product.name))?.sale_price).toBe(90)
  })
})

test.describe('search', () => {
  test('filters by name, SKU and barcode, and shows an empty state', async ({ page, request }) => {
    const tag = uniqueName('Filter')
    const match = await createProduct(request, { name: `${tag} Tea`, sku: uniqueCode('TEA'), barcode: uniqueCode('BAR') })
    await createProduct(request, { name: uniqueName('Unrelated Soap') })
    await page.reload()

    for (const term of [tag, match.sku!, match.barcode!]) {
      await searchBox(page).fill(term)
      await expect(page.getByText('Products (1)', { exact: true })).toBeVisible()
      await expect(row(page, match.name)).toBeVisible()
    }

    await searchBox(page).fill('no-such-product-xyz')
    await expect(page.getByText('Products (0)', { exact: true })).toBeVisible()
    await expect(page.getByText('No products found. Add a product to get started.')).toBeVisible()
  })

  test('a slow earlier search cannot overwrite a newer one', async ({ page, request }) => {
    const tag = uniqueName('Race')
    const product = await createProduct(request, { name: `${tag} Target` })
    await page.route((url) => url.pathname === '/api/products' && url.searchParams.get('search') === 'R', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.continue()
    })
    await searchBox(page).fill('R')
    await searchBox(page).fill(tag)
    await expect(page.getByText('Products (1)', { exact: true })).toBeVisible()
    await page.waitForTimeout(2000)
    await expect(page.getByText('Products (1)', { exact: true })).toBeVisible()
    await expect(row(page, product.name)).toBeVisible()
  })
})

test.describe('adjust stock', () => {
  test('removes stock and flags low stock', async ({ page, request }) => {
    const product = await createProduct(request, { name: uniqueName('Sugar'), stock_quantity: 10, reorder_level: 4 })
    await page.reload()
    await expect(row(page, product.name).getByText('Low')).toHaveCount(0)

    await page.getByRole('button', { name: `Adjust stock for ${product.name}` }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading')).toHaveText(`Adjust stock · ${product.name}`)
    await expect(dialog).toContainText('Current stock: 10')
    await dialog.getByLabel('Change in stock').fill('-7')
    await dialog.getByLabel('Reason').fill('Damaged bags')
    await dialog.getByRole('button', { name: 'Update stock' }).click()

    await expect(page.getByRole('status')).toHaveText('Stock updated.')
    await expect(row(page, product.name).getByText('Low')).toBeVisible()
    expect((await getProduct(request, product.name))?.stock_quantity).toBe(3)
  })

  test('adds stock', async ({ page, request }) => {
    const product = await createProduct(request, { name: uniqueName('Restock'), stock_quantity: 1, reorder_level: 2 })
    await page.reload()
    await expect(row(page, product.name).getByText('Low')).toBeVisible()
    await page.getByRole('button', { name: `Adjust stock for ${product.name}` }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Change in stock').fill('12.5')
    await dialog.getByLabel('Reason').fill('Supplier delivery')
    await dialog.getByRole('button', { name: 'Update stock' }).click()
    await expect(page.getByRole('status')).toHaveText('Stock updated.')
    await expect(row(page, product.name).getByText('Low')).toHaveCount(0)
    expect((await getProduct(request, product.name))?.stock_quantity).toBe(13.5)
  })

  test('rejects reducing stock below zero', async ({ page, request }) => {
    const product = await createProduct(request, { name: uniqueName('Flour'), stock_quantity: 2 })
    await page.reload()
    await page.getByRole('button', { name: `Adjust stock for ${product.name}` }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Change in stock').fill('-5')
    await dialog.getByLabel('Reason').fill('Count correction')
    await dialog.getByRole('button', { name: 'Update stock' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Stock cannot be reduced below zero.')
    expect((await getProduct(request, product.name))?.stock_quantity).toBe(2)
  })

  test('requires a change and a reason', async ({ page, request }) => {
    const product = await createProduct(request, { name: uniqueName('Needs Reason') })
    await page.reload()
    await page.getByRole('button', { name: `Adjust stock for ${product.name}` }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Update stock' }).click()
    expect(await dialog.getByLabel('Change in stock').evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true)
    await dialog.getByLabel('Change in stock').fill('3')
    await dialog.getByRole('button', { name: 'Update stock' }).click()
    expect(await dialog.getByLabel('Reason').evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true)
  })

  test('Cancel closes without changing stock, and the form resets for the next product', async ({ page, request }) => {
    const first = await createProduct(request, { name: uniqueName('Adjust A'), stock_quantity: 5 })
    const second = await createProduct(request, { name: uniqueName('Adjust B'), stock_quantity: 5 })
    await page.reload()
    await page.getByRole('button', { name: `Adjust stock for ${first.name}` }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Change in stock').fill('-2')
    await dialog.getByLabel('Reason').fill('Draft')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect((await getProduct(request, first.name))?.stock_quantity).toBe(5)

    await page.getByRole('button', { name: `Adjust stock for ${second.name}` }).click()
    await expect(dialog.getByLabel('Change in stock')).toHaveValue('')
    await expect(dialog.getByLabel('Reason')).toHaveValue('')
  })
})

test.describe('delete product', () => {
  test('confirms and removes the product', async ({ page, request }) => {
    const product = await createProduct(request, { name: uniqueName('Old Biscuits') })
    await page.reload()
    await page.getByRole('button', { name: `Delete ${product.name}` }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Delete product?' })).toBeVisible()
    await expect(dialog).toContainText(`${product.name} will be removed from active inventory.`)
    await dialog.getByRole('button', { name: 'Delete product' }).click()

    await expect(page.getByRole('status')).toHaveText('Product deleted.')
    await expect(row(page, product.name)).toHaveCount(0)
    expect(await getProduct(request, product.name)).toBeUndefined()
  })

  test('Cancel keeps the product', async ({ page, request }) => {
    const product = await createProduct(request, { name: uniqueName('Keep Me') })
    await page.reload()
    await page.getByRole('button', { name: `Delete ${product.name}` }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(row(page, product.name)).toBeVisible()
    expect(await getProduct(request, product.name)).toBeDefined()
  })
})

test('a success message clears when the next action starts', async ({ page, request }) => {
  const product = await createProduct(request, { name: uniqueName('Message') })
  await page.reload()
  await page.getByRole('button', { name: `Delete ${product.name}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete product' }).click()
  await expect(page.getByRole('status')).toHaveText('Product deleted.')
  await page.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('shows an error when products cannot load', async ({ page }) => {
  await page.route((url) => url.pathname === '/api/products', (route) => route.fulfill({ status: 500, json: { data: null, error: 'Unable to load products.' } }))
  await page.reload()
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Unable to load products.')
})
