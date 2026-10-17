import nodemailer, { type Transporter } from 'nodemailer'

// SMTP settings come from SHOPOS_SMTP_*; on this PC they point at Mailpit, a local test inbox.

const store = globalThis as typeof globalThis & { shoposMailer?: Transporter }

function transporter() {
  store.shoposMailer ??= nodemailer.createTransport({
    host: process.env.SHOPOS_SMTP_HOST ?? 'localhost',
    port: Number(process.env.SHOPOS_SMTP_PORT ?? 587),
    secure: process.env.SHOPOS_SMTP_SECURE === 'true',
    auth: process.env.SHOPOS_SMTP_USER ? { user: process.env.SHOPOS_SMTP_USER, pass: process.env.SHOPOS_SMTP_PASSWORD ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  })
  return store.shoposMailer
}

export function publicUrl(path: string) {
  return new URL(path, process.env.SHOPOS_PUBLIC_URL ?? 'http://localhost:3000').toString()
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

async function send(to: string, subject: string, lines: string[], action: { label: string; url: string }) {
  const text = [...lines, '', `${action.label}: ${action.url}`, '', 'If you did not expect this email, you can ignore it.'].join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;color:#1c1917">
    <p style="font-size:18px;font-weight:700">Shop<span style="color:#059669">OS</span></p>
    ${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
    <p><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#059669;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${escapeHtml(action.label)}</a></p>
    <p style="font-size:12px;color:#78716c">Or open this link: ${escapeHtml(action.url)}<br>If you did not expect this email, you can ignore it.</p>
  </div>`
  await transporter().sendMail({ from: process.env.SHOPOS_MAIL_FROM ?? 'ShopOS <no-reply@shopos.local>', to, subject, text, html })
}

export function sendVerificationEmail(to: string, name: string, token: string) {
  return send(to, 'Confirm your ShopOS email', [`Hi ${name},`, 'Confirm this email address to finish setting up your ShopOS account. The link expires in 24 hours.'], { label: 'Confirm email', url: publicUrl(`/verify-email?token=${token}`) })
}

export function sendPasswordResetEmail(to: string, name: string, token: string) {
  return send(to, 'Reset your ShopOS password', [`Hi ${name},`, 'Someone asked to reset the password for this ShopOS account. The link expires in 1 hour and works once.'], { label: 'Choose a new password', url: publicUrl(`/reset-password?token=${token}`) })
}

export function sendInviteEmail(to: string, inviterName: string, shopName: string, role: string, token: string) {
  return send(to, `You are invited to ${shopName} on ShopOS`, [`${inviterName} invited you to join ${shopName} on ShopOS as a ${role}.`, 'Choose your name and password to accept. The invitation expires in 7 days.'], { label: 'Accept invitation', url: publicUrl(`/accept-invite?token=${token}`) })
}

// The day-end report: plain text as sent on WhatsApp, laid out as a simple HTML table for email.
export function sendDayEndEmail(to: string, subject: string, text: string, rows: Array<[string, string]>, footer: string) {
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#1c1917">
    <p style="font-size:18px;font-weight:700">Shop<span style="color:#059669">OS</span></p>
    <p style="font-size:16px;font-weight:600">${escapeHtml(subject)}</p>
    <table style="border-collapse:collapse;width:100%">${rows.map(([label, value]) => `<tr><td style="padding:6px 0;color:#57534e">${escapeHtml(label)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${escapeHtml(value)}</td></tr>`).join('')}</table>
    <p style="font-size:13px;color:#57534e">${escapeHtml(footer)}</p>
    <p style="font-size:12px;color:#78716c">Turn these emails off in ShopOS under Settings, Day-end report.</p>
  </div>`
  return transporter().sendMail({ from: process.env.SHOPOS_MAIL_FROM ?? 'ShopOS <no-reply@shopos.local>', to, subject, text, html })
}

// Partner (affiliate) program, lib/local-affiliates.ts. The private page link is the partner's only way in.
export function sendAffiliateReceivedEmail(to: string, name: string, pageUrl: string) {
  return send(to, 'We received your ShopOS partner application', [`Hi ${name},`, 'Thanks for applying to the ShopOS partner program. We review every application, usually within a day, and email you when it is approved.', 'Until then, the button below shows the status of your application. When you are approved we email you your referral link and a new private link to your partner page.'], { label: 'Open my partner page', url: pageUrl })
}

export function sendAffiliateApprovedEmail(to: string, name: string, referralLink: string, pageUrl: string) {
  return send(to, 'You are a ShopOS partner', [`Hi ${name},`, 'Your partner application is approved.', `Share your referral link with shop owners: ${referralLink}`, 'Every shop that signs up through it and pays earns you 20% of its payments for its first 12 paid months. We pay what you earned once a month, to the account you gave us.'], { label: 'Open my partner page', url: pageUrl })
}

export function sendAffiliateSignInEmail(to: string, name: string, pageUrl: string) {
  return send(to, 'Your ShopOS partner page', [`Hi ${name},`, 'Here is your link to your ShopOS partner page, with your referral link, your shops and your earnings. It replaces any earlier link.'], { label: 'Open my partner page', url: pageUrl })
}
