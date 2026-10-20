// Can this device reach the ShopOS server right now? One checker per browser tab, shared by the till
// and the offline page. It asks /api/health (never cached, with a timeout) and tells apart:
//   online       the server answered: sales go straight to it
//   no-network   the device itself has no network (Wi-Fi or cable off, airplane mode)
//   no-internet  the device has a network but nothing answers: no internet, DNS trouble, a Wi-Fi login page
//   server-down  the internet works but ShopOS does not (an error page from Cloudflare or nginx, or its database is down)
// One failed check is not enough to call the till offline, because a slow moment would make the screen
// flip back and forth; two in a row are, or the browser reporting that the network is gone. One good
// answer brings it back at once. Offline it checks every few seconds, slowing to 30 s; online every 30 s,
// and straight away when the tab comes back to the front, the browser reports a network change, or a
// real request fails (reportFailure).

export type Connection = 'checking' | 'online' | 'no-network' | 'no-internet' | 'server-down'
export type ConnectivityState = { status: Connection; checking: boolean; checkedAt: number | null; latencyMs: number | null }

const TIMEOUT_MS = 6000
const ONLINE_EVERY_MS = 30_000
const RECHECK_SOON_MS = 2000
const OFFLINE_EVERY_MS = [3000, 5000, 10_000, 20_000, 30_000]
const FAILURES_TO_GO_OFFLINE = 2

let state: ConnectivityState = { status: 'checking', checking: false, checkedAt: null, latencyMs: null }
const listeners = new Set<() => void>()
let failures = 0
let offlineRounds = 0
let timer: ReturnType<typeof setTimeout> | undefined
let running: Promise<Connection> | null = null
let started = false

function update(patch: Partial<ConnectivityState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

async function probe(): Promise<{ result: Exclude<Connection, 'checking'>; latencyMs: number | null }> {
  if (!navigator.onLine) return { result: 'no-network', latencyMs: null }
  const begin = performance.now()
  try {
    const response = await fetch(`/api/health?probe=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } })
    const body = await response.json().catch(() => null)
    if (response.ok && body?.ok === true) return { result: 'online', latencyMs: Math.round(performance.now() - begin) }
    // A 200 that is not our health answer is a Wi-Fi login page or a proxy: no real internet.
    return { result: response.ok ? 'no-internet' : 'server-down', latencyMs: null }
  } catch {
    return { result: navigator.onLine ? 'no-internet' : 'no-network', latencyMs: null }
  }
}

function schedule() {
  clearTimeout(timer)
  const delay = state.status === 'online' ? (failures ? RECHECK_SOON_MS : ONLINE_EVERY_MS) : OFFLINE_EVERY_MS[Math.min(offlineRounds++, OFFLINE_EVERY_MS.length - 1)]
  timer = setTimeout(() => void checkNow(), delay)
}

function wentOnline(latencyMs: number | null) {
  failures = 0
  offlineRounds = 0
  update({ status: 'online', checking: false, checkedAt: Date.now(), latencyMs })
}

// Checks now (a check already running is shared) and returns the status after it.
export function checkNow(): Promise<Connection> {
  start()
  running ??= (async () => {
    update({ checking: true })
    const { result, latencyMs } = await probe()
    if (result === 'online') wentOnline(latencyMs)
    else {
      failures += 1
      const confirmed = result === 'no-network' || state.status !== 'online' || failures >= FAILURES_TO_GO_OFFLINE
      if (confirmed && state.status === 'online') offlineRounds = 0
      update({ status: confirmed ? result : state.status, checking: false, checkedAt: Date.now(), latencyMs: null })
    }
    schedule()
    return state.status
  })().finally(() => { running = null })
  return running
}

// A real request just failed for lack of a connection: one more failed check confirms it.
export function reportFailure() {
  failures = Math.max(failures, FAILURES_TO_GO_OFFLINE - 1)
  void checkNow()
}

// A real request just reached the server.
export function reportSuccess() {
  if (state.status !== 'online') { wentOnline(null); schedule() }
}

export const getConnectivity = () => state
// The server can be used: confirmed, or not checked yet while the browser has a network.
export const reachable = () => state.status === 'online' || (state.status === 'checking' && (typeof navigator === 'undefined' || navigator.onLine))

export function subscribe(listener: () => void) {
  start()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function start() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('online', () => { failures = 0; void checkNow() })
  window.addEventListener('offline', () => { failures = FAILURES_TO_GO_OFFLINE; offlineRounds = 0; update({ status: 'no-network', checkedAt: Date.now(), latencyMs: null }); schedule() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkNow() })
  void checkNow()
}
