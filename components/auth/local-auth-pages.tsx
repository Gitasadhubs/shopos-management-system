'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Check, LoaderCircle, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CelebrateIllustration, StorefrontIllustration } from '@/components/illustrations'

// Sign-in pages for self-hosted mode (email + password accounts in MariaDB, see lib/local-auth.ts).

const MIN_PASSWORD = 10

type ApiResult<T> = { data: T | null; error: string | null; code?: string }

async function post<T>(url: string, body: unknown): Promise<ApiResult<T> & { ok: boolean }> {
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const result = (await response.json()) as ApiResult<T>
    return { ...result, ok: response.ok }
  } catch {
    return { data: null, error: 'Could not reach the server. Check your connection and try again.', ok: false }
  }
}

// Only same-site paths, so a crafted ?next= link cannot send people to another site after sign-in.
function safeNext(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/dashboard'
}

const HIGHLIGHTS = ['Sell fast at the counter, even offline', 'Stock, suppliers and purchases in one place', 'Customer credit with WhatsApp reminders', 'Daily profit at a glance']
// The same, short enough to sit side by side on a phone.
const CHIPS = ['Works offline', 'Stock & suppliers', 'Customer credit', 'Daily profit']

function AuthShell({ title, subtitle, children, wide = false }: { title: string; subtitle?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="grid min-h-dvh bg-[#fbfaf7] lg:grid-cols-[1.05fr_1fr]">
      <aside aria-hidden="true" className="relative hidden overflow-hidden text-white shopos-hero lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 shopos-dots" />
        <div className="relative flex items-center gap-3"><div className="flex size-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30"><Store /></div><p className="text-2xl font-bold">ShopOS</p></div>
        <div className="relative">
          <StorefrontIllustration className="mx-auto w-full max-w-md drop-shadow-2xl shopos-float" />
          <p className="mt-8 text-3xl font-bold leading-tight">Run your whole shop<br />from one screen.</p>
          <ul className="mt-6 grid gap-3 text-emerald-50">{HIGHLIGHTS.map((item) => <li key={item} className="flex items-center gap-3"><span className="flex size-6 items-center justify-center rounded-full bg-white/20"><Check className="size-3.5" /></span>{item}</li>)}</ul>
        </div>
        <p className="relative text-xs text-emerald-100/80">Made for independent shops, anywhere in the world.</p>
      </aside>
      <div className="flex flex-col items-center lg:justify-center lg:px-4 lg:py-10">
        {/* Phones and tablets: the brand panel becomes a short banner above the form. */}
        <header className="relative w-full overflow-hidden px-5 pb-12 pt-6 text-white shopos-hero lg:hidden">
          <div className="absolute inset-0 shopos-dots" />
          <a href="https://getshopos.online" className="relative flex w-fit items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30"><Store className="size-5" /></span><span className="text-lg font-bold">ShopOS</span></a>
          <p className="relative mt-4 text-xl font-bold leading-snug">Run your whole shop from one screen.</p>
          <ul className="relative mt-3 flex flex-wrap gap-1.5 text-xs font-medium">{CHIPS.map((chip) => <li key={chip} className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 ring-1 ring-white/20"><Check className="size-3" />{chip}</li>)}</ul>
        </header>
        <div className={`relative -mt-7 w-full px-3 pb-8 sm:px-4 lg:mt-0 lg:px-0 lg:pb-0 ${wide ? 'max-w-[480px]' : 'max-w-[420px]'} shopos-rise`}>
          <section className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-xl shadow-stone-900/5 sm:rounded-3xl sm:p-7">
            <h1 className="text-xl font-bold text-stone-900">{title}</h1>
            {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </section>
          <p className="mt-4 text-center text-xs text-muted-foreground lg:hidden">
            <a href="https://getshopos.online/terms" className="underline-offset-2 hover:underline">Terms</a> · <a href="https://getshopos.online/privacy" className="underline-offset-2 hover:underline">Privacy</a> · <a href={PARTNER_SIGN_IN} className="underline-offset-2 hover:underline">Partner sign in</a>
          </p>
        </div>
      </div>
    </main>
  )
}

// Partners (who bring shops) have their own page on the website; it opens its sign-in dialog from #sign-in.
const PARTNER_SIGN_IN = 'https://getshopos.online/partners#sign-in'

function Field({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return <div className="grid gap-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} className="h-11" {...props} /></div>
}

function Notice({ tone, children }: { tone: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  const styles = { error: 'border-rose-200 bg-rose-50 text-rose-700', success: 'border-emerald-200 bg-emerald-50 text-emerald-800', info: 'border-stone-200 bg-stone-50 text-stone-700' }
  return <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${styles[tone]}`}>{children}</p>
}

// Server-rendered buttons are visible before React loads; a click then would submit the form natively
// and be lost. Buttons stay disabled until the page is interactive.
function useHydrated() {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  return hydrated
}

function SubmitButton({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  const hydrated = useHydrated()
  return <Button type="submit" disabled={busy || !hydrated} className="h-11 w-full bg-emerald-600 hover:bg-emerald-700">{busy ? <LoaderCircle className="size-4 animate-spin" /> : children}</Button>
}

function passwordProblem(password: string, confirm: string) {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`
  if (password !== confirm) return 'The passwords do not match.'
  return ''
}

function ResendVerification({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | string>('idle')
  async function resend() {
    setState('busy')
    const result = await post('/api/auth/resend-verification', { email })
    setState(result.ok ? 'sent' : result.error ?? 'Could not send the link.')
  }
  if (state === 'sent') return <Notice tone="success">If {email} still needs confirming, a new link is on its way.</Notice>
  return <div className="grid gap-2">
    <Button type="button" variant="outline" disabled={state === 'busy'} onClick={() => void resend()}>Send a new link</Button>
    {state !== 'idle' && state !== 'busy' && <Notice tone="error">{state}</Notice>}
  </div>
}

export function LocalLoginPage() {
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = await post('/api/auth/login', { email, password })
    if (result.ok) {
      window.location.assign(safeNext(params.get('next')))
      return
    }
    setError({ message: result.error ?? 'Could not sign in.', code: result.code })
    setBusy(false)
  }

  const notice = params.get('verified') ? 'Email confirmed. Sign in to continue.' : params.get('signed_out') ? 'You have been signed out.' : ''
  return (
    <AuthShell title="Sign in" subtitle="Use the email and password for your ShopOS account.">
      <form onSubmit={submit} className="grid gap-4">
        {notice && <Notice tone="success">{notice}</Notice>}
        <Field id="login-email" label="Email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        <Field id="login-password" label="Password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        {error && <Notice tone="error">{error.message}</Notice>}
        {error?.code === 'unverified' && <ResendVerification email={email} />}
        <SubmitButton busy={busy}>Sign in</SubmitButton>
        <Link href="/forgot-password" className="text-center text-sm font-medium text-emerald-700">Forgot password?</Link>
        <p className="border-t pt-4 text-center text-sm text-muted-foreground">New to ShopOS? <Link href="/signup" className="font-semibold text-emerald-700">Create your shop</Link> — free for 14 days.</p>
        <a href={PARTNER_SIGN_IN} className="-mt-1 flex items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm font-medium text-violet-800 hover:bg-violet-100">ShopOS partner? <span className="font-semibold underline underline-offset-2">Partner sign in</span></a>
      </form>
    </AuthShell>
  )
}

// Public signup: a new shop on a free trial, with the person signing up as its owner.
// requireCard: trials need a card (admin setting); the owner adds it on Billing after confirming the email.
export function LocalSignupPage({ requireCard = false }: { requireCard?: boolean }) {
  const [form, setForm] = useState({ shop_name: '', full_name: '', phone: '', email: '', password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState('')
  // A partner's referral code: from this link (?ref=CODE), or remembered from an earlier visit.
  const params = useSearchParams()
  const [ref, setRef] = useState('')
  useEffect(() => {
    const fromLink = params.get('ref')?.trim() ?? ''
    try {
      if (fromLink) localStorage.setItem('shopos-ref', fromLink)
      setRef(fromLink || localStorage.getItem('shopos-ref') || '')
    } catch {
      setRef(fromLink)
    }
  }, [params])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const problem = passwordProblem(form.password, form.confirm)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    const result = await post<{ email: string }>('/api/auth/signup', { shop_name: form.shop_name, full_name: form.full_name, phone: form.phone, email: form.email, password: form.password, ...(ref ? { ref } : {}) })
    setBusy(false)
    if (result.ok || result.code === 'email_failed') setCreated(result.data?.email ?? form.email)
    if (!result.ok) setError(result.error ?? 'Could not create your shop.')
  }

  if (created) {
    return (
      <AuthShell title="Check your email" subtitle={`We sent a confirmation link to ${created}. Open it to activate your shop, then sign in${requireCard ? ' and add your card to start the free trial' : ''}.`}>
        <div className="grid gap-3">
          <CelebrateIllustration className="mx-auto h-28 w-auto" />
          {error && <Notice tone="error">{error}</Notice>}
          <ResendVerification email={created} />
          <Link href="/login" className="text-center text-sm font-medium text-emerald-700">Go to sign in</Link>
        </div>
      </AuthShell>
    )
  }

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value })
  return (
    <AuthShell wide title="Create your shop" subtitle={requireCard ? 'Free for 14 days. You add a card to start; nothing is charged until the trial ends, and you can cancel any time.' : 'Free for 14 days. No card needed.'}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field id="signup-shop" label="Shop name" required maxLength={120} value={form.shop_name} onChange={set('shop_name')} /></div>
        <Field id="signup-name" label="Your name" autoComplete="name" required maxLength={120} value={form.full_name} onChange={set('full_name')} />
        <Field id="signup-phone" label="Phone (optional)" type="tel" autoComplete="tel" maxLength={40} value={form.phone} onChange={set('phone')} />
        <div className="sm:col-span-2"><Field id="signup-email" label="Email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} /></div>
        <Field id="signup-password" label="Password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={form.password} onChange={set('password')} />
        <Field id="signup-confirm" label="Confirm password" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} />
        {error && <div className="sm:col-span-2"><Notice tone="error">{error}</Notice></div>}
        <div className="sm:col-span-2"><SubmitButton busy={busy}>Create my shop</SubmitButton></div>
        <p className="text-center text-sm text-muted-foreground sm:col-span-2">Already have a shop? <Link href="/login" className="font-semibold text-emerald-700">Sign in</Link></p>
      </form>
    </AuthShell>
  )
}

export function LocalSetupPage() {
  const [form, setForm] = useState({ full_name: '', email: '', password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const problem = passwordProblem(form.password, form.confirm)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    const result = await post<{ email: string }>('/api/auth/setup', { full_name: form.full_name, email: form.email, password: form.password })
    setBusy(false)
    // email_failed: the account exists but the confirmation email did not go out; offer a resend.
    if (result.ok || result.code === 'email_failed') setCreated(result.data?.email ?? form.email)
    if (!result.ok) setError(result.error ?? 'Could not create the account.')
  }

  if (created) {
    return (
      <AuthShell title="Check your email" subtitle={`We sent a confirmation link to ${created}. Open it to activate the admin account, then sign in.`}>
        <div className="grid gap-3">
          {error && <Notice tone="error">{error}</Notice>}
          <ResendVerification email={created} />
          <Link href="/login" className="text-center text-sm font-medium text-emerald-700">Go to sign in</Link>
        </div>
      </AuthShell>
    )
  }

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value })
  return (
    <AuthShell title="Set up ShopOS" subtitle="Create the admin account for this ShopOS service. You will manage shops and subscriptions from the admin panel; shops sign up on their own.">
      <form onSubmit={submit} className="grid gap-4">
        <Field id="setup-name" label="Your name" autoComplete="name" required maxLength={120} value={form.full_name} onChange={set('full_name')} />
        <Field id="setup-email" label="Email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        <Field id="setup-password" label="Password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={form.password} onChange={set('password')} />
        <Field id="setup-confirm" label="Confirm password" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} />
        {error && <Notice tone="error">{error}</Notice>}
        <SubmitButton busy={busy}>Create admin account</SubmitButton>
      </form>
    </AuthShell>
  )
}

export function LocalForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const result = await post('/api/auth/forgot-password', { email })
    setBusy(false)
    if (result.ok) setSent(true)
    else setError(result.error ?? 'Could not send the link.')
  }

  return (
    <AuthShell title="Reset your password" subtitle="Enter your account email and we will send you a reset link.">
      {sent ? (
        <div className="grid gap-3">
          <Notice tone="success">If an account exists for {email}, a reset link is on its way. It expires in 1 hour.</Notice>
          <Link href="/login" className="text-center text-sm font-medium text-emerald-700">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <Field id="forgot-email" label="Email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          {error && <Notice tone="error">{error}</Notice>}
          <SubmitButton busy={busy}>Send reset link</SubmitButton>
          <Link href="/login" className="text-center text-sm font-medium text-emerald-700">Back to sign in</Link>
        </form>
      )}
    </AuthShell>
  )
}

