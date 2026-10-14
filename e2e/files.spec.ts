import { expect, test, type Page } from '@playwright/test'
import { adminContext, anonymousContext, browserContextFor, createStaff, signUpShop } from './auth-helpers'
import { createProduct, getProduct, uniqueName } from './helpers'

// Files in object storage (MinIO): product photos and payment proofs. Each file is served only to
// people allowed to see it, through /api/files/...

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')
const photo = (name = 'photo.png', buffer = PNG, mimeType = 'image/png') => ({ name, mimeType, buffer })
const FILE_URL = /^\/api\/files\/shops\/[0-9a-f-]{36}\/products\/[0-9a-f-]{36}\.png$/

const loaded = (page: Page, alt: string) => page.getByAltText(alt).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)

test('a product photo is uploaded in the form, shown in the list and on the POS', async ({ page, request }) => {
  const name = uniqueName('Photo Tea')
  await page.goto('/inventory')
  await page.getByRole('button', { name: 'Add product' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Product name').fill(name)
  await dialog.getByLabel('Stock quantity').fill('5')
  await dialog.getByLabel('Product photo').setInputFiles(photo())
  await expect(dialog.getByRole('button', { name: 'Change photo' })).toBeVisible()
  await expect.poll(() => loaded(page, `Photo of ${name}`)).toBe(true)
  await dialog.getByRole('button', { name: 'Add product' }).click()
  await expect(dialog).toBeHidden()

  const product = (await getProduct(request, name))!
  expect(product.image_url).toMatch(FILE_URL)
  await expect.poll(() => loaded(page, `Photo of ${name}`)).toBe(true)
  const file = await request.get(product.image_url!)
  expect(file.status()).toBe(200)
  expect(file.headers()['content-type']).toBe('image/png')
  expect(Buffer.from(await file.body()).equals(PNG)).toBe(true)

  await page.goto('/pos')
  await page.getByPlaceholder(/search/i).first().fill(name)
  await expect(page.getByRole('button', { name: new RegExp(name) }).locator('img')).toBeVisible()
})

test('replacing or removing a photo deletes the old file', async ({ page, request }) => {
  const upload = await request.post('/api/products/image', { multipart: { file: photo() } })
  expect(upload.status(), await upload.text()).toBe(201)
  const first = (await upload.json()).data.url as string
  const name = uniqueName('Photo Swap')
  await createProduct(request, { name, image_url: first })

  await page.goto('/inventory')
  await page.getByRole('button', { name: `Edit ${name}` }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Remove photo' }).click()
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(dialog).toBeHidden()
  expect((await getProduct(request, name))?.image_url).toBeNull()
  expect((await request.get(first)).status()).toBe(404)
})

test('uploads are checked by content and size', async ({ request }) => {
  const text = await request.post('/api/products/image', { multipart: { file: photo('fake.png', Buffer.from('not really an image'), 'image/png') } })
  expect(text.status()).toBe(415)
  // Proofs may be PDFs; product photos may not.
  expect((await request.post('/api/products/image', { multipart: { file: photo('doc.pdf', PDF, 'application/pdf') } })).status()).toBe(415)
  const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])
  expect((await request.post('/api/products/image', { multipart: { file: photo('big.png', big) } })).status()).toBe(413)
  expect((await request.post('/api/products/image', { multipart: { other: 'x' } })).status()).toBe(400)
  expect((await request.post('/api/products', { data: { name: uniqueName('Bad Link'), image_url: 'javascript:alert(1)' } })).status()).toBe(400)
})

test('another shop and signed-out visitors cannot see or reuse a shop\'s files', async ({ request }) => {
  const url = (await (await request.post('/api/products/image', { multipart: { file: photo() } })).json()).data.url as string
  const shopB = await signUpShop()
  expect((await shopB.context.get(url)).status()).toBe(404)
  // Guessing paths gets nothing either.
  expect((await shopB.context.get(url.replace(/[0-9a-f]{12}\.png$/, '000000000000.png'))).status()).toBe(404)
  expect((await shopB.context.get('/api/files/../../etc/passwd')).status()).toBe(404)
  const reuse = await shopB.context.post('/api/products', { data: { name: uniqueName('Borrowed Photo'), image_url: url } })
  expect(reuse.status()).toBe(400)
  const visitor = await anonymousContext()
  expect((await visitor.get(url)).status()).toBe(401)
  expect((await (await adminContext()).get(url)).status()).toBe(200)
})

test('an owner sends a payment proof, the admin sees it and recording the payment confirms it', async ({ browser, request }) => {
  const shop = await signUpShop()
  const ownerContext = await browserContextFor(browser, shop.context)
  const page = await ownerContext.newPage()
  await page.goto('/billing')
  await page.getByLabel('Screenshot or PDF').setInputFiles(photo('transfer.png'))
  await page.getByLabel('Note (optional)').fill('1 month via JazzCash TID 998877')
  await page.getByRole('button', { name: 'Send proof' }).click()
  await expect(page.getByRole('status')).toContainText('Proof sent')
  await expect(page.getByText('1 month via JazzCash TID 998877')).toBeVisible()
  await expect(page.getByText('Waiting', { exact: true })).toBeVisible()

  const billing = (await (await shop.context.get('/api/billing')).json()).data
  const proofUrl = billing.proofs[0].url as string
  expect((await shop.context.get(proofUrl)).status()).toBe(200)
  // The main test shop is a different shop.
  expect((await request.get(proofUrl)).status()).toBe(404)

  const admin = await adminContext()
  expect((await admin.get(proofUrl)).status()).toBe(200)
  const adminPage = await (await browserContextFor(browser, admin)).newPage()
  await adminPage.goto('/admin/payments')
  await expect(adminPage.getByRole('heading', { name: /Proofs waiting/ })).toBeVisible()
  await adminPage.getByRole('link', { name: shop.shopName }).first().click()
  await expect(adminPage.getByRole('heading', { name: /Payment proofs \(1\)/ })).toContainText('1 waiting')
  await adminPage.getByRole('button', { name: 'Record payment' }).click()
  await expect(adminPage.getByRole('status')).toContainText('Payment of')
  await expect(adminPage.getByRole('heading', { name: /Payment proofs \(1\)/ })).not.toContainText('waiting')
  await expect(adminPage.getByText('Recorded', { exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByText('Confirmed', { exact: true })).toBeVisible()
})

test('an expired shop can still send a proof, and a staff member cannot', async ({ browser }) => {
  const shop = await signUpShop()
  const manager = await createStaff(shop.context, 'manager')
  expect((await manager.context.post('/api/billing/proofs', { multipart: { file: photo() } })).status()).toBe(403)

  const admin = await adminContext()
  const adminPage = await (await browserContextFor(browser, admin)).newPage()
  await adminPage.goto(`/admin/shops/${shop.shopId}`)
  await adminPage.getByRole('button', { name: 'End subscription now' }).click()
  await expect(adminPage.getByRole('status')).toContainText('Subscription ended')

  expect((await shop.context.post('/api/products/image', { multipart: { file: photo() } })).status()).toBe(402)
  const proof = await shop.context.post('/api/billing/proofs', { multipart: { file: photo('receipt.pdf', PDF, 'application/pdf'), note: 'Renewal' } })
  expect(proof.status(), await proof.text()).toBe(201)
  expect((await proof.json()).data).toMatchObject({ note: 'Renewal', content_type: 'application/pdf', reviewed_at: null })
})
