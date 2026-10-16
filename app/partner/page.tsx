import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// The partner program's page is on the website (getshopos.online/partners, shopos-growth/web) with the terms and the
// application form; it applies through /api/partner/apply. Partners' private pages stay here:
// /partner/<token>.
export default function PartnerPage() {
  redirect(process.env.SHOPOS_PARTNER_SITE ?? 'https://getshopos.online/partners')
}