function InvalidLink({ title, action }: { title: string; action: { href: string; label: string } }) {
  return <AuthShell title={title}><div className="grid gap-3"><Notice tone="error">This link is invalid or has expired.</Notice><Link href={action.href} className="text-center text-sm font-medium text-emerald-700">{action.label}</Link></div></AuthShell>
}

export function LocalResetPasswordPage() {
  const token = useSearchParams().get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!token) return <InvalidLink title="Reset your password" action={{ href: '/forgot-password', label: 'Request a new link' }} />

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const problem = passwordProblem(password, confirm)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    const result = await post('/api/auth/reset-password', { token, password })
    if (result.ok) return window.location.assign('/dashboard')
    setBusy(false)
    setError(result.error ?? 'Could not reset the password.')
  }

  return (
    <AuthShell title="Choose a new password" subtitle="This signs you out on every other device.">
      <form onSubmit={submit} className="grid gap-4">
        <Field id="reset-password" label="New password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={password} onChange={(event) => setPassword(event.target.value)} />
        <Field id="reset-confirm" label="Confirm password" type="password" autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        {error && <Notice tone="error">{error}</Notice>}
        <SubmitButton busy={busy}>Save new password</SubmitButton>
        <Link href="/forgot-password" className="text-center text-sm font-medium text-emerald-700">Request a new link</Link>
      </form>
    </AuthShell>
  )
}

