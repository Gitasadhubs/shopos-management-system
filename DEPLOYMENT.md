# Deploying ShopOS (production and preprod)

> **On a server, use the installer:** `sudo bash deploy/install.sh` sets up everything below (Docker,
> firewall, settings, certificate, email, admin account, backups, the `shopos` command). See
> [docs/deployment.md](docs/deployment.md). This page describes the stack itself and running it on this PC.

The deployment stack is `docker-compose.yml`. Each environment is one copy of the stack with its own
project name, env file, ports, volumes and backups, so production and preprod can share a machine.

| Service | Image | Purpose |
|---|---|---|
| `db` | `mariadb:11.4` (LTS) | Data. Not published to the host; only `app` and `backup` can reach it. |
| `minio` | `pgsty/minio` (community build of MinIO) | S3 file storage: product photos and payment proofs. Only `app` uses the S3 API; the web console is on this PC only. |
| `app` | built from `Dockerfile` | Next.js production build, non-root user. Runs DB migrations on start. |
| `nginx` | built from `deploy/nginx` (official `nginx` 1.30) | HTTPS, HTTP→HTTPS redirect, compression, security headers, sign-in flood limit, real visitor IP. [docs/nginx.md](docs/nginx.md). |
| `certbot` | `certbot/certbot` | Gets and renews Let's Encrypt certificates (`COMPOSE_PROFILES=letsencrypt`). |
| `backup` | `mariadb:11.4` | `mariadb-dump` and an archive of the stored files, on start and then daily into a host folder, with retention. |
| `mailpit` | `axllent/mailpit` | Optional local inbox (`COMPOSE_PROFILES=mailpit`) until a real mail provider is set up. |

On this PC:

| Environment | Address | Mail inbox (this PC only) | File storage console (this PC only) | Backups |
|---|---|---|---|---|
| Production | https://localhost | http://localhost:8025 | http://localhost:9001 | `backups/production` |
| Preprod | https://localhost:8443 | http://localhost:8026 | http://localhost:9011 | `backups/preprod` |
| Dev | http://localhost:3000 | http://localhost:8027 | http://localhost:9021 | none |

## Accounts, shops and subscriptions

One install serves many shops. Each shop's data is kept apart from every other shop's.

- **First start:** opening the site goes to **Set up ShopOS**. The first account is the **platform
  admin**: you, running the service. The admin belongs to no shop and works in the admin panel at
  `/admin` (Overview, Shops, Subscriptions, Payments). Nobody else can see `/admin`; it is a 404 for them.
- **Shops sign up** at `/signup` (linked from the sign-in page) with a shop name, their name, email and
  password. They become that shop's **owner** and start a **14-day free trial** at ₨1,500/month.
  New signups are limited to `SHOPOS_SIGNUP_LIMIT` per IP address per hour (default 10).
- **Subscriptions** are managed by the admin from each shop's page:
  - **Record a payment** (amount, months, method, reference): adds the months on top of any time
    already paid and makes the shop active.
  - **Add days** (free time), **Suspend** / **Resume**, **End subscription now**, and a per-shop
    **monthly price**.
  - A shop whose trial or paid period has ended, or that is suspended, becomes **read-only**: its
    people can still sign in and see everything, but changes are refused until it is renewed.
  - Owners see their plan, payment history and how to pay on **Billing**. The bank and wallet details
    shown there come from `SHOPOS_PAY_*` in the env file.
  - Owners **send a payment proof** (screenshot or PDF, up to 5 MB, 10 a day) from Billing, even while
    the shop is read-only. Waiting proofs are listed on the admin **Payments** page and on the shop's
    page; recording a payment for the shop marks them as recorded.
- **Product photos:** Inventory → add or edit a product → **Add photo** (JPG, PNG or WebP, up to 5 MB).
  The photo shows in the product list and on the POS tiles.
- **Files** (photos, proofs) are stored in MinIO and only served to signed-in people of the same shop
  (proofs: the owner) and to the platform admin, through `/api/files/...`.
