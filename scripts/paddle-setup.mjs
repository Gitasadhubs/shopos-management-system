// Creates what ShopOS needs in a Paddle account and prints the SHOPOS_PADDLE_* lines for the env file:
// the Starter and Growth products, their monthly and yearly USD prices, and the webhook destination.
// Safe to run again: anything that already exists (same name, amount and interval, or same URL) is reused.
//
//   docker run --rm -e PADDLE_API_KEY=... -e PADDLE_ENV=sandbox -e APP_URL=https://app.example.com \
//     -v "$PWD/scripts:/scripts:ro" node:22-alpine node /scripts/paddle-setup.mjs
//
// PADDLE_ENV: sandbox (default) or production. APP_URL: the public address of the app (the webhook is
// APP_URL/api/billing/paddle and must be reachable from the internet).

const apiKey = process.env.PADDLE_API_KEY?.trim()
const environment = process.env.PADDLE_ENV === 'production' ? 'production' : 'sandbox'
const appUrl = process.env.APP_URL?.trim().replace(/\/$/, '')
if (!apiKey || !appUrl) {
  console.error('Set PADDLE_API_KEY and APP_URL (and PADDLE_ENV=production for the live account).')
  process.exit(1)
}
const base = environment === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com'

// Keep in step with lib/plans.ts.
const PLANS = [
  { key: 'STARTER', name: 'ShopOS Starter', description: '1 shop, up to 3 staff. POS, inventory, credit, reports.', prices: { month: 900, year: 9000 } },
  { key: 'GROWTH', name: 'ShopOS Growth', description: '1 shop, unlimited staff, everything in ShopOS.', prices: { month: 1900, year: 19000 } },
]
const EVENTS = ['transaction.completed', 'subscription.created', 'subscription.updated', 'subscription.activated', 'subscription.canceled', 'subscription.past_due', 'subscription.paused', 'subscription.resumed']

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${payload?.error?.detail ?? payload?.error?.code ?? ''}`)
  return payload.data
}

const lines = [`SHOPOS_PADDLE_ENV=${environment}`]

for (const plan of PLANS) {
  const products = await call('GET', `/products?status=active&per_page=200`)
  let product = products.find((item) => item.name === plan.name)
  if (!product) {
    product = await call('POST', '/products', { name: plan.name, description: plan.description, tax_category: 'saas' })
    console.log(`created product ${plan.name} (${product.id})`)
  } else {
    console.log(`found product ${plan.name} (${product.id})`)
  }
  const prices = await call('GET', `/prices?product_id=${product.id}&status=active&per_page=200`)
  for (const [interval, amount] of Object.entries(plan.prices)) {
    let price = prices.find((item) => item.billing_cycle?.interval === interval && item.billing_cycle?.frequency === 1 && item.unit_price?.currency_code === 'USD' && Number(item.unit_price?.amount) === amount)
    if (!price) {
      price = await call('POST', '/prices', {
        product_id: product.id,
        description: `${plan.name} ${interval === 'year' ? 'yearly' : 'monthly'}`,
        name: interval === 'year' ? 'Yearly' : 'Monthly',
        unit_price: { amount: String(amount), currency_code: 'USD' },
        billing_cycle: { interval, frequency: 1 },
        quantity: { minimum: 1, maximum: 1 },
      })
      console.log(`  created ${interval}ly price $${amount / 100} (${price.id})`)
    } else {
      console.log(`  found ${interval}ly price $${amount / 100} (${price.id})`)
    }
    lines.push(`SHOPOS_PADDLE_PRICE_${plan.key}_${interval.toUpperCase()}=${price.id}`)
  }
}

const destination = `${appUrl}/api/billing/paddle`
const settings = await call('GET', '/notification-settings')
let setting = settings.find((item) => item.destination === destination)
if (!setting) {
  setting = await call('POST', '/notification-settings', { description: 'ShopOS app', destination, type: 'url', subscribed_events: EVENTS, include_sensitive_fields: false })
  console.log(`created webhook ${destination}`)
} else {
  console.log(`found webhook ${destination} (check it is subscribed to: ${EVENTS.join(', ')})`)
}
lines.push(`SHOPOS_PADDLE_WEBHOOK_SECRET=${setting.endpoint_secret_key}`)
lines.push(`SHOPOS_PADDLE_API_KEY=${apiKey}`)
lines.push('# Developer tools > Authentication > Client-side tokens: create one and paste it here.')
lines.push('SHOPOS_PADDLE_CLIENT_TOKEN=')

console.log('\nAdd these to the env file (.env.production), then restart the app:\n')
console.log(lines.join('\n'))
console.log(`\nAlso set the default payment link (Checkout > Checkout settings) to ${appUrl}/billing and approve the domain ${new URL(appUrl).host}.`)
