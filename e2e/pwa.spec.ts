import { expect, test } from '@playwright/test'
import { isPreprod } from './helpers'

// The service worker exists only in the production build (scripts/e2e.ps1 -Target preprod).
test.skip(!isPreprod, 'production build only')

test('serves the web app manifest and icons', async ({ request }) => {
  const manifest = await request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBe(true)
  expect(await manifest.json()).toMatchObject({ short_name: 'ShopOS', start_url: '/dashboard', display: 'standalone' })
  for (const icon of ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch.png']) {
    expect((await request.get(icon)).ok(), icon).toBe(true)
  }
})

test('service worker installs and pages still load live content', async ({ page }) => {
  await page.goto('/dashboard')
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  expect(new URL(scope).pathname).toBe('/')

  // With the worker in control, normal navigation must reach the app, not the offline fallback.
  await page.reload()
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  for (const path of ['/dashboard', '/inventory', '/pos']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: "You're offline" })).toHaveCount(0)
  }
  await expect(page.getByRole('heading', { name: 'Point of Sale' })).toBeVisible()
})

test('shows the offline page when the network is down', async ({ page, context }) => {
  await page.goto('/dashboard')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload()

  await context.setOffline(true)
  await page.goto('/inventory').catch(() => undefined)
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible()
  await context.setOffline(false)
})

test('sales are never served from the service worker cache', async ({ page }) => {
  await page.goto('/pos')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect(page.getByText('Loading sales…')).toHaveCount(0)
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) for (const entry of await (await caches.open(name)).keys()) urls.push(new URL(entry.url).pathname)
    return urls
  })
  expect(cached).not.toContain('/api/sales')
})