- **Staff:** the owner invites people from **Staff** with their email and a role. The invitation link
  (valid 7 days) lets them choose a name and password.
  - **Manager:** everything except Staff, Billing and changing the shop profile.
  - **Cashier:** POS, dashboard and customers (khata) only.
- **Forgot password:** the sign-in page emails a reset link (valid 1 hour, works once). Resetting signs
  out every other device.
- **Disabling** someone on the Staff page signs them out everywhere at once.
- Sessions last up to 30 days and end after 7 days without use. Failed sign-ins are rate limited.

All of this depends on email. Without a mail provider, emails go to the Mailpit inbox listed above.
Open it on this PC to click confirmation, reset and invitation links.

## First start

1. Copy the settings file and fill in every value:
   ```
   copy .env.production.example .env.production
   ```
   - Database passwords: long random values. They are fixed when the database is first created, so
     changing them later in the file locks the app out; keep this file safe.
   - Address: `SHOPOS_DOMAIN`, `SHOPOS_PUBLIC_URL`, ports. Email links use `SHOPOS_PUBLIC_URL`, so it must
     be the address people actually open, including the port if it isn't 443.
   - Email: keep the Mailpit defaults until you have a provider (below).
   - File storage: `SHOPOS_S3_ACCESS_KEY` / `SHOPOS_S3_SECRET_KEY` become MinIO's admin login when its
     volume is first created; like the database passwords, keep them unchanged afterwards.
2. Start it:
   ```
   docker compose -p shopos-prod --env-file .env.production up -d --build --wait
   ```
3. Open the address, create the platform admin account, and confirm it from the email. Then share
   `<address>/signup` with shops, or sign up a test shop yourself with a second email address.

With `SHOPOS_TLS=internal`, browsers warn until they trust nginx's self-signed certificate. To trust it
on a device, copy it out and install it as a trusted root certificate:
```
docker compose -p shopos-prod cp nginx:/etc/nginx/shopos/state/self-signed.pem shopos-local.crt
```
Tills need a trusted certificate for the offline features to work.

## Switching to real email

Get SMTP details from a provider (Google Workspace, Brevo, SendGrid, Amazon SES, …), then in the env file:
remove the `COMPOSE_PROFILES=mailpit` line and set `SHOPOS_SMTP_HOST`, `SHOPOS_SMTP_PORT`,
`SHOPOS_SMTP_SECURE` (`true` only for port 465), `SHOPOS_SMTP_USER`, `SHOPOS_SMTP_PASSWORD` and a
`SHOPOS_MAIL_FROM` address on a domain the provider has verified. Apply with the `up` command above.

## Going public with a domain

Point the domain's DNS at the server, open ports 80 and 443, then set `SHOPOS_DOMAIN=<domain>`,
`SHOPOS_PUBLIC_URL=https://<domain>`, `SHOPOS_TLS=<your email>`, add `letsencrypt` to `COMPOSE_PROFILES`
and, once the certificate works, `SHOPOS_HSTS='max-age=31536000'`. The certbot service gets and renews
the certificate; nginx picks it up by itself. Details, Cloudflare and subdomains: [docs/nginx.md](docs/nginx.md).

## Updating

```
git pull
docker compose -p shopos-prod --env-file .env.production up -d --build --wait
```
Database migrations run automatically when the app starts. Take a backup first (below), and update
preprod first: `docker compose -p shopos-preprod --env-file .env.preprod up -d --build --wait`.

## Backups and restore

Dumps land in `SHOPOS_BACKUP_DIR` as `shopos-YYYYMMDD-HHMMSS.sql.gz` (UTC), one when the stack starts and
then every `SHOPOS_BACKUP_INTERVAL_SECONDS`. Copy that folder off the machine regularly; a backup on the
same disk does not survive a disk failure.

Backup now:
```
docker compose -p shopos-prod --env-file .env.production restart backup
```

