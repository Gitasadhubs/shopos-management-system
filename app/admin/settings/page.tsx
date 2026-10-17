import { CreditCard } from 'lucide-react'
import { requirePlatformAdmin } from '@/lib/admin'
import { getPlatformSettings } from '@/lib/local-platform'
import { paddleCheckoutConfig } from '@/lib/paddle'
import { savePlatformSettingsAction } from '../actions'

export const dynamic = 'force-dynamic'

// Settings for the whole service.
export default async function AdminSettings({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  await requirePlatformAdmin()
  const settings = await getPlatformSettings()
  const card = paddleCheckoutConfig()
  // Trials with a card need the 14-day trial prices in Paddle (SHOPOS_PADDLE_TRIAL_PRICE_*).
  const trialPrices = card?.trial_prices.length ?? 0
  const { notice } = await searchParams

  return (
    <section className="p-5 sm:p-8">
      <h1 className="text-3xl font-bold">Settings</h1>
      <p className="mt-2 text-stone-500">How shops sign up and pay.</p>
      {notice && <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <form action={savePlatformSettingsAction} className="mt-6 max-w-2xl rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-bold"><CreditCard className="size-4 text-emerald-600" />Free trial</h2>
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input type="checkbox" name="require_card_for_trial" defaultChecked={settings.require_card_for_trial} className="mt-0.5 size-4 accent-emerald-600" />
          <span>
            <span className="font-semibold">Require a card to start a trial</span>
            <span className="mt-1 block text-stone-500">New shops add a card in Paddle&apos;s checkout before they can use ShopOS. Nothing is charged for 14 days; then the plan they chose starts. Shops that signed up before this was turned on are not affected. A transfer payment you record also opens a waiting shop.</span>
          </span>
        </label>
        {settings.require_card_for_trial && trialPrices === 0 && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Card trials are not set up: add the SHOPOS_PADDLE_TRIAL_PRICE_* prices (scripts/paddle-setup.mjs creates them). Until then new shops cannot start.</p>}
        <button className="mt-5 h-10 rounded-lg bg-stone-900 px-5 text-sm font-semibold text-white hover:bg-stone-800">Save settings</button>
      </form>
    </section>
  )
}
