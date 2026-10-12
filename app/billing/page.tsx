import { AppRoot } from '@/components/app-root'
import HostedBilling from './hosted-billing'

// Self-hosted shops see Billing inside the app; hosted (Supabase) shops keep the standalone page.
export default function Billing() {
  return process.env.SHOPOS_STORAGE === 'mariadb' ? <AppRoot /> : <HostedBilling />
}

export const dynamic = 'force-dynamic'