Restore (replaces current data). Stop the app first so nothing is written mid-restore:
```
docker compose -p shopos-prod --env-file .env.production stop app
gunzip -c backups/production/shopos-YYYYMMDD-HHMMSS.sql.gz | docker compose -p shopos-prod --env-file .env.production exec -T db sh -c 'exec mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"'
docker compose -p shopos-prod --env-file .env.production start app
```
On Windows PowerShell, unzip the file first (for example with 7-Zip), then pipe it in with
`Get-Content -Raw shopos-....sql | docker compose ... exec -T db ...`.

Stored files are archived next to each dump as `shopos-files-YYYYMMDD-HHMMSS.tar.gz` (MinIO's data
folder). Restore them from the same moment as the database dump, with MinIO stopped:
```
docker compose -p shopos-prod --env-file .env.production stop app minio
docker run --rm -v shopos-prod_minio-data:/data -v "${PWD}/backups/production:/backups:ro" alpine sh -c 'rm -rf /data/* /data/.minio.sys && tar -xzf /backups/shopos-files-YYYYMMDD-HHMMSS.tar.gz -C /data'
docker compose -p shopos-prod --env-file .env.production start minio app
```

Locked out (owner lost their password and email is not working)? Restore is not needed: set up email,
then use **Forgot password**.

## Checks

- Health (no sign-in needed): `<address>/api/health` returns `{"ok":true,"storage":"mariadb","files":"ok"}`.
  `files` is `error` while MinIO is unreachable; sales keep working, only photos and proofs fail.
- Status: `docker compose -p shopos-prod ps` — every service `healthy` or `running`.
- Logs: `docker compose -p shopos-prod logs -f app` (rotated at 10 MB × 5 files per service).
- Full end-to-end suite against a disposable copy of this stack: `.\scripts\e2e.ps1 -Target preprod`.

## Day-end reports (email and WhatsApp)

Every shop has a **Day end** page: sales, profit, expenses, khata and the cash expected in the drawer,
with a **Share on WhatsApp** button (opens WhatsApp with the report typed in, works with no setup) and
**Send now**. Under **Settings → Daily target and day-end report** the owner can have it sent
automatically every day at a set time:

- **Email** works as soon as email works (the owner's address, or a report address).
- **WhatsApp** needs a WhatsApp Business account on Meta's Cloud API, connected once for the whole
  install. Until then WhatsApp deliveries are logged as "skipped" and the share button still works.

To connect WhatsApp:

1. In Meta Business Manager create a WhatsApp Business account and add a phone number
   (WhatsApp Manager → API setup). Create a system user with a permanent token that has the
   `whatsapp_business_messaging` permission.
2. Create a message template named `daily_report`, category **Utility**, language **English**, with this
   body (8 variables, in this order):
   ```
   {{1}} day-end report for {{2}}
   Sales: {{3}} ({{4}} sales)
   Gross profit: {{5}}
   Expenses: {{6}}
   Net profit: {{7}}
   Cash expected in drawer: {{8}}
   ```
   Wait for Meta to approve it.
3. Set these in the env file and restart the app:
   ```
   SHOPOS_WHATSAPP_TOKEN=<permanent token>
   SHOPOS_WHATSAPP_PHONE_ID=<phone number ID>
   SHOPOS_WHATSAPP_TEMPLATE=daily_report
   SHOPOS_WHATSAPP_LANG=en
   ```

Meta charges per template message (a few rupees each in Pakistan); check current pricing in WhatsApp
Manager. The app checks every minute for reports that are due and sends each shop's report once a day.
With more than one app instance, set `SHOPOS_DAY_END_SCHEDULER=off` on all but one (it is also safe to
leave on: each report is claimed by one instance).

## Not covered yet

- Payments are recorded by hand in the admin panel; there is no online card or wallet checkout.
- No emails are sent about trials ending; owners see a banner in the app for the last 3 days.
- Off-machine backup copies, monitoring and alerting are up to the host.
