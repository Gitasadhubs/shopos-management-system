import { expect, test } from '@playwright/test'
import { OWNER } from './auth-helpers'
import { trackErrors } from './helpers'

test('health endpoint reports MariaDB storage and is not cached', async ({ request }) => {
  const response = await request.get('/api/health')
  expect(response.ok()).toBe(true)
  expect(response.headers()['cache-control']).toContain('no-store')
  expect(await response.json()).toMatchObject({ ok: true, storage: 'mariadb' })
})

for (const path of ['/', '/dashboard', '/inventory', '/pos', '/sales', '/account', '/settings/users', '/offline', '/sync-log', '/settings/sync-log', '/customers', '/suppliers', '/purchases', '/reports', '/settings', '/billing', '/expenses', '/day-end']) {
  test(`${path} loads without errors`, async ({ page }) => {
    const errors = trackErrors(page)
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    await page.waitForLoadState('networkidle')
    expect(errors).toEqual([])
  })
}

test('root path shows the dashboard with the shop and its trial', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 2 })).toBeVisible()
  const banner = page.getByRole('banner')
  await expect(banner.getByText(OWNER.shop)).toBeVisible()
  await expect(banner.getByRole('link', { name: /^Trial · \d+ days? left$/ })).toBeVisible()
})

test('sidebar shows the signed-in owner and every workspace link', async ({ page }) => {
  await page.goto('/dashboard')
  const sidebar = page.getByRole('complementary')
  await expect(sidebar.getByText(OWNER.name)).toBeVisible()
  await expect(sidebar.getByText('owner', { exact: true })).toBeVisible()
  await expect(sidebar.getByRole('navigation').getByRole('link')).toHaveText(['Dashboard', 'POS', 'Sales', 'Inventory', 'Customers', 'Suppliers', 'Purchases', 'Expenses', 'Reports', 'Day end', 'Staff', 'Settings', 'Billing', 'Account'])
  await expect(sidebar.getByRole('button', { name: 'Sign out' })).toBeVisible()
})

test('every sidebar link opens its page with a matching title', async ({ page }) => {
  const pages: Array<[string, string, RegExp]> = [
    ['Sales', '/sales', /^Sales$/], ['Customers', '/customers', /^Customers$/], ['Suppliers', '/suppliers', /^Suppliers$/], ['Purchases', '/purchases', /^Purchases$/],
    ['Expenses', '/expenses', /^Expenses$/], ['Reports', '/reports', /^Reports$/], ['Day end', '/day-end', /^Day end$/], ['Staff', '/settings/users', /^Staff$/], ['Settings', '/settings', /^Settings$/], ['Billing', '/billing', /^Billing$/], ['Account', '/account', /Account/],
  ]
  await page.goto('/dashboard')
  for (const [label, path, heading] of pages) {
    await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`))
    await expect(page.getByRole('banner').getByRole('heading', { name: label })).toBeVisible()
    await expect(page.getByRole('main').getByRole('heading', { name: heading }).first()).toBeVisible()
  }
})

test('quick actions on the dashboard open their pages', async ({ page }) => {
  for (const [label, path] of [['Sell', '/pos'], ['Stock', '/inventory'], ['Khata', '/customers'], ['Receive', '/purchases'], ['Reports', '/reports']]) {
    await page.goto('/dashboard')
    await page.getByRole('main').getByRole('link', { name: new RegExp(`^${label}`) }).click()
    await expect(page, label).toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`))
  }
})

test('the sound toggle mutes and unmutes, and is remembered', async ({ page }) => {
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Mute sounds' }).click()
  await expect(page.getByRole('button', { name: 'Turn sounds on' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Turn sounds on' })).toBeVisible()
  await page.getByRole('button', { name: 'Turn sounds on' }).click()
  await expect(page.getByRole('button', { name: 'Mute sounds' })).toBeVisible()
})

test('sidebar links navigate and update the page title', async ({ page }) => {
  await page.goto('/dashboard')
  const nav = page.getByRole('navigation')
  const banner = page.getByRole('banner')

  await nav.getByRole('link', { name: 'Inventory' }).click()
  await expect(page).toHaveURL(/\/inventory$/)
  await expect(banner.getByRole('heading', { name: 'Inventory' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('heading', { name: 'Inventory' })).toBeVisible()

  await nav.getByRole('link', { name: 'Dashboard' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(banner.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await nav.getByRole('link', { name: 'POS' }).click()
  await expect(page).toHaveURL(/\/pos$/)
  await expect(page.getByRole('heading', { name: 'Point of Sale' })).toBeVisible()
})

test('POS back link returns to the dashboard', async ({ page }) => {
  await page.goto('/pos')
  await page.getByRole('link', { name: 'Dashboard' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 2 })).toBeVisible()
})

test.describe('unknown and disabled routes', () => {
  for (const path of ['/dashboard/extra', '/customers/extra', '/no-such-page']) {
    test(`${path} returns 404`, async ({ page }) => {
      const response = await page.goto(path)
      expect(response?.status()).toBe(404)
      await expect(page.getByText('This page could not be found.')).toBeVisible()
    })
  }

  test('the admin area does not exist for shop users', async ({ page }) => {
    for (const path of ['/admin', '/admin/shops', '/admin/payments']) {
      const response = await page.goto(path)
      expect(response?.status(), path).toBe(404)
    }
  })

  for (const path of ['/login', '/signup', '/forgot-password', '/setup']) {
    test(`${path} redirects a signed-in user to the dashboard`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/dashboard$/)
    })
  }
})

test.describe('offline page', () => {
  test('Go to POS opens the POS', async ({ page }) => {
    await page.goto('/offline')
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible()
    await page.getByRole('link', { name: 'Go to POS' }).click()
    await expect(page).toHaveURL(/\/pos$/)
  })

  test('Try again reloads the page', async ({ page }) => {
    await page.goto('/offline')
    const reload = page.waitForEvent('framenavigated')
    await page.getByRole('button', { name: 'Try again' }).click()
    await reload
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible()
  })
})

test('sync log pages show an empty history in self-hosted mode', async ({ page }) => {
  for (const path of ['/sync-log', '/settings/sync-log']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Sync log' })).toBeVisible()
    await expect(page.getByText('No sync events yet.')).toBeVisible()
  }
})

test.describe('mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('menu opens and closes with every control', async ({ page }) => {
    await page.goto('/dashboard')
    const nav = page.getByRole('navigation')
    await expect(nav).toBeHidden()

    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(nav).toBeVisible()
    await page.getByRole('button', { name: 'Close navigation', exact: true }).click()
    await expect(nav).toBeHidden()

    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('button', { name: 'Close navigation overlay' }).click({ position: { x: 360, y: 400 } })
    await expect(nav).toBeHidden()
  })

  test('choosing a link navigates and closes the menu', async ({ page }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('navigation').getByRole('link', { name: 'Inventory' }).click()
    await expect(page).toHaveURL(/\/inventory$/)
    await expect(page.getByRole('navigation')).toBeHidden()
    await expect(page.getByRole('main').getByRole('heading', { name: 'Inventory' })).toBeVisible()
  })
})