export function LocalVerifyEmailPage() {
  const hydrated = useHydrated()
  const token = useSearchParams().get('token') ?? ''
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!token) return <InvalidLink title="Confirm your email" action={{ href: '/login', label: 'Go to sign in' }} />

  // A button rather than confirming on load, so link scanners in mail apps cannot use up the token.
  async function confirm() {
    setBusy(true)
    setError('')
    const result = await post('/api/auth/verify-email', { token })
    if (result.ok) return window.location.assign('/login?verified=1')
    setBusy(false)
    setError(result.error ?? 'Could not confirm the email.')
  }

  return (
    <AuthShell title="Confirm your email" subtitle="One click and your account is ready.">
      <div className="grid gap-3">
        {error && <Notice tone="error">{error}</Notice>}
        <Button disabled={busy || !hydrated} onClick={() => void confirm()} className="h-11 w-full bg-emerald-600 hover:bg-emerald-700">{busy ? <LoaderCircle className="size-4 animate-spin" /> : 'Confirm email'}</Button>
        <Link href="/login" className="text-center text-sm font-medium text-emerald-700">Go to sign in</Link>
      </div>
    </AuthShell>
  )
}

export function LocalAcceptInvitePage() {
  const token = useSearchParams().get('token') ?? ''
  const [invite, setInvite] = useState<{ email: string; role: string; full_name: string | null; shop_name?: string } | null | 'invalid'>(null)
  const [form, setForm] = useState({ full_name: '', password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return setInvite('invalid')
    fetch(`/api/auth/invite?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) return setInvite('invalid')
        setInvite(body.data)
        setForm((current) => ({ ...current, full_name: body.data.full_name ?? '' }))
      })
      .catch(() => setInvite('invalid'))
  }, [token])

  if (invite === 'invalid') return <InvalidLink title="Join ShopOS" action={{ href: '/login', label: 'Go to sign in' }} />
  if (!invite) return <AuthShell title="Join ShopOS"><p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading invitation…</p></AuthShell>

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const problem = passwordProblem(form.password, form.confirm)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    const result = await post('/api/auth/invite', { token, full_name: form.full_name, password: form.password })
    if (result.ok) return window.location.assign('/dashboard')
    setBusy(false)
    setError(result.error ?? 'Could not accept the invitation.')
  }

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value })
  return (
    <AuthShell title={`Join ${invite.shop_name ?? 'ShopOS'}`} subtitle={`You are invited as a ${invite.role} with ${invite.email}. Choose your name and password.`}>
      <form onSubmit={submit} className="grid gap-4">
        <Field id="invite-name" label="Your name" autoComplete="name" required maxLength={120} value={form.full_name} onChange={set('full_name')} />
        <Field id="invite-password" label="Password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={form.password} onChange={set('password')} />
        <Field id="invite-confirm" label="Confirm password" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} />
        {error && <Notice tone="error">{error}</Notice>}
        <SubmitButton busy={busy}>Join shop</SubmitButton>
      </form>
    </AuthShell>
  )
}
