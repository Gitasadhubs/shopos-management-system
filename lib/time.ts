// Calendar days in a shop's time zone. The database stores UTC; "today" and report days follow the shop.

export const DEFAULT_TIMEZONE = 'Asia/Karachi'

export function isValidTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

// Minutes the zone is ahead of UTC at the given instant (Karachi: +300).
function offsetMinutes(zone: string, at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000)
}

// 'YYYY-MM-DD' for the instant as seen in the zone.
export function dayKey(zone: string, at: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

// The UTC instant a local calendar day starts.
export function dayStart(zone: string, key: string) {
  const guess = Date.parse(`${key}T00:00:00Z`)
  let start = guess - offsetMinutes(zone, new Date(guess)) * 60_000
  // Across a DST change the first guess can be an hour off; one correction settles it.
  start = guess - offsetMinutes(zone, new Date(start)) * 60_000
  return new Date(start)
}

export function addDays(key: string, days: number) {
  const date = new Date(`${key}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Every day key from `from` to `to`, inclusive.
export function dayRange(from: string, to: string) {
  const days: string[] = []
  for (let key = from; key <= to && days.length < 400; key = addDays(key, 1)) days.push(key)
  return days
}
