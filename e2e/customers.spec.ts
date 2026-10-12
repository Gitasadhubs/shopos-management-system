import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { createProduct, getProduct, uniqueName } from './helpers'

// Customers and their khata (credit): sales on credit, part payments, payments received, the ledger.

type Customer = { id: string; name: string; phone: string | null; balance: number }

async function createCustomer(request: APIRequestContext, data: Partial<Customer> & { name: string }) {
  const response = await request.post('/api/customers', { data })
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json()).data as Customer
}

async function balanceOf(request: APIRequestContext, id: string) {
  return ((await (await request.get(`/api/customers/${id}`)).json()).data.party as Customer).balance
}

test.describe('customers API', () => {
  test('validates and trims customer details', async ({ request }) => {
    expect((await request.post('/api/customers', { data: { name: '  ' } })).status()).toBe(400)
    expect((await request.post('/api/customers', { data: { name: 'x'.repeat(161) } })).status()).toBe(400)
    const customer = await createCustomer(request, { name: `  ${uniqueName('Trim')}  `, phone: ' 0300 1112223 ' })
    expect(customer.name).not.toMatch(/^\s|\s$/)
    expect(customer).toMatchObject({ phone: '0300 1112223', balance: 0 })
    expect((await request.get('/api/customers/not-a-uuid')).status()).toBe(404)
  })

  test('a credit sale puts the unpaid part on the khata and payments bring it down', async ({ request }) => {
    const customer = await createCustomer(request, { name: uniqueName('Khata Ali') })
    const product = await createProduct(request, { name: uniqueName('Khata Rice'), sale_price: 250, stock_quantity: 10 })

    const sale = await request.post('/api/sales', { data: { customer_id: customer.id, items: [{ product_id: product.id, quantity: 4 }], payment_method: 'credit', amount_paid: 200 } })
    expect(sale.status(), await sale.text()).toBe(201)
    expect((await sale.json()).data).toMatchObject({ total: 1000, amount_paid: 200, credit_amount: 800, change_given: 0, customer_name: customer.name })
    expect(await balanceOf(request, customer.id)).toBe(800)

    // Paying more than the total, or more than is owed, is refused.
    expect((await request.post('/api/sales', { data: { customer_id: customer.id, items: [{ product_id: product.id, quantity: 1 }], payment_method: 'credit', amount_paid: 300 } })).status()).toBe(400)
    const over = await request.post(`/api/customers/${customer.id}/payment`, { data: { amount: 801 } })
    expect(over.status()).toBe(400)
    expect((await over.json()).error).toContain('more than the balance')
    expect((await request.post(`/api/customers/${customer.id}/payment`, { data: { amount: 0 } })).status()).toBe(400)

    expect((await request.post(`/api/customers/${customer.id}/payment`, { data: { amount: 300, note: 'JazzCash' } })).status()).toBe(201)
    expect(await balanceOf(request, customer.id)).toBe(500)

    const ledger = (await (await request.get(`/api/customers/${customer.id}`)).json()).data.entries as Array<{ kind: string; amount: number; note: string }>
    expect(ledger.map((entry) => [entry.kind, entry.amount])).toEqual([['payment', -300], ['sale', 800]])
    expect(ledger[0].note).toBe('JazzCash')
    expect((await getProduct(request, product.name))?.stock_quantity).toBe(6)
  })

  test('a cash sale to a known customer does not touch the khata', async ({ request }) => {
    const customer = await createCustomer(request, { name: uniqueName('Cash Buyer') })
    const product = await createProduct(request, { name: uniqueName('Cash Soap'), sale_price: 80 })
    const sale = await request.post('/api/sales', { data: { customer_id: customer.id, items: [{ product_id: product.id, quantity: 1 }], payment_method: 'cash', amount_paid: 100 } })
    expect((await sale.json()).data).toMatchObject({ credit_amount: 0, change_given: 20, customer_name: customer.name })
    expect(await balanceOf(request, customer.id)).toBe(0)
  })

  test('a customer who owes money cannot be removed until settled', async ({ request }) => {
    const customer = await createCustomer(request, { name: uniqueName('Settle First') })
    const product = await createProduct(request, { name: uniqueName('Settle Item'), sale_price: 60 })
    await request.post('/api/sales', { data: { customer_id: customer.id, items: [{ product_id: product.id, quantity: 1 }], payment_method: 'credit' } })
    const blocked = await request.delete(`/api/customers/${customer.id}`)
    expect(blocked.status()).toBe(409)
    expect((await blocked.json()).error).toContain('Settle the balance')
    await request.post(`/api/customers/${customer.id}/payment`, { data: { amount: 60 } })
    expect((await request.delete(`/api/customers/${customer.id}`)).ok()).toBe(true)
    const list = (await (await request.get(`/api/customers?search=${encodeURIComponent(customer.name)}`)).json()).data
    expect(list).toEqual([])
    // Archived customers cannot be sold to on credit.
    expect((await request.post('/api/sales', { data: { customer_id: customer.id, items: [{ product_id: product.id, quantity: 1 }], payment_method: 'credit' } })).status()).toBe(404)
  })
})

