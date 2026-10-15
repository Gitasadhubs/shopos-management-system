import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { adminContext, browserContextFor, createStaff, signUpShop } from './auth-helpers'
import { createProduct, uniqueName } from './helpers'

// Clicks every button on every screen, as every role, one at a time on a freshly loaded page, and
// every button inside any dialog that opens. After each click: no uncaught error, no server error
// (5xx), no error screen and no blank page. It works in a shop of its own, seeded through the API,
// so whatever it deletes or disables does not touch the shop the other specs share.

test.describe.configure({ mode: 'serial' })

const SCREENS = {
  cashier: ['/dashboard', '/pos', '/sales', '/customers', '/account'],
  manager: ['/dashboard', '/pos', '/sales', '/inventory', '/customers', '/suppliers', '/purchases', '/reports', '/expenses', '/day-end', '/settings', '/account'],
  owner: ['/dashboard', '/pos', '/sales', '/inventory', '/customers', '/suppliers', '/purchases', '/reports', '/expenses', '/day-end', '/settings', '/settings/users', '/billing', '/account'],
} as const
const SIGNED_OUT = ['/login', '/signup', '/forgot-password', '/reset-password?token=not-a-real-token', '/verify-email?token=not-a-real-token', '/accept-invite?token=not-a-real-token']
// Signing out ends the session the rest of the crawl runs in; auth.spec covers it.
const SKIP = /^(sign out|log out)$/i
const ERROR_SCREEN = /Application error|Unhandled Runtime Error|Internal Server Error|This page could not be found|could not be loaded/i

type Seed = { owner: APIRequestContext; manager: APIRequestContext; cashier: APIRequestContext; shopId: string; names: string[] }
let seed: Seed

test.beforeAll(async () => {
  test.setTimeout(240_000)
  const shop = await signUpShop(uniqueName('Crawl Shop'))
  const owner = shop.context
  const apple = await createProduct(owner, { name: uniqueName('Crawl Apple'), stock_quantity: 40, reorder_level: 2 })
  const salt = await createProduct(owner, { name: uniqueName('Crawl Salt'), stock_quantity: 1, reorder_level: 5, sku: `CR-${Date.now().toString(36)}` })
  const post = async (path: string, data: object) => {
    const response = await owner.post(path, { data })
    expect(response.status(), `${path}: ${await response.text()}`).toBe(201)
    return (await response.json()).data
  }
  const customer = await post('/api/customers', { name: uniqueName('Crawl Customer'), phone: '0300 1112223' })
  const supplier = await post('/api/suppliers', { name: uniqueName('Crawl Supplier'), phone: '0300 4445556' })
  await post('/api/sales', { items: [{ product_id: apple.id, quantity: 2 }], payment_method: 'cash' })
  await post('/api/sales', { items: [{ product_id: apple.id, quantity: 3 }], payment_method: 'credit', customer_id: customer.id, amount_paid: 0 })
  await post('/api/purchases', { supplier_id: supplier.id, items: [{ product_id: salt.id, quantity: 4, unit_cost: 50 }], amount_paid: 0 })
  await post('/api/expenses', { category: 'Rent', amount: 500, note: 'Crawl rent', spent_on: new Date().toISOString().slice(0, 10) })
  const manager = await createStaff(owner, 'manager')
  const cashier = await createStaff(owner, 'cashier')
  seed = { owner, manager: manager.context, cashier: cashier.context, shopId: shop.shopId, names: [apple.name, salt.name, customer.name, supplier.name, manager.full_name, cashier.full_name, shop.shopName] }
})

test.afterAll(async () => {
  await Promise.all([seed?.owner.dispose(), seed?.manager.dispose(), seed?.cashier.dispose()])
})

// Tags every visible button (and button-like control) with a stable id: its name with the seeded
// names replaced, plus which occurrence it is. Repeated row buttons ("Edit <product>") collapse
// to their first occurrence, so the crawl stays a reasonable size.
async function tagButtons(page: Page, scope: string, names: string[]) {
  return page.evaluate(({ scope, names }) => {
    const root = scope === 'dialog' ? [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].pop() : document.body
    if (!root) return []
    const visible = (el: Element) => {
      const box = el.getBoundingClientRect()
      return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"], [inert]')
    }
    const seen = new Map<string, number>()
    const found: Array<{ id: string; label: string; disabled: boolean }> = []
    for (const control of root.querySelectorAll('button, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="combobox"], summary')) {
      // Visually hidden switches (sr-only inputs) are pressed through their visible label, as a person would.
      const labels = (control as HTMLInputElement).labels
      const hidden = control.tagName === 'INPUT' && control.getBoundingClientRect().width <= 1
      const el = hidden && labels?.length ? labels[0] : control
      if (!visible(el)) continue
      if (scope !== 'dialog' && el.closest('[role="dialog"], [role="alertdialog"]')) continue
      let label = (control.getAttribute('aria-label') || (control as HTMLElement).innerText || (labels?.[0] as HTMLElement | undefined)?.innerText || control.getAttribute('title') || '').replace(/\s+/g, ' ').trim()
      for (const name of names) label = label.split(name).join('<seeded>')
      label = label.replace(/\d[\d,.]*/g, '#').slice(0, 80) || `(${control.tagName.toLowerCase()} without a name)`
      const occurrence = seen.get(label) ?? 0
      seen.set(label, occurrence + 1)
      if (occurrence > 0) continue
      const id = `${scope}:${label}`
      el.setAttribute('data-crawl', id)
      // :disabled also covers controls inside a disabled <fieldset> (read-only forms).
      const disabled = control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true'
      found.push({ id, label, disabled })
    }
    return found
  }, { scope, names })
}

