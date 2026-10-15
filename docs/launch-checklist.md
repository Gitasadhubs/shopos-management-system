# Launch checklist

Work through this in order on launch day. Each line is something to *do* and then *check*.

## Before you install

- [ ] **Code**: the release is merged into `prod` (dev → prod after the full test suite passed).
- [ ] **Domain**: bought, and a DNS **A record** for the app hostname (e.g. `app.myshopos.com`)
      points at the server's IP. Check: `nslookup app.myshopos.com` shows the server IP (or
      Cloudflare's, if proxied).
- [ ] **Email provider** account ready (Brevo/Gmail/Zoho/SES): SMTP host, login and password/key;
      sending domain verified with SPF, DKIM and DMARC records.
- [ ] **Payment details** ready: WhatsApp number for screenshots, JazzCash/EasyPaisa, bank account.
- [ ] Server reachable over SSH; provider firewall (if any) allows 22, 80, 443.

## Install (about 15 minutes)

- [ ] `curl -fsSL https://raw.githubusercontent.com/Gitasadhubs/shopos-management-system/prod/deploy/install.sh -o install.sh && sudo bash install.sh`
- [ ] Answer the questions (domain, certificate, email, payment details, admin account).
- [ ] The summary says **Reachable at https://…**; otherwise `shopos doctor`.
- [ ] Copy `/opt/shopos/.env.production` to your PC / password manager.

## Smoke test as a customer (10 minutes)

- [ ] Sign in at `/login` as the platform admin → `/admin` loads.
- [ ] In a private window, sign up a test shop at `/signup` with a real email you can read.
      Check: the confirmation email arrives (inbox, not spam) and the link works.
- [ ] Add 2 products (one with a photo), a customer; make a cash sale and a khata (credit) sale;
      print a receipt; do a return.
- [ ] Invite a cashier by email; accept in another browser; check the cashier cannot open Inventory.
- [ ] Billing shows **your** payment details; send a test payment proof; see it on `/admin/payments`;
      record a payment → the shop shows as active.
- [ ] Day end page shows today's numbers; **Send now** emails the report.
- [ ] On a phone: open the site, make a sale.

## Safety nets

- [ ] `shopos backup` works; copy the files off the server (see deployment.md → Backups).
- [ ] UptimeRobot (free): HTTP monitor on `https://<domain>/api/health`, keyword `"ok":true`,
      alerts to your email/phone.
- [ ] `shopos doctor` reports no problems.
- [ ] Delete or suspend the test shop in the admin panel when done (suspend keeps its data).

## Public pages

- [ ] Website (Vercel) `config.js`: WhatsApp number, email, `signupUrl: 'https://<domain>/signup'`;
      redeploy (`npx.cmd vercel@latest deploy --prod` from `shopos-growth/web`).
- [ ] Privacy policy and terms pages linked from the website footer and the sign-up page.
- [ ] Support WhatsApp number answers.

## First week

- [ ] Check `/admin` daily: new sign-ups, trials ending, payment proofs waiting.
- [ ] `shopos status` and the off-site backup copy, twice a week.
- [ ] `shopos update` only after the change passed the test suite on dev and preprod.
