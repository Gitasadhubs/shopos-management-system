import { expect, test, type APIRequestContext } from '@playwright/test'
import { browserContextFor, latestEmail, signUpShop } from './auth-helpers'
import { uniqueName } from './helpers'

// Expenses and the day-end report (in the app, shared on WhatsApp, emailed, and sent on a schedule).
// Each test uses its own shop so the figures are exact.

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date())

async function product(api: APIRequestContext, name: string, cost: number, price: number) {
  return (await (await api.post('/api/products', { data: { name, cost_price: cost, sale_price: price, stock_quantity: 50, reorder_level: 0 } })).json()).data
}

test('expenses: validated, listed by month and category, and deleted', async () => {
  const shop = await signUpShop(uniqueName('Expense Shop'))
  const api = shop.context
  const day = today()
  expect((await api.post('/api/expenses', { data: { category: 'Rent', amount: 0, spent_on: day } })).status()).toBe(400)
  expect((await api.post('/api/expenses', { data: { category: 'Holidays', amount: 10, spent_on: day } })).status()).toBe(400)
  expect((await api.post('/api/expenses', { data: { category: 'Rent', amount: 10, spent_on: '2999-01-01' } })).status()).toBe(400)
  expect((await api.post('/api/expenses', { data: { category: 'Rent', amount: 10, spent_on: 'today' } })).status()).toBe(400)

  const rent = (await (await api.post('/api/expenses', { data: { category: 'Rent', amount: 30000, note: 'October rent', spent_on: day } })).json()).data
  await api.post('/api/expenses', { data: { category: 'Tea & food', amount: 250, spent_on: day } })
  await api.post('/api/expenses', { data: { category: 'Tea & food', amount: 150.5, spent_on: day } })
  const list = (await (await api.get('/api/expenses')).json()).data
  expect(list.total).toBe(30400.5)
  expect(list.byCategory).toEqual([{ category: 'Rent', total: 30000 }, { category: 'Tea & food', total: 400.5 }])
  expect(list.expenses[0]).toMatchObject({ spent_on: day })

  // Another shop cannot see or delete them.
  const other = await signUpShop()
  expect((await (await other.context.get('/api/expenses')).json()).data.expenses).toEqual([])
  expect((await other.context.delete(`/api/expenses/${rent.id}`)).status()).toBe(404)
  expect((await api.delete(`/api/expenses/${rent.id}`)).ok()).toBe(true)
  expect((await (await api.get('/api/expenses')).json()).data.total).toBe(400.5)
  await Promise.all([api.dispose(), other.context.dispose()])
})

test('the day-end report adds up sales, profit, expenses, khata and the cash drawer', async () => {
  const shop = await signUpShop(uniqueName('Closing Shop'))
  const api = shop.context
  const tea = await product(api, 'Closing Tea', 60, 100)
  const oil = await product(api, 'Closing Oil', 400, 500)
  const customer = (await (await api.post('/api/customers', { data: { name: 'Closing Khata' } })).json()).data
  const supplier = (await (await api.post('/api/suppliers', { data: { name: 'Closing Supplier' } })).json()).data

  await api.post('/api/sales', { data: { items: [{ product_id: tea.id, quantity: 5 }], payment_method: 'cash' } }) // 500, cost 300
  await api.post('/api/sales', { data: { items: [{ product_id: oil.id, quantity: 1 }], payment_method: 'card' } }) // 500, cost 400
  await api.post('/api/sales', { data: { customer_id: customer.id, items: [{ product_id: oil.id, quantity: 2 }], payment_method: 'credit', amount_paid: 300 } }) // 1000, cost 800, 700 on khata
  await api.post(`/api/customers/${customer.id}/payment`, { data: { amount: 200 } })
  await api.post('/api/purchases', { data: { supplier_id: supplier.id, amount_paid: 100, items: [{ product_id: tea.id, quantity: 10, unit_cost: 60 }] } })
  await api.post('/api/expenses', { data: { category: 'Electricity & gas', amount: 150, spent_on: today() } })

  const body = (await (await api.get('/api/day-end')).json()).data
  expect(body.report).toMatchObject({
    sales: { revenue: 2000, count: 3, cogs: 1500 },
    methods: { cash: 500, card: 500, credit: 1000 },
    grossProfit: 500,
    netProfit: 350,
    khata: { given: 700, received: 200 },
    suppliers: { purchases: 600, paid: 100 },
    // In: 500 cash + 300 paid on the credit sale + 200 khata received. Out: 100 supplier + 150 expense.
    cash: { in: 1000, out: 250, expected: 750 },
  })
  expect(body.report.topItems[0]).toMatchObject({ name: 'Closing Tea', quantity: 5 })
  expect(body.text).toContain(`*${shop.shopName} — day-end report*`)
  expect(body.text).toContain('💰 Sales: ₨ 2,000 (3 sales)')
  expect(body.text).toContain('✅ Net profit: ₨ 350')
  expect(body.text).toContain('🗄️ Cash expected in drawer: ₨ 750')
  expect(body.delivery).toMatchObject({ enabled: false, whatsapp_api: false })

  expect((await api.get('/api/day-end?day=2999-01-01')).status()).toBe(400)
  expect((await (await api.get('/api/day-end?day=2020-01-01')).json()).data.report.sales.count).toBe(0)
  await api.dispose()
})

