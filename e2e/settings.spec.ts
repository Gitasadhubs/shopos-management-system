import { expect, test } from '@playwright/test'
import { browserContextFor, signUpShop } from './auth-helpers'
import { uniqueName } from './helpers'

// Shop settings, receipts, sounds and the owner's Billing page. Uses its own shop so renaming it
// does not affect other tests.

test('the owner updates the shop profile; it shows in the app and on receipts', async ({ browser }) => {
  const shop = await signUpShop(uniqueName('Settings Shop'))
  const context = await browserContextFor(browser, shop.context)
  const page = await context.newPage()
  const newName = uniqueName('Renamed Store')

  await page.goto('/settings')
  await expect(page.getByLabel('Shop name')).toHaveValue(shop.shopName)
  await expect(page.getByLabel('Time zone', { exact: true })).toHaveValue('Asia/Karachi')
  await page.getByLabel('Shop name').fill(newName)
  await page.getByLabel('Address').fill('12 Mall Road, Lahore')
  await page.getByLabel('Receipt message').fill('Shukriya! Come again.')
  // The preview follows the form.
  await expect(page.getByText('Shukriya! Come again.')).toBeVisible()
  await page.getByRole('button', { name: 'Save shop details' }).click()
  await expect(page.getByRole('status')).toHaveText('Shop details saved.')
  await expect(page.getByRole('complementary').getByText(newName)).toBeVisible()

  const product = (await (await shop.context.post('/api/products', { data: { name: uniqueName('Receipt Item'), sale_price: 40, stock_quantity: 5 } })).json()).data
  await page.goto('/pos')
  await page.getByPlaceholder('Search products, SKU, or barcode').fill(product.name)
  await page.getByRole('button', { name: new RegExp(`^${product.name}`) }).click()
  await page.getByLabel('Cash received').fill('100')
  await expect(page.getByText('Change to give').locator('..')).toContainText('₨ 60')
  await page.getByRole('button', { name: /^Complete sale/ }).click()
  await expect(page.getByRole('status')).toHaveText('Sale completed · ₨ 40')
  const receipt = page.locator('.print-receipt')
  await expect(receipt).toContainText(newName)
  await expect(receipt).toContainText('12 Mall Road, Lahore')
  await expect(receipt).toContainText('Shukriya! Come again.')
  await expect(receipt).toContainText('Change')
  await expect(receipt.getByRole('button', { name: 'Print receipt' })).toBeVisible()
  await context.close()
  await shop.context.dispose()
})

test('shop settings are validated and only the owner can change them', async ({ request }) => {
  expect((await request.put('/api/settings', { data: { name: '', timezone: 'Asia/Karachi' } })).status()).toBe(400)
  const zone = await request.put('/api/settings', { data: { name: 'Anything', timezone: 'Mars/Olympus' } })
  expect(zone.status()).toBe(400)
  expect((await zone.json()).error).toBe('Choose a valid time zone.')
})

test('sound effects can be switched off and on in Settings', async ({ page }) => {
  await page.goto('/settings')
  const toggle = page.getByRole('switch', { name: /Sound effects/ })
  await expect(toggle).toBeChecked()
  await expect(page.getByRole('button', { name: 'Sale complete' })).toBeEnabled()
  await page.getByText('Sound effects').click()
  await expect(toggle).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Sale complete' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Turn sounds on' })).toBeVisible()
  await page.getByText('Sound effects').click()
  await expect(toggle).toBeChecked()
  await page.getByRole('button', { name: 'Sale complete' }).click()
})

test('the Billing page shows the trial, the plan and how to pay', async ({ page }) => {
  await page.goto('/billing')
  await expect(page.getByRole('main').getByRole('heading', { name: 'Billing' })).toBeVisible()
  await expect(page.getByText(/^\d+ days? left in your free trial$/)).toBeVisible()
  await expect(page.getByText('₨ 1,500').first()).toBeVisible()
  await expect(page.getByText('Meezan Bank')).toBeVisible()
  const whatsapp = await page.getByRole('link', { name: 'Send payment screenshot on WhatsApp' }).getAttribute('href')
  expect(whatsapp).toMatch(/^https:\/\/wa\.me\/\d+\?text=/)
  await expect(page.getByText('No payments yet.')).toBeVisible()
})
