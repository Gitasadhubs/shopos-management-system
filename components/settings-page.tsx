'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { CalendarCheck, CreditCard, Play, Store, Target, UserRound, Users, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/components/auth/auth-provider'
import { SettingsIllustration } from '@/components/illustrations'
import { api, money, Notice, PageHeader, SkeletonRows, useAction, useApi } from '@/components/page-kit'
import { countryOptions } from '@/lib/countries'
import { playSound, setSoundEnabled, useSoundEnabled, type SoundName } from '@/lib/sounds'

type Shop = { id: string; name: string; phone: string | null; address: string | null; receipt_footer: string | null; timezone: string; country: string; daily_target: number | null; report_enabled: boolean; report_time: string; report_email: string | null; report_whatsapp: string | null }

// Daily sales target (dashboard progress ring) and the automatic day-end report.
function DayEndSettings({ shop, owner, onSaved }: { shop: Shop; owner: boolean; onSaved: () => Promise<void> }) {
  const action = useAction()
  const [form, setForm] = useState({ daily_target: shop.daily_target ? String(shop.daily_target) : '', report_enabled: shop.report_enabled, report_time: shop.report_time, report_email: shop.report_email ?? '', report_whatsapp: shop.report_whatsapp ?? '' })

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const ok = await action.run(async () => {
      await api('/api/settings', { method: 'PUT', body: { ...form, daily_target: form.daily_target === '' ? null : Number(form.daily_target) } })
      return form.report_enabled ? `Saved. The day-end report goes out every day at ${form.report_time}.` : 'Saved.'
    })
    if (ok) await onSaved()
  }

  return (
    <Card id="day-end" className="scroll-mt-24 shopos-rise">
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Target className="size-4 text-emerald-600" />Daily target and day-end report</CardTitle><p className="text-xs text-muted-foreground">Get the day’s sales, profit and cash summary every evening by email and WhatsApp.</p></CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <fieldset disabled={!owner || action.busy} className="contents">
            <div className="sm:col-span-2"><Label htmlFor="daily-target">Daily sales target (₨)</Label><Input id="daily-target" className="mt-1.5" type="number" min="0" step="100" placeholder="e.g. 25000 — leave empty for none" value={form.daily_target} onChange={(event) => setForm({ ...form, daily_target: event.target.value })} /></div>
            <label htmlFor="report-enabled" className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border p-4 sm:col-span-2">
              <span><span className="block text-sm font-semibold">Send the day-end report automatically</span><span className="block text-xs text-muted-foreground">Once a day, at the time below (shop time zone).</span></span>
              <input id="report-enabled" type="checkbox" role="switch" className="peer sr-only" checked={form.report_enabled} onChange={(event) => setForm({ ...form, report_enabled: event.target.checked })} />
              <span aria-hidden="true" className="relative h-7 w-12 shrink-0 rounded-full bg-stone-300 transition-colors peer-checked:bg-emerald-600 after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
            </label>
            <div><Label htmlFor="report-time">Send at</Label><Input id="report-time" className="mt-1.5" type="time" required value={form.report_time} onChange={(event) => setForm({ ...form, report_time: event.target.value })} /></div>
            <div><Label htmlFor="report-email">Report email</Label><Input id="report-email" className="mt-1.5" type="email" placeholder="Owner’s email if empty" value={form.report_email} onChange={(event) => setForm({ ...form, report_email: event.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="report-whatsapp">WhatsApp numbers</Label><Input id="report-whatsapp" className="mt-1.5" type="tel" placeholder="0300 1234567, 0321 7654321" value={form.report_whatsapp} onChange={(event) => setForm({ ...form, report_whatsapp: event.target.value })} /><p className="mt-1 text-xs text-muted-foreground">Up to 5, separated by commas. You can always share the report yourself from Day end.</p></div>
            {action.error && <p role="alert" className="text-sm text-rose-600 sm:col-span-2">{action.error}</p>}
            {action.success && <p role="status" className="text-sm text-emerald-700 sm:col-span-2">{action.success}</p>}
            {owner && <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit" className="bg-emerald-600 hover:bg-emerald-700">{action.busy ? 'Saving…' : 'Save report settings'}</Button><Link href="/day-end" className="inline-flex h-12 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 sm:h-9"><CalendarCheck className="size-4" />Open today’s report</Link></div>}
          </fieldset>
        </form>
      </CardContent>
    </Card>
  )
}

const ZONES = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Asia/Dhaka', 'Europe/London', 'America/New_York', 'UTC']
const SOUNDS: Array<{ name: SoundName; label: string }> = [{ name: 'add', label: 'Add to cart' }, { name: 'scan', label: 'Barcode scan' }, { name: 'sale', label: 'Sale complete' }, { name: 'success', label: 'Saved' }, { name: 'error', label: 'Problem' }]

function Toggle({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border p-4 transition hover:bg-stone-50">
      <span className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Volume2 className="size-5" /></span><span><span className="block text-sm font-semibold">{label}</span><span className="block text-xs text-muted-foreground">Clicks, scans and a till “cha-ching”. Saved on this device.</span></span></span>
      <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span aria-hidden="true" className="relative h-7 w-12 shrink-0 rounded-full bg-stone-300 transition-colors peer-checked:bg-emerald-600 peer-focus-visible:ring-4 peer-focus-visible:ring-emerald-500/30 after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  )
}

export default function SettingsPage() {
  const { role, refresh } = useAuth()
  const owner = role?.role === 'owner'
  const shop = useApi<Shop>('/api/settings')
  const action = useAction()
  const sound = useSoundEnabled()
  const [form, setForm] = useState({ name: '', phone: '', address: '', receipt_footer: '', timezone: 'Asia/Karachi', country: '' })
  const countries = useMemo(() => countryOptions(), [])

  useEffect(() => {
    if (shop.data) setForm({ name: shop.data.name, phone: shop.data.phone ?? '', address: shop.data.address ?? '', receipt_footer: shop.data.receipt_footer ?? '', timezone: shop.data.timezone, country: shop.data.country === 'ZZ' ? '' : shop.data.country })
  }, [shop.data])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const ok = await action.run(async () => {
      // An empty country (never chosen) is left as it is.
      const { country, ...rest } = form
      await api('/api/settings', { method: 'PUT', body: country ? form : rest })
      return 'Shop details saved.'
    })
    if (ok) await refresh()
  }

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value })
  const zones = ZONES.includes(form.timezone) ? ZONES : [form.timezone, ...ZONES]
  return (
    <section>
      <PageHeader title="Settings" description="Your shop details, receipts and this device." art={<SettingsIllustration className="h-16 w-auto" />} />
      {action.success && <Notice tone="success">{action.success}</Notice>}
      {(shop.error || action.error) && <Notice tone="error">{shop.error || action.error}</Notice>}

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="grid content-start gap-6">
        <Card className="shopos-rise">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Store className="size-4 text-emerald-600" />Shop profile</CardTitle>{!owner && <p className="text-xs text-muted-foreground">Only the shop owner can change these.</p>}</CardHeader>
          <CardContent>
            {shop.loading && !shop.data ? <SkeletonRows rows={4} /> : <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
              <fieldset disabled={!owner || action.busy} className="contents">
                <div className="sm:col-span-2"><Label htmlFor="shop-name">Shop name</Label><Input id="shop-name" className="mt-1.5" required maxLength={120} value={form.name} onChange={set('name')} /></div>
                <div><Label htmlFor="shop-phone">Phone</Label><Input id="shop-phone" className="mt-1.5" type="tel" maxLength={40} value={form.phone} onChange={set('phone')} /></div>
                <div><Label htmlFor="shop-country">Country</Label><select id="shop-country" className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm" value={form.country} onChange={set('country')}><option value="" disabled>Choose your country</option>{countries.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}</select></div>
                <div><Label htmlFor="shop-timezone">Time zone</Label><select id="shop-timezone" className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm" value={form.timezone} onChange={set('timezone')}>{zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></div>
                <div className="sm:col-span-2"><Label htmlFor="shop-address">Address</Label><Input id="shop-address" className="mt-1.5" maxLength={300} value={form.address} onChange={set('address')} /></div>
                <div className="sm:col-span-2"><Label htmlFor="shop-footer">Receipt message</Label><Input id="shop-footer" className="mt-1.5" maxLength={300} placeholder="Thank you for shopping with us!" value={form.receipt_footer} onChange={set('receipt_footer')} /></div>
                {owner && <div className="sm:col-span-2"><Button type="submit" className="bg-emerald-600 hover:bg-emerald-700">{action.busy ? 'Saving…' : 'Save shop details'}</Button></div>}
              </fieldset>
            </form>}
          </CardContent>
        </Card>
        {shop.data && <DayEndSettings key={shop.data.id} shop={shop.data} owner={owner} onSaved={async () => { await shop.reload() }} />}
        </div>

        <div className="grid content-start gap-6">
          <Card className="shopos-rise">
            <CardHeader><CardTitle className="text-base">Receipt preview</CardTitle></CardHeader>
            <CardContent>
              <div className="mx-auto max-w-xs rounded-lg border border-dashed bg-white p-5 text-center font-mono text-xs shadow-sm">
                <p className="text-sm font-bold">{form.name || 'Your shop'}</p>
                {form.address && <p className="text-muted-foreground">{form.address}</p>}
                {form.phone && <p className="text-muted-foreground">{form.phone}</p>}
                <div className="my-3 border-t border-dashed" />
                <div className="flex justify-between"><span>Chai × 2</span><span>{money(120)}</span></div>
                <div className="flex justify-between"><span>Biscuits × 1</span><span>{money(50)}</span></div>
                <div className="my-3 border-t border-dashed" />
                <div className="flex justify-between font-bold"><span>Total</span><span>{money(170)}</span></div>
                <p className="mt-3 text-muted-foreground">{form.receipt_footer || 'Thank you for shopping with us!'}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="shopos-rise">
            <CardHeader><CardTitle className="text-base">This device</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <Toggle id="sound-toggle" label="Sound effects" checked={sound} onChange={setSoundEnabled} />
              <div className="flex flex-wrap gap-2">{SOUNDS.map(({ name, label }) => <Button key={name} type="button" variant="outline" size="sm" disabled={!sound} onClick={() => playSound(name)}><Play className="mr-1 size-3" />{label}</Button>)}</div>
            </CardContent>
          </Card>

          <Card className="shopos-rise">
            <CardHeader><CardTitle className="text-base">More settings</CardTitle></CardHeader>
            <CardContent className="grid gap-2">
              {owner && <Link href="/settings/users" className="flex items-center gap-3 rounded-lg p-3 text-sm font-medium hover:bg-stone-50"><Users className="size-4 text-emerald-600" />Staff and invitations</Link>}
              {owner && <Link href="/billing" className="flex items-center gap-3 rounded-lg p-3 text-sm font-medium hover:bg-stone-50"><CreditCard className="size-4 text-emerald-600" />Plan and billing</Link>}
              <Link href="/account" className="flex items-center gap-3 rounded-lg p-3 text-sm font-medium hover:bg-stone-50"><UserRound className="size-4 text-emerald-600" />Your account and password</Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}
