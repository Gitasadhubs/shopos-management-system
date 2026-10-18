import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Browsers report Content Security Policy violations here (deploy/nginx/40-shopos-tls.sh). Each one is
// logged as a single line, which reaches CloudWatch Logs on the AWS server, so the policy can be
// enforced once nothing legitimate is reported.
export async function POST(request: Request) {
  const text = await request.text().catch(() => '')
  if (!text || text.length > 20_000) return new NextResponse(null, { status: 204 })
  try {
    const body = JSON.parse(text)
    const reports = Array.isArray(body) ? body.map((item) => item?.body ?? item) : [body?.['csp-report'] ?? body]
    for (const report of reports.slice(0, 10)) {
      const blocked = report?.['blocked-uri'] ?? report?.blockedURL ?? ''
      const directive = report?.['violated-directive'] ?? report?.effectiveDirective ?? ''
      const page = report?.['document-uri'] ?? report?.documentURL ?? ''
      console.warn('csp-violation', JSON.stringify({ directive, blocked: String(blocked).slice(0, 200), page: String(page).slice(0, 200) }))
    }
  } catch {
    // Not JSON: nothing to log.
  }
  return new NextResponse(null, { status: 204 })
}
