import { expect, test as setup, type Page } from '@playwright/test'
import { ADMIN, ADMIN_STATE, anonymousContext, formReady, latestEmail, linkIn, OWNER, OWNER_STATE } from './auth-helpers'

// Runs before every other test: the first-run flow of a new install (the platform admin) and a shop
// signing up, each confirmed by email and signed in, with the sessions saved for the other tests.

async function confirmAndSignIn(page: Page, email: string, password: string, verifyLink: string | null) {
  if (verifyLink) {
    // Signing in before confirming is refused, with a way to get a new link.
    await page.goto('/login')
    await formReady(page)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Confirm your email first')
    await expect(page.getByRole('button', { name: 'Send a new link' })).toBeVisible()

    await page.goto(verifyLink)
    await formReady(page)
    await page.getByRole('button', { name: 'Confirm email' }).click()
    await expect(page).toHaveURL(/\/login\?verified=1$/)
    await expect(page.getByRole('status')).toHaveText('Email confirmed. Sign in to continue.')
  } else {
    await page.goto('/login')
  }
  await formReady(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

setup('first run: create the platform admin, confirm the email and sign in', async ({ page }) => {
  const api = await anonymousContext()
  const needsSetup = (await (await api.get('/api/auth/setup')).json()).data.needs_setup as boolean
  await api.dispose()

  let verify: string | null = null
  if (needsSetup) {
    // A fresh install sends everyone to setup, including would-be shops.
    await page.goto('/signup')
    await expect(page).toHaveURL(/\/setup$/)
    await formReady(page)
    await expect(page.getByRole('heading', { name: 'Set up ShopOS' })).toBeVisible()
    await page.getByLabel('Your name').fill(ADMIN.name)
    await page.getByLabel('Email').fill(ADMIN.email)
    await page.getByLabel('Password', { exact: true }).fill('short')
    await page.getByLabel('Confirm password').fill('short')
    await page.getByRole('button', { name: 'Create admin account' }).click()
    expect(await page.getByLabel('Password', { exact: true }).evaluate((input: HTMLInputElement) => input.validity.tooShort)).toBe(true)

    await page.getByLabel('Password', { exact: true }).fill(ADMIN.password)
    await page.getByLabel('Confirm password').fill(`${ADMIN.password}x`)
    await page.getByRole('button', { name: 'Create admin account' }).click()
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('The passwords do not match.')

    await page.getByLabel('Password', { exact: true }).fill(ADMIN.password)
    await page.getByLabel('Confirm password').fill(ADMIN.password)
    await page.getByRole('button', { name: 'Create admin account' }).click()
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    verify = linkIn((await latestEmail(ADMIN.email, 'Confirm')).text, '/verify-email')
  }

  await confirmAndSignIn(page, ADMIN.email, ADMIN.password, verify)
  // The admin has no shop; their home is the admin panel.
  // next dev compiles each area on first visit, which can take longer than the default wait.
  await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 })
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ADMIN.name.split(' ')[0])
  await page.context().storageState({ path: ADMIN_STATE })
})

setup('a shop signs up, confirms the email and signs in', async ({ page }) => {
  await page.goto('/signup')
  await formReady(page)
  await expect(page.getByRole('heading', { name: 'Create your shop' })).toBeVisible()
  await page.getByLabel('Shop name').fill(OWNER.shop)
  await page.getByLabel('Country').selectOption('PK')
  await page.getByLabel('Your name').fill(OWNER.name)
  await page.getByLabel('Phone (optional)').fill('0300 1234567')
  await page.getByLabel('Email').fill(OWNER.email)
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password)
  await page.getByLabel('Confirm password').fill(OWNER.password)
  await page.getByRole('button', { name: 'Create my shop' }).click()

  let verify: string | null = null
  const alert = page.getByRole('main').getByRole('alert')
  await expect(page.getByRole('heading', { name: 'Check your email' }).or(alert)).toBeVisible()
  if (await alert.isVisible()) {
    // A re-run against the same database: the shop already exists.
    await expect(alert).toContainText('already has an account')
  } else {
    verify = linkIn((await latestEmail(OWNER.email, 'Confirm')).text, '/verify-email')
  }

  await confirmAndSignIn(page, OWNER.email, OWNER.password, verify)
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 })
  await expect(page.getByRole('complementary').getByText(OWNER.name)).toBeVisible()
  await expect(page.getByRole('complementary').getByText(OWNER.shop)).toBeVisible()
  await page.context().storageState({ path: OWNER_STATE })
})