const anyDialog = (page: Page) => page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').last()

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await page.locator('main, form').first().waitFor({ timeout: 30_000 })
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined)
  // Screens show shimmer placeholders, spinners or "Loading…" until their data arrives; the buttons
  // that matter (product tiles, rows) only exist after that.
  await page.waitForFunction(() => {
    const main = document.querySelector('main') ?? document.body
    return !main.querySelector('.shopos-shimmer') && !/Loading( [a-z]+)?…/.test(main.textContent ?? '')
  }, null, { timeout: 15_000 }).catch(() => undefined)
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => undefined)
  await page.waitForTimeout(250)
}

async function crawl(browser: Browser, api: APIRequestContext | null, paths: readonly string[], who: string) {
  const context = api ? await browserContextFor(browser, api) : await browser.newContext({ baseURL: test.info().project.use.baseURL, ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  const problems: string[] = []
  let step = ''
  page.on('pageerror', (error) => problems.push(`${step} → uncaught error: ${error.message}`))
  page.on('response', (response) => {
    if (response.status() >= 500) problems.push(`${step} → ${response.status()} from ${response.request().method()} ${new URL(response.url()).pathname}`)
  })
  // Native confirm() and prompt() are cancelled; in-app dialogs are crawled like any screen.
  page.on('dialog', (dialog) => void dialog.dismiss().catch(() => undefined))
  // Printing a receipt would open the print preview.
  await context.addInitScript(() => { window.print = () => undefined })

  const check = async () => {
    const text = (await page.locator('body').innerText().catch(() => '')).trim()
    if (text.length < 20) problems.push(`${step} → blank page at ${new URL(page.url()).pathname}`)
    else if (ERROR_SCREEN.test(text)) problems.push(`${step} → error screen at ${new URL(page.url()).pathname}: ${text.match(ERROR_SCREEN)![0]}`)
  }
  const click = async (selector: string) => {
    await page.locator(selector).first().click({ timeout: 5_000 }).catch((error: Error) => problems.push(`${step} → could not click: ${error.message.split('\n')[0]}`))
    await settle(page)
    await check()
  }

  const summary: string[] = []
  for (const path of paths) {
    step = `${who} ${path}`
    await open(page, path)
    await check()
    const buttons = await tagButtons(page, 'page', seed.names)
    let clicked = 0
    let inDialogs = 0
    let disabled = 0
    for (const button of buttons) {
      if (button.disabled) { disabled += 1; continue }
      if (SKIP.test(button.label)) continue
      step = `${who} ${path} [${button.label}]`
      await open(page, path)
      if (!(await tagButtons(page, 'page', seed.names)).some((item) => item.id === button.id && !item.disabled)) continue
      await click(`[data-crawl="${CSS.escape(button.id)}"]`)
      clicked += 1
      if (!(await anyDialog(page).isVisible().catch(() => false))) continue

      // A dialog opened: press each of its buttons too, each time from a fresh page.
      const inner = await tagButtons(page, 'dialog', seed.names)
      for (const item of inner) {
        if (item.disabled || SKIP.test(item.label)) continue
        step = `${who} ${path} [${button.label}] → [${item.label}]`
        await open(page, path)
        if (!(await tagButtons(page, 'page', seed.names)).some((entry) => entry.id === button.id && !entry.disabled)) break
        await page.locator(`[data-crawl="${CSS.escape(button.id)}"]`).first().click({ timeout: 5_000 }).catch(() => undefined)
        if (!(await anyDialog(page).waitFor({ timeout: 3_000 }).then(() => true).catch(() => false))) break
        if (!(await tagButtons(page, 'dialog', seed.names)).some((entry) => entry.id === item.id && !entry.disabled)) continue
        await click(`[data-crawl="${CSS.escape(item.id)}"]`)
        inDialogs += 1
      }
    }
    summary.push(`${path}: ${clicked} buttons${inDialogs ? ` + ${inDialogs} in dialogs` : ''}${disabled ? ` (${disabled} disabled)` : ''}`)
  }
  console.log(`[buttons] ${who}: ${summary.join(' · ')}`)
  await context.close()
  expect(problems, problems.join('\n')).toEqual([])
}

// CSS.escape exists in browsers; Node needs it for the selectors built above.
const CSS = { escape: (value: string) => value.replace(/["\\]/g, '\\$&') }

// Owner last: the owner can disable staff, which would end the manager's and cashier's sessions.
test('every button works for a cashier', async ({ browser }) => {
  test.setTimeout(900_000)
  await crawl(browser, seed.cashier, SCREENS.cashier, 'cashier')
})

test('every button works for a manager', async ({ browser }) => {
  test.setTimeout(1_500_000)
  await crawl(browser, seed.manager, SCREENS.manager, 'manager')
})

test('every button works for the owner', async ({ browser }) => {
  test.setTimeout(1_800_000)
  await crawl(browser, seed.owner, SCREENS.owner, 'owner')
})

test('every button works for the platform admin', async ({ browser }) => {
  test.setTimeout(900_000)
  const admin = await adminContext()
  try {
    await crawl(browser, admin, ['/admin', '/admin/shops', `/admin/shops/${seed.shopId}`, '/admin/payments', '/admin/subscriptions', '/admin/account'], 'admin')
  } finally {
    await admin.dispose()
  }
})

test('every button works when signed out', async ({ browser }) => {
  test.setTimeout(600_000)
  await crawl(browser, null, SIGNED_OUT, 'signed out')
})
