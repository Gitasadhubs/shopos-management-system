import { defineConfig, devices } from '@playwright/test'
import { OWNER_STATE } from './e2e/auth-helpers'

const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'
const isHttps = baseURL.startsWith('https:')
// Preprod tests use nginx's self-signed certificate. The browser accepts it, as a till that trusts
// that certificate would; without that, service workers refuse to register.
const certArgs = isHttps ? ['--ignore-certificate-errors'] : []

// Tests share one database, so they run serially and use unique names and emails.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // next dev compiles each route on first visit, so allow slow first loads.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    ignoreHTTPSErrors: isHttps,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // First-run flow in the browser: create the owner, confirm the email, sign in, save the session.
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'], launchOptions: { args: certArgs } } },
    // Dev runs on plain HTTP at a non-localhost host: the same insecure context a LAN till would get.
    {
      name: 'chromium',
      testIgnore: [/pwa\.spec\.ts/, /auth\.setup\.ts/],
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: OWNER_STATE, launchOptions: { args: certArgs } },
    },
    // Service workers need a secure context, so on dev this project treats the test host as HTTPS.
    {
      name: 'pwa',
      testMatch: /pwa\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: OWNER_STATE,
        launchOptions: { args: isHttps ? certArgs : [`--unsafely-treat-insecure-origin-as-secure=${new URL(baseURL).origin}`] },
      },
    },
  ],
})