test('send now emails the report; WhatsApp numbers wait for the Business API', async () => {
  const shop = await signUpShop(uniqueName('Sender Shop'))
  const api = shop.context
  const tea = await product(api, 'Sender Tea', 10, 25)
  await api.post('/api/sales', { data: { items: [{ product_id: tea.id, quantity: 4 }], payment_method: 'cash' } })

  // Settings validate the numbers, time and email.
  expect((await api.put('/api/settings', { data: { report_whatsapp: 'not a number' } })).status()).toBe(400)
  expect((await api.put('/api/settings', { data: { report_time: '25:00' } })).status()).toBe(400)
  expect((await api.put('/api/settings', { data: { report_email: 'nope' } })).status()).toBe(400)
  const saved = await api.put('/api/settings', { data: { report_whatsapp: '0300 1234567', report_email: '' } })
  expect((await saved.json()).data).toMatchObject({ report_whatsapp: '0300 1234567', report_email: null, name: shop.shopName })

  const sentAt = Date.now() - 1000
  const sent = await api.post('/api/day-end/send', { data: {} })
  expect(sent.status(), await sent.text()).toBe(200)
  const deliveries = (await sent.json()).data.deliveries
  expect(deliveries).toEqual([
    { channel: 'email', recipient: shop.email, status: 'sent' },
    expect.objectContaining({ channel: 'whatsapp', recipient: '0300 1234567', status: 'skipped' }),
  ])
  const email = await latestEmail(shop.email, 'day-end report', sentAt)
  expect(email.subject).toContain(shop.shopName)
  expect(email.text).toContain('💰 Sales: ₨ 100 (1 sale)')

  const log = (await (await api.get('/api/day-end')).json()).data.deliveries
  expect(log.map((entry: { channel: string; status: string }) => `${entry.channel}:${entry.status}`).sort()).toEqual(['email:sent', 'whatsapp:skipped'])
  await api.dispose()
})

test('the automatic report goes out once at the chosen time', async () => {
  test.slow()
  const shop = await signUpShop(uniqueName('Scheduled Shop'))
  const api = shop.context
  const enabledAt = Date.now() - 1000
  // 00:00 has always passed, so the next scheduler tick (every minute) sends today's report.
  expect((await api.put('/api/settings', { data: { report_enabled: true, report_time: '00:00' } })).ok()).toBe(true)
  const email = await latestEmail(shop.email, 'day-end report', enabledAt, 90_000)
  expect(email.subject).toContain(shop.shopName)
  await expect.poll(async () => (await (await api.get('/api/settings')).json()).data.report_last_sent_on, { timeout: 15_000 }).toBe(today())
  await api.dispose()
})

