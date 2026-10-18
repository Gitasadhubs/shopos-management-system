import { expect, test } from '@playwright/test'
import { anonymousContext } from './auth-helpers'
import { isPreprod } from './helpers'

// Security headers come from nginx (deploy/nginx), so they are checked on the deployment stack only.
test('security headers are sent and CSP reports are accepted', async () => {
  test.skip(!isPreprod, 'nginx sets these; the dev server has no nginx in front')
  const api = await anonymousContext()
  const response = await api.get('/login')
  const headers = response.headers()
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('SAMEORIGIN')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(headers['permissions-policy']).toContain('geolocation=()')
  const csp = headers['content-security-policy-report-only'] ?? headers['content-security-policy']
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain('https://cdn.paddle.com')
  expect(csp).toContain('report-uri /api/csp-report')

  const report = await api.post('/api/csp-report', { headers: { 'content-type': 'application/csp-report' }, data: JSON.stringify({ 'csp-report': { 'document-uri': 'https://example/pos', 'violated-directive': 'script-src', 'blocked-uri': 'https://evil.example/x.js' } }) })
  expect(report.status()).toBe(204)
  await api.dispose()
})
