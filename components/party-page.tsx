'use client'

import { useState } from 'react'
import { BookOpen, HandCoins, MessageCircle, Pencil, Plus, Search, Trash2, Users, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/components/auth/auth-provider'
import { getCountry } from '@/lib/countries'
import { EmptyState, PeopleIllustration, TruckIllustration } from '@/components/illustrations'
import { api, Avatar, dateTime, money, Notice, PageHeader, SkeletonRows, StatCard, useAction, useApi } from '@/components/page-kit'

// Customers (what they owe the shop: khata) and suppliers (what the shop owes them) share this screen.

type Party = { id: string; name: string; phone: string | null; address: string | null; notes: string | null; balance: number; created_at: string }
type LedgerEntry = { id: string; kind: string; amount: number; note: string | null; created_by_name: string | null; created_at: string }
type Kind = 'customers' | 'suppliers'

const COPY = {
  customers: {
    title: 'Customers', singular: 'customer', description: 'Khata: who owes you, and every payment they make.',
    owedTitle: 'Customers owe you', owedNote: (count: number) => `${count} customer${count === 1 ? '' : 's'} with a balance`,
    balanceLabel: 'Owes you', empty: 'No customers yet', emptyHelp: 'Add regulars here, then sell on credit (khata) from the POS.',
    paymentTitle: 'Receive payment', paymentButton: 'Receive payment', art: PeopleIllustration,
  },
  suppliers: {
    title: 'Suppliers', singular: 'supplier', description: 'The people you buy stock from, and what you owe them.',
    owedTitle: 'You owe suppliers', owedNote: (count: number) => `${count} supplier${count === 1 ? '' : 's'} to pay`,
    balanceLabel: 'You owe', empty: 'No suppliers yet', emptyHelp: 'Add a supplier, then record stock you receive under Purchases.',
    paymentTitle: 'Pay supplier', paymentButton: 'Pay supplier', art: TruckIllustration,
  },
} as const

const emptyForm = { name: '', phone: '', address: '', notes: '' }

// The reminder is the shop's country template (lib/countries whatsapp.creditReminder).
function whatsappLink(party: Party, shopName: string, countryCode: string | undefined) {
  const country = getCountry(countryCode)
  const digits = (party.phone ?? '').replace(/\D/g, '')
  if (digits.length < 8) return null
  // Local numbers are often saved with a leading 0 (03xx…); WhatsApp wants the country code.
  const prefix = country.phonePrefix.replace(/\D/g, '')
  const international = digits.startsWith('0') && prefix ? `${prefix}${digits.slice(1)}` : digits
  const text = country.whatsapp.creditReminder.replace('{customer}', party.name).replace('{shop}', shopName).replace('{balance}', money(party.balance).replace(/\u00a0/g, ' '))
  return `https://wa.me/${international}?text=${encodeURIComponent(text)}`
}

function PartyPage({ kind }: { kind: Kind }) {
  const copy = COPY[kind]
  const { role, shop } = useAuth()
  const [search, setSearch] = useState('')
  const list = useApi<Party[]>(`/api/${kind}?search=${encodeURIComponent(search)}`)
  const action = useAction()
  const [editing, setEditing] = useState<Party | 'new' | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [paying, setPaying] = useState<Party | null>(null)
  const [payment, setPayment] = useState({ amount: '', note: '' })
  const [removing, setRemoving] = useState<Party | null>(null)
  const [viewing, setViewing] = useState<Party | null>(null)
  const ledger = useApi<{ party: Party; entries: LedgerEntry[] }>(viewing ? `/api/${kind}/${viewing.id}` : null)
  const parties = list.data ?? []
  const owing = parties.filter((party) => party.balance > 0)
  const canRemove = role?.role !== 'cashier'

  function openForm(party: Party | 'new') {
    setEditing(party)
    setForm(party === 'new' ? emptyForm : { name: party.name, phone: party.phone ?? '', address: party.address ?? '', notes: party.notes ?? '' })
    action.setError('')
    action.setSuccess('')
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const isNew = editing === 'new'
    const ok = await action.run(async () => {
      await api(isNew ? `/api/${kind}` : `/api/${kind}/${(editing as Party).id}`, { method: isNew ? 'POST' : 'PUT', body: form })
      return isNew ? `${form.name} added.` : `${form.name} updated.`
    }, isNew ? 'add' : 'success')
    if (ok) {
      setEditing(null)
      await list.reload()
    }
  }

  async function pay(event: React.FormEvent) {
    event.preventDefault()
    if (!paying) return
    const ok = await action.run(async () => {
      await api(`/api/${kind}/${paying.id}/payment`, { method: 'POST', body: { amount: Number(payment.amount), note: payment.note } })
      return `Payment of ${money(Number(payment.amount))} recorded for ${paying.name}.`
    }, 'sale')
    if (ok) {
      setPaying(null)
      await list.reload()
      if (viewing) await ledger.reload()
    }
  }

  async function remove() {
    if (!removing) return
    const ok = await action.run(async () => {
      await api(`/api/${kind}/${removing.id}`, { method: 'DELETE' })
      return `${removing.name} removed.`
    })
    if (ok) {
      setRemoving(null)
      await list.reload()
    }
  }

  const dialogOpen = Boolean(editing || paying || removing)
  const Art = copy.art
  return (
    <section>
      <PageHeader title={copy.title} description={copy.description} art={<Art className="h-16 w-auto" />} actions={<Button onClick={() => openForm('new')} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 size-4" />Add {copy.singular}</Button>} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard title={copy.owedTitle} value={owing.reduce((sum, party) => sum + party.balance, 0)} format={money} loading={list.loading && !list.data} note={copy.owedNote(owing.length)} icon={Wallet} tone="amber" />
        <StatCard title={`All ${kind}`} value={parties.length} loading={list.loading && !list.data} note={search ? 'Matching your search' : 'Saved in this shop'} icon={Users} tone="emerald" delay={60} />
        <StatCard title="Largest balance" value={owing[0] ? Math.max(...owing.map((party) => party.balance)) : 0} format={money} loading={list.loading && !list.data} note={owing.length ? [...owing].sort((a, b) => b.balance - a.balance)[0].name : 'Nothing outstanding'} icon={HandCoins} tone="rose" delay={120} />
      </div>

      <div className="relative mb-4"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label={`Search ${kind}`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or phone" className="bg-white pl-9" /></div>
      {action.success && !dialogOpen && <Notice tone="success">{action.success}</Notice>}
      {(list.error || (action.error && !dialogOpen)) && <Notice tone="error" action={list.error ? <Button size="sm" variant="outline" onClick={() => void list.reload()}>Retry</Button> : undefined}>{list.error || action.error}</Notice>}

      <Card className="shopos-rise">
        <CardHeader><CardTitle className="text-base">{copy.title} ({parties.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {list.loading && !list.data ? <SkeletonRows /> : parties.length ? <ul className="divide-y">
            {parties.map((party) => {
              const reminder = kind === 'customers' && party.balance > 0 ? whatsappLink(party, shop?.name ?? 'our shop', shop?.country) : null
              return <li key={party.id} className="flex flex-col gap-3 p-4 transition-colors hover:bg-stone-50/60 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={party.name} />
                  <div className="min-w-0"><p className="truncate font-semibold text-stone-900">{party.name}</p><p className="truncate text-xs text-muted-foreground">{[party.phone, party.address].filter(Boolean).join(' · ') || 'No contact details'}</p></div>
                </div>
                <div className="flex items-center gap-3 sm:justify-end">
                  <span className={`rounded-full px-3 py-1 text-sm font-semibold tabular-nums ${party.balance > 0 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{party.balance > 0 ? `${copy.balanceLabel} ${money(party.balance)}` : 'Settled'}</span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Ledger for ${party.name}`} title="Ledger" onClick={() => setViewing(party)}><BookOpen className="size-4" /></Button>
                    {party.balance > 0 && <Button variant="ghost" size="icon" aria-label={`${copy.paymentButton}: ${party.name}`} title={copy.paymentButton} onClick={() => { setPaying(party); setPayment({ amount: String(party.balance), note: '' }); action.setError(''); action.setSuccess('') }}><HandCoins className="size-4 text-emerald-700" /></Button>}
                    {reminder && <a href={reminder} target="_blank" rel="noreferrer" aria-label={`Send WhatsApp reminder to ${party.name}`} title="WhatsApp reminder" className="flex size-12 items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-50 sm:size-9"><MessageCircle className="size-4" /></a>}
                    <Button variant="ghost" size="icon" aria-label={`Edit ${party.name}`} title="Edit" onClick={() => openForm(party)}><Pencil className="size-4" /></Button>
                    {canRemove && <Button variant="ghost" size="icon" aria-label={`Remove ${party.name}`} title="Remove" onClick={() => { setRemoving(party); action.setError(''); action.setSuccess('') }}><Trash2 className="size-4 text-rose-600" /></Button>}
                  </div>
                </div>
              </li>
            })}
          </ul> : <EmptyState illustration={copy.art} title={search ? `No ${kind} match “${search}”.` : copy.empty} action={search ? undefined : <Button onClick={() => openForm('new')} variant="outline"><Plus className="mr-2 size-4" />Add {copy.singular}</Button>}>{search ? 'Try another name or number.' : copy.emptyHelp}</EmptyState>}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null) }}><DialogContent>
        <DialogHeader><DialogTitle>{editing === 'new' ? `Add ${copy.singular}` : `Edit ${copy.singular}`}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div><Label htmlFor="party-name">Name</Label><Input id="party-name" className="mt-1.5" required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
          <div><Label htmlFor="party-phone">Phone</Label><Input id="party-phone" className="mt-1.5" type="tel" maxLength={40} placeholder="03xx xxxxxxx" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
          <div><Label htmlFor="party-address">Address</Label><Input id="party-address" className="mt-1.5" maxLength={300} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></div>
          <div><Label htmlFor="party-notes">Notes</Label><Textarea id="party-notes" className="mt-1.5" maxLength={1000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div>
          {action.error && <p role="alert" className="text-sm text-rose-600">{action.error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={action.busy} className="bg-emerald-600 hover:bg-emerald-700">{action.busy ? 'Saving…' : editing === 'new' ? `Add ${copy.singular}` : 'Save changes'}</Button></DialogFooter>
        </form>
      </DialogContent></Dialog>

      <Dialog open={Boolean(paying)} onOpenChange={(open) => { if (!open) setPaying(null) }}><DialogContent>
        <DialogHeader><DialogTitle>{copy.paymentTitle}{paying ? ` · ${paying.name}` : ''}</DialogTitle></DialogHeader>
        <form onSubmit={pay} className="grid gap-4">
          <p className="text-sm text-muted-foreground">{copy.balanceLabel}: <strong className="text-stone-900">{money(paying?.balance ?? 0)}</strong></p>
          <div><Label htmlFor="payment-amount">Amount</Label><Input id="payment-amount" className="mt-1.5" type="number" min="0.01" step="0.01" max={paying?.balance} required value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} /></div>
          <div><Label htmlFor="payment-note">Note</Label><Input id="payment-note" className="mt-1.5" maxLength={300} placeholder="e.g. Cash, JazzCash ref…" value={payment.note} onChange={(event) => setPayment({ ...payment, note: event.target.value })} /></div>
          {action.error && <p role="alert" className="text-sm text-rose-600">{action.error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setPaying(null)}>Cancel</Button><Button type="submit" disabled={action.busy} className="bg-emerald-600 hover:bg-emerald-700">{action.busy ? 'Saving…' : 'Record payment'}</Button></DialogFooter>
        </form>
      </DialogContent></Dialog>

      <Dialog open={Boolean(removing)} onOpenChange={(open) => { if (!open) setRemoving(null) }}><DialogContent>
        <DialogHeader><DialogTitle>Remove {copy.singular}?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{removing?.name} will be hidden from lists. Past sales and payments stay recorded.</p>
        {action.error && <p role="alert" className="text-sm text-rose-600">{action.error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="destructive" disabled={action.busy} onClick={() => void remove()}>{action.busy ? 'Removing…' : `Remove ${copy.singular}`}</Button></DialogFooter>
      </DialogContent></Dialog>

      <Dialog open={Boolean(viewing)} onOpenChange={(open) => { if (!open) setViewing(null) }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Ledger · {viewing?.name}</DialogTitle></DialogHeader>
        {ledger.loading && !ledger.data ? <SkeletonRows rows={3} /> : ledger.error ? <p role="alert" className="text-sm text-rose-600">{ledger.error}</p> : ledger.data && <div className="grid gap-4">
          <div className="flex items-center gap-3 rounded-xl bg-stone-50 p-4">
            <Avatar name={ledger.data.party.name} className="size-12 text-base" />
            <div className="flex-1"><p className="font-semibold">{ledger.data.party.name}</p><p className="text-xs text-muted-foreground">{ledger.data.party.phone || 'No phone'}{ledger.data.party.notes ? ` · ${ledger.data.party.notes}` : ''}</p></div>
            <div className="text-right"><p className="text-xs text-muted-foreground">{copy.balanceLabel}</p><p className="text-lg font-bold tabular-nums">{money(ledger.data.party.balance)}</p></div>
          </div>
          {ledger.data.entries.length ? <ul className="divide-y rounded-xl border">
            {ledger.data.entries.map((entry) => <li key={entry.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div><p className="font-medium capitalize">{entry.note || entry.kind}</p><p className="text-xs text-muted-foreground">{dateTime(entry.created_at)}{entry.created_by_name ? ` · ${entry.created_by_name}` : ''}</p></div>
              <span className={`font-semibold tabular-nums ${entry.amount < 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{entry.amount < 0 ? '−' : '+'}{money(Math.abs(entry.amount))}</span>
            </li>)}
          </ul> : <p className="py-6 text-center text-sm text-muted-foreground">No entries yet.</p>}
        </div>}
        <DialogFooter>
          {viewing && (ledger.data?.party.balance ?? 0) > 0 && <Button variant="outline" onClick={() => { const party = ledger.data!.party; setPaying(party); setPayment({ amount: String(party.balance), note: '' }) }}><HandCoins className="mr-2 size-4" />{copy.paymentButton}</Button>}
          <Button onClick={() => setViewing(null)}>Close</Button>
        </DialogFooter>
      </DialogContent></Dialog>
    </section>
  )
}

export function CustomersPage() {
  return <PartyPage kind="customers" />
}

export function SuppliersPage() {
  return <PartyPage kind="suppliers" />
}
