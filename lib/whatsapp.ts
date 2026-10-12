// Sends WhatsApp messages through Meta's WhatsApp Cloud API. Off until these are set:
//   SHOPOS_WHATSAPP_TOKEN      permanent access token of a system user
//   SHOPOS_WHATSAPP_PHONE_ID   the sending phone number's ID (WhatsApp Manager → API setup)
//   SHOPOS_WHATSAPP_TEMPLATE   approved template name (default daily_report), see DEPLOYMENT.md
//   SHOPOS_WHATSAPP_LANG       template language code (default en)
// Messages a business starts must use an approved template, so the report goes out as template
// parameters rather than free text.

const API_VERSION = 'v21.0'

export function whatsAppConfigured() {
  return Boolean(process.env.SHOPOS_WHATSAPP_TOKEN && process.env.SHOPOS_WHATSAPP_PHONE_ID)
}

// '0300-1234567' → '923001234567'. Numbers saved with a leading 0 get the country code.
export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (!digits) return null
  const country = (process.env.SHOPOS_WHATSAPP_COUNTRY_CODE ?? '92').replace(/\D/g, '')
  const international = digits.startsWith('00') ? digits.slice(2) : digits.startsWith('0') ? `${country}${digits.slice(1)}` : digits
  return international.length >= 10 && international.length <= 15 ? international : null
}

export function parsePhoneList(value: string | null | undefined) {
  return (value ?? '').split(/[,;\n]/).map((part) => part.trim()).filter(Boolean)
}

// Template parameters may not contain new lines, tabs or more than four spaces in a row.
const cleanParameter = (text: string) => text.replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 1000)

export async function sendWhatsAppTemplate(to: string, parameters: string[]) {
  const phone = normalizePhone(to)
  if (!phone) throw new Error(`"${to}" is not a valid WhatsApp number.`)
  const response = await fetch(`https://graph.facebook.com/${API_VERSION}/${process.env.SHOPOS_WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SHOPOS_WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: process.env.SHOPOS_WHATSAPP_TEMPLATE || 'daily_report',
        language: { code: process.env.SHOPOS_WHATSAPP_LANG || 'en' },
        components: [{ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text: cleanParameter(text) })) }],
      },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new Error(body?.error?.message ?? `WhatsApp returned HTTP ${response.status}.`)
  }
}
