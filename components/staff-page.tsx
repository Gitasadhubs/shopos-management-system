'use client'

import { useEffect, useState } from 'react'
import { LoaderCircle, MailPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type StaffUser = { id: string; email: string; full_name: string; role: 'owner' | 'manager' | 'cashier'; is_active: boolean; email_verified: boolean; last_login_at: string | null }
type Invite = { id: string; email: string; full_name: string | null; role: string; expires_at: string }

const selectClass = 'h-9 rounded-lg border border-input bg-white px-2 text-sm'
const when = (value: string | null) => (value ? new Date(value).toLocaleString() : 'Never')

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? 'Something went wrong.')
  return result.data
}

export default function StaffPage() {
  const [users, setUsers] = useState<StaffUser[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState({ email: '', full_name: '', role: 'cashier' })

  async function load() {
    try {
      const data = await send('/api/users', 'GET')
      setUsers(data.users)
      setInvites(data.invites)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load staff.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await action()
      setSuccess(message)
      await load()
      return true
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Something went wrong.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault()
    const sent = await run(() => send('/api/users', 'POST', { email: form.email, role: form.role, full_name: form.full_name || undefined }), `Invitation sent to ${form.email}.`)
    if (sent) setForm({ email: '', full_name: '', role: form.role })
  }

  return (
    <section>
      <div className="mb-6"><h1 className="text-3xl font-bold tracking-tight">Staff</h1><p className="mt-1 text-sm text-muted-foreground">Invite people by email and choose what they can do.</p></div>
      {success && <p role="status" className="mb-4 text-sm text-emerald-700">{success}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Invite staff</CardTitle><p className="text-xs text-muted-foreground">Managers can run sales and inventory. Cashiers can use the POS and see the dashboard.</p></CardHeader>
        <CardContent>
          <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
            <div className="grid gap-1.5"><Label htmlFor="invite-email">Email</Label><Input id="invite-email" type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="invite-name">Name (optional)</Label><Input id="invite-name" maxLength={120} value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="invite-role">Role</Label><select id="invite-role" className={selectClass} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="cashier">Cashier</option><option value="manager">Manager</option></select></div>
            <Button type="submit" disabled={busy} className="bg-emerald-600 hover:bg-emerald-700"><MailPlus className="mr-2 size-4" />Send invitation</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">People ({users.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? <p className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading staff…</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="border-b text-left text-muted-foreground"><th className="p-4">Person</th><th className="p-4">Role</th><th className="p-4">Status</th><th className="p-4">Last sign-in</th><th className="p-4 text-right">Access</th></tr></thead>
                <tbody>{users.map((user) => <tr key={user.id} className="border-b last:border-0">
                  <td className="p-4"><p className="font-medium">{user.full_name}</p><p className="text-xs text-muted-foreground">{user.email}</p></td>
                  <td className="p-4">{user.role === 'owner' ? <Badge>Owner</Badge> : <select aria-label={`Role for ${user.full_name}`} className={selectClass} disabled={busy} value={user.role} onChange={(event) => void run(() => send(`/api/users/${user.id}`, 'PATCH', { role: event.target.value }), `${user.full_name} is now a ${event.target.value}.`)}><option value="cashier">Cashier</option><option value="manager">Manager</option></select>}</td>
                  <td className="p-4">{!user.is_active ? <Badge variant="destructive">Disabled</Badge> : !user.email_verified ? <Badge variant="secondary">Unconfirmed</Badge> : <Badge variant="secondary">Active</Badge>}</td>
                  <td className="p-4 text-muted-foreground">{when(user.last_login_at)}</td>
                  <td className="p-4 text-right">{user.role !== 'owner' && (user.is_active
                    ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => send(`/api/users/${user.id}`, 'PATCH', { is_active: false }), `${user.full_name} can no longer sign in.`)}>Disable {user.full_name}</Button>
                    : <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => send(`/api/users/${user.id}`, 'PATCH', { is_active: true }), `${user.full_name} can sign in again.`)}>Enable {user.full_name}</Button>)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Pending invitations ({invites.length})</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {invites.length ? invites.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div><p className="font-medium">{item.email}</p><p className="text-xs capitalize text-muted-foreground">{item.role} · expires {new Date(item.expires_at).toLocaleDateString()}</p></div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => send(`/api/users/invites/${item.id}`, 'DELETE'), `Invitation for ${item.email} cancelled.`)}>Cancel invitation for {item.email}</Button>
          </div>) : <p className="py-4 text-center text-sm text-muted-foreground">No pending invitations.</p>}
        </CardContent>
      </Card>
    </section>
  )
}