test('day-end page: drawer count, WhatsApp share and settings', async ({ browser }) => {
  test.slow()
  const shop = await signUpShop(uniqueName('Drawer Shop'))
  const tea = await product(shop.context, 'Drawer Tea', 50, 120)
  await shop.context.post('/api/sales', { data: { items: [{ product_id: tea.id, quantity: 3 }], payment_method: 'cash' } })
  await shop.context.post('/api/expenses', { data: { category: 'Tea & food', amount: 60, spent_on: today() } })
  const context = await browserContextFor(browser, shop.context)
  const page = await context.newPage()

  await page.goto('/dashboard')
  await page.getByRole('link', { name: 'Close the day' }).click()
  await expect(page).toHaveURL(/\/day-end$/)
  await expect(page.getByLabel('Net profit ₨ 150')).toBeVisible()
  await expect(page.getByText('Expected in drawer').locator('..')).toContainText('₨ 300')
  await page.getByLabel('Cash you counted (optional)').fill('280')
  await expect(page.getByRole('note')).toHaveText('Short by ₨ 20')
  await page.getByLabel('Cash you counted (optional)').fill('300')
  await expect(page.getByRole('note')).toHaveText('Drawer matches exactly. 👍')

  const share = await page.getByRole('link', { name: 'Share on WhatsApp' }).getAttribute('href')
  expect(share).toMatch(/^https:\/\/wa\.me\/\?text=/)
  expect(decodeURIComponent(share!.split('text=')[1])).toContain(`${shop.shopName} — day-end report`)

  await page.getByRole('button', { name: 'Previous day' }).click()
  await expect(page.getByText('Nothing sold on this day.')).toBeVisible()
  await page.getByRole('button', { name: 'Today' }).click()
  await expect(page.getByText('Drawer Tea')).toBeVisible()

  await page.getByRole('button', { name: 'Send now' }).click()
  await expect(page.getByRole('status')).toContainText(`Report sent to ${shop.email}`)

  await page.getByRole('link', { name: 'Day-end report settings' }).click()
  await expect(page).toHaveURL(/\/settings#day-end$/)
  await page.getByLabel('Daily sales target (₨)').fill('1000')
  await page.getByText('Send the day-end report automatically').click()
  await page.getByLabel('Send at').fill('21:30')
  await page.getByRole('button', { name: 'Save report settings' }).click()
  await expect(page.getByText('Saved. The day-end report goes out every day at 21:30.')).toBeVisible()

  await page.goto('/dashboard')
  await expect(page.getByRole('img', { name: '36% of the daily target' })).toBeVisible()
  await expect(page.getByText('₨ 640 to go')).toBeVisible()
  await context.close()
  await shop.context.dispose()
})

test('a new shop sees a getting-started checklist that can be hidden', async ({ browser }) => {
  const shop = await signUpShop(uniqueName('Checklist Shop'))
  const context = await browserContextFor(browser, shop.context)
  const page = await context.newPage()
  await page.goto('/dashboard')
  const card = page.getByText('Get your shop ready').locator('../../..')
  await expect(card).toContainText('0 of 6 done')
  await shop.context.post('/api/products', { data: { name: 'First product' } })
  await page.reload()
  await expect(card).toContainText('1 of 6 done')
  await card.getByRole('link', { name: 'Make your first sale' }).click()
  await expect(page).toHaveURL(/\/pos$/)
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Hide' }).click()
  await expect(page.getByText('Get your shop ready')).toBeHidden()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 2 })).toBeVisible()
  await expect(page.getByText('Get your shop ready')).toHaveCount(0)
  await context.close()
  await shop.context.dispose()
})

test('expenses page: add with category chips, then delete', async ({ page }) => {
  const note = uniqueName('Generator fuel')
  await page.goto('/expenses')
  await expect(page.getByRole('main').getByRole('heading', { name: 'Expenses' })).toBeVisible()
  await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'Electricity & gas' }).click()
  await expect(page.getByRole('button', { name: 'Electricity & gas' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Amount (₨)').fill('1200')
  await page.getByLabel('Note').fill(note)
  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(page.getByRole('status')).toHaveText('Electricity & gas expense of ₨ 1,200 saved.')
  const row = page.getByRole('listitem').filter({ hasText: note })
  await expect(row).toContainText('₨ 1,200')
  await row.getByRole('button', { name: /^Delete Electricity & gas expense/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete expense' }).click()
  await expect(page.getByRole('status')).toHaveText('Expense deleted.')
  await expect(page.getByText(note)).toHaveCount(0)
})
