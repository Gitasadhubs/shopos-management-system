'use client'

import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/components/auth/auth-provider'

const MIN_PASSWORD = 10

export default function AccountPage() {
  const { user, signOut } = useAuth()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function changePassword(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (form.next.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`)
    if (form.next !== form.confirm) return setError('The new passwords do not match.')
    setBusy(true)
    try {
      const response = await fetch('/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ current_password: form.current, new_password: form.next }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not change the password.')
      setForm({ current: '', next: '', confirm: '' })
      setSuccess('Password changed. Other devices have been signed out.')
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Could not change the password.')
    } finally {
      setBusy(false)
    }
  }

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value })
  return (
    <section className="max-w-2xl">
      <div className="mb-6"><h1 className="text-3xl font-bold tracking-tight">Account</h1><p className="mt-1 text-sm text-muted-foreground">Your sign-in details.</p></div>
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p><span className="text-muted-foreground">Name:</span> {user?.full_name}</p>
          <p><span className="text-muted-foreground">Email:</span> {user?.email}</p>
          <p className="flex items-center gap-2"><span className="text-muted-foreground">Role:</span> <Badge variant="secondary" className="capitalize">{user?.role}</Badge></p>
          <Button variant="outline" className="mt-2 w-fit" onClick={() => void signOut()}><LogOut className="mr-2 size-4" />Sign out</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Change password</CardTitle><p className="text-xs text-muted-foreground">Changing it signs you out on every other device.</p></CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="grid gap-4">
            <div className="grid gap-1.5"><Label htmlFor="account-current">Current password</Label><Input id="account-current" type="password" autoComplete="current-password" required value={form.current} onChange={set('current')} /></div>
            <div className="grid gap-1.5"><Label htmlFor="account-new">New password</Label><Input id="account-new" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={form.next} onChange={set('next')} /></div>
            <div className="grid gap-1.5"><Label htmlFor="account-confirm">Confirm new password</Label><Input id="account-confirm" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} /></div>
            {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}
            {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
            <Button type="submit" disabled={busy} className="w-fit bg-emerald-600 hover:bg-emerald-700">{busy ? 'Saving…' : 'Change password'}</Button>
          </form>
        </CardContent>
      </Card>
    </section>
  )
}