test.describe('customers page', () => {
  async function openCustomers(page: Page, search: string) {
    await page.goto('/customers')
    await expect(page.getByRole('main').getByRole('heading', { name: 'Customers' })).toBeVisible()
    await page.getByLabel('Search customers').fill(search)
  }

  test('adds, edits and removes a customer', async ({ page }) => {
    const name = uniqueName('Sana Bibi')
    await page.goto('/customers')
    await page.getByRole('button', { name: 'Add customer' }).first().click()
    await page.getByRole('dialog').getByLabel('Name').fill(name)
    await page.getByRole('dialog').getByLabel('Phone').fill('0301 2345678')
    await page.getByRole('dialog').getByLabel('Address').fill('Main Bazaar')
    await page.getByRole('dialog').getByRole('button', { name: 'Add customer' }).click()
    await expect(page.getByRole('status')).toHaveText(`${name} added.`)
    await page.getByLabel('Search customers').fill(name)
    const row = page.getByRole('listitem').filter({ hasText: name })
    await expect(row).toContainText('0301 2345678 · Main Bazaar')
    await expect(row).toContainText('Settled')

    await page.getByRole('button', { name: `Edit ${name}` }).click()
    await expect(page.getByRole('dialog').getByLabel('Name')).toHaveValue(name)
    await page.getByRole('dialog').getByLabel('Address').fill('Liberty Market')
    await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toHaveText(`${name} updated.`)
    await expect(row).toContainText('Liberty Market')

    await page.getByRole('button', { name: `Remove ${name}` }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(row).toBeVisible()
    await page.getByRole('button', { name: `Remove ${name}` }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Remove customer' }).click()
    await expect(page.getByRole('status')).toHaveText(`${name} removed.`)
    await expect(page.getByText(`No customers match “${name}”.`)).toBeVisible()
  })

  test('a khata sale from the POS, then receiving the payment', async ({ page, request }) => {
    const customer = await createCustomer(request, { name: uniqueName('Bilal Khata'), phone: '0333 7654321' })
    const product = await createProduct(request, { name: uniqueName('Khata Ghee'), sale_price: 450, stock_quantity: 5 })

    await page.goto('/pos')
    await page.getByPlaceholder('Search products, SKU, or barcode').fill(product.name)
    await page.getByRole('button', { name: new RegExp(`^${product.name}`) }).click()
    await page.getByRole('button', { name: new RegExp(`^${product.name}`) }).click()
    await page.getByLabel('Payment method').click()
    await page.getByRole('option', { name: 'Credit (khata)' }).click()
    // Credit needs a customer.
    await page.getByRole('button', { name: /^Complete sale/ }).click()
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('Choose a customer for a credit (khata) sale.')
    await page.getByLabel('Customer').selectOption({ label: customer.name })
    await page.getByLabel('Paid now').fill('100')
    await expect(page.getByText(`₨ 800 goes on ${customer.name}'s khata.`)).toBeVisible()
    await page.getByRole('button', { name: /^Complete sale/ }).click()
    await expect(page.getByRole('status')).toHaveText('Sale completed · ₨ 900')
    await expect(page.getByText(`On khata (${customer.name})`)).toBeVisible()
    expect(await balanceOf(request, customer.id)).toBe(800)

    await page.goto('/customers')
    await page.getByLabel('Search customers').fill(customer.name)
    const row = page.getByRole('listitem').filter({ hasText: customer.name })
    await expect(row).toContainText('Owes you ₨ 800')
    // A WhatsApp reminder with the balance, to the number in international format.
    const reminder = await page.getByRole('link', { name: `Send WhatsApp reminder to ${customer.name}` }).getAttribute('href')
    expect(reminder).toContain('https://wa.me/923337654321?text=')
    expect(decodeURIComponent(reminder!)).toContain('your balance is ₨ 800')

    await page.getByRole('button', { name: `Receive payment: ${customer.name}` }).click()
    await expect(page.getByRole('dialog').getByLabel('Amount')).toHaveValue('800')
    await page.getByRole('dialog').getByLabel('Amount').fill('500')
    await page.getByRole('dialog').getByLabel('Note').fill('Cash at counter')
    await page.getByRole('dialog').getByRole('button', { name: 'Record payment' }).click()
    await expect(page.getByRole('status')).toHaveText(`Payment of ₨ 500 recorded for ${customer.name}.`)
    await expect(row).toContainText('Owes you ₨ 300')

    await page.getByRole('button', { name: `Ledger for ${customer.name}` }).click()
    const ledger = page.getByRole('dialog')
    await expect(ledger.getByRole('heading')).toHaveText(`Ledger · ${customer.name}`)
    await expect(ledger.getByRole('listitem')).toHaveCount(2)
    await expect(ledger.getByRole('listitem').first()).toContainText('Cash at counter')
    await expect(ledger.getByRole('listitem').first()).toContainText('−₨ 500')
    await expect(ledger.getByRole('listitem').last()).toContainText('+₨ 800')
    await ledger.getByRole('button', { name: 'Close' }).last().click()
    await expect(ledger).toBeHidden()

    await openCustomers(page, customer.name)
    await expect(page.getByText('Customers owe you').locator('..')).toContainText('₨')
  })
})
