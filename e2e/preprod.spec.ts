import { readdirSync, statSync } from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { isPreprod } from './helpers'

// Checks for the deployment stack only (scripts/e2e.ps1 -Target preprod): Caddy, HTTPS, sign-in gate, backups.
test.skip(!isPreprod, 'preprod stack only')

const baseURL = process.env.BASE_URL!

// Raw requests carry no cookies or Playwright defaults: exactly what an anonymous visitor sends.
function rawGet(url: string, headers: Record<string, string> = {}) {
  const client = url.startsWith('https:') ? https : http
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const request = client.get(url, { headers, rejectUnauthorized: false }, (response) => {
      response.resume()
      resolve({ status: response.statusCode ?? 0, headers: response.headers })
    })
    request.on('error', reject)
  })
}

test('signed-out visitors are sent to sign in and APIs refuse them', async () => {
  for (const pathname of ['/dashboard', '/pos', '/inventory', '/settings/users']) {
    const response = await rawGet(`${baseURL}${pathname}`)
    expect(response.status, pathname).toBe(307)
    expect(new URL(response.headers.location!, baseURL).pathname, pathname).toBe('/login')
  }
  for (const pathname of ['/api/products', '/api/sales', '/api/dashboard', '/api/users']) {
    expect((await rawGet(`${baseURL}${pathname}`)).status, pathname).toBe(401)
  }
  // A forged session cookie is rejected the same way.
  expect((await rawGet(`${baseURL}/api/products`, { cookie: '__Host-shopos_session=forged-token-value' })).status).toBe(401)
})

test('the sign-in page and health check are public', async () => {
  expect((await rawGet(`${baseURL}/login`)).status).toBe(200)
  expect((await rawGet(`${baseURL}/api/health`)).status).toBe(200)
})

test('the health check reports MariaDB', async ({ request }) => {
  expect(await (await request.get('/api/health')).json()).toMatchObject({ ok: true, storage: 'mariadb' })
})

test('plain HTTP redirects to HTTPS', async () => {
  const insecure = new URL('/dashboard', baseURL)
  insecure.protocol = 'http:'
  insecure.port = process.env.E2E_HTTP_PORT ?? '18080'
  const response = await rawGet(insecure.toString())
  expect(response.status).toBe(308)
  expect(response.headers.location).toBe(`${baseURL}/dashboard`)
})

test('responses carry security headers and no version details', async ({ request }) => {
  const response = await request.get('/dashboard')
  const headers = response.headers()
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('SAMEORIGIN')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(headers['strict-transport-security']).toBeDefined()
  expect(headers.server).toBeUndefined()
  expect(headers['x-powered-by']).toBeUndefined()
})

test('text responses are compressed', async ({ request }) => {
  const response = await request.get('/dashboard', { headers: { 'accept-encoding': 'gzip' } })
  expect(response.headers()['content-encoding']).toBe('gzip')
})

test('the backup service writes a compressed dump on start', async () => {
  const folder = path.join(process.cwd(), '.e2e-backups')
  const dumps = readdirSync(folder).filter((name) => /^shopos-\d{8}-\d{6}\.sql\.gz$/.test(name))
  expect(dumps.length).toBeGreaterThan(0)
  expect(statSync(path.join(folder, dumps[0])).size).toBeGreaterThan(500)
})
