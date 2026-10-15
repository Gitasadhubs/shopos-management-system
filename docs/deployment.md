# Deploying ShopOS to a server

One script takes a fresh Ubuntu or Debian server to a running, secured ShopOS:
[`deploy/install.sh`](../deploy/install.sh). It asks for anything it needs while it runs, so you
only need the answers below at hand. Run it again at any time: it keeps your settings, passwords
and data, and only asks for what is missing.

## What you need

| | Required | Notes |
|---|---|---|
| Server | Yes | Ubuntu 24.04 LTS (or 22.04, Debian 12). 2 CPU / 4 GB RAM / 20 GB disk is enough for 100+ shops; 4 CPU / 12 GB / 25 GB is comfortable. SSH access as root or a sudo user. |
| Domain | Recommended | e.g. `app.myshopos.com`, with a DNS **A record** pointing at the server's IP. Without one the installer uses a temporary `<ip>.sslip.io` address. |
| Email (SMTP) | Yes, for real customers | Sign-up confirmation, password reset and staff invitations are emails. Brevo (free 300/day), Gmail/Workspace app password, Zoho, Amazon SES… |
| Payment details | Optional | Bank, JazzCash/EasyPaisa, WhatsApp number shown to shops on their Billing page. |
| Cloudflare | Optional | Proxying through Cloudflare is supported (origin certificate, real visitor IPs). |

## Install

On the server:

```bash
curl -fsSL https://raw.githubusercontent.com/Gitasadhubs/shopos-management-system/prod/deploy/install.sh -o install.sh
sudo bash install.sh
```

Download first and then run it (not `curl … | bash`): the script asks questions on the terminal.
Options: `--dir /opt/shopos` (where it lives), `--branch prod`, `--repo <url>`, `--yes` (no questions:
defaults and `SHOPOS_*` environment variables), `--skip-firewall` (use the provider's firewall).

### The 12 steps

1. **Check the server.** OS and version, CPU, memory, disk, internet access, and whether something
   (nginx, Apache) already uses ports 80/443 — it offers to stop it.
2. **Updates and base tools.** `apt upgrade`, git, curl, ufw, fail2ban, unattended-upgrades (security
   updates install themselves daily), and 2 GB of swap if there is none.
3. **Docker.** From Docker's official repository, with container log rotation.
4. **Secure the server.** Firewall: only SSH (every port sshd listens on), 80, 443 open. fail2ban for
   SSH. Optionally turns off SSH password login — only offered when an SSH key is already installed,
   so you cannot lock yourself out.
5. **Get the code.** Clones the `prod` branch into `/opt/shopos`. If the repository is private it
   creates a read-only **deploy key** and shows it; add it on GitHub (repository → Settings → Deploy
   keys) and press Enter.
6. **Settings.** Writes `/opt/shopos/.env.production` (readable by root only):
   - database and file-storage passwords: generated, never shown, never replaced on later runs;
   - domain (checks the DNS record points here, or at Cloudflare);
   - certificate: Let's Encrypt, a Cloudflare origin certificate, or self-signed for testing;
   - email provider and SMTP login (tests that the SMTP server is reachable);
   - payment details for the Billing page;
   - memory sizes for this server.
7. **Certificate files.** Only for a Cloudflare origin certificate: paste the certificate and key.
8. **Dependency audit.** `npm audit` of the production dependencies; reported, does not stop the install.
9. **Build and start.** Builds the app image and starts database, file storage, app, nginx (plus certbot for Let's Encrypt) and backups.
10. **Check it works.** The app's health check from inside, then `https://<domain>/api/health` over the internet.
11. **Platform admin.** Creates your admin account right away (until it exists, whoever opens the
    site first could create it) and marks its email as confirmed.
12. **Finish.** Installs the `shopos` command, a daily health check, and prints the addresses.

## Certificates

| Your setup | Choose | What to do |
|---|---|---|
| Domain's DNS points straight at the server | **Let's Encrypt** | Nothing: the certbot service gets and renews the certificate. Ports 80 and 443 must be reachable. |
| Domain proxied by Cloudflare (orange cloud) | **Cloudflare origin certificate** | Cloudflare → SSL/TLS → Origin Server → Create Certificate; paste it when asked. Set SSL/TLS mode to **Full (strict)**. |
| No domain yet | Let's Encrypt on `<ip>.sslip.io` | Temporary; switch to your domain later by editing `SHOPOS_DOMAIN`/`SHOPOS_PUBLIC_URL` (`shopos env`). |
| Testing only | Self-signed | Browsers warn; offline features need a trusted certificate. |

Changing domains later, subdomains, and every certificate detail: [nginx.md](nginx.md).

Behind Cloudflare the installer also stores Cloudflare's IP ranges in `SHOPOS_TRUSTED_PROXIES`, so
the app sees each visitor's real IP (sign-in and sign-up limits are per visitor). Requests that do
not come through Cloudflare cannot fake that address.

## Email deliverability

Whichever provider you use, verify your sending domain with it and add the DNS records it gives you:

- **SPF**: a TXT record such as `v=spf1 include:spf.brevo.com ~all` (one SPF record per domain).
- **DKIM**: the CNAME/TXT records from the provider.
- **DMARC**: TXT at `_dmarc.<domain>`: `v=DMARC1; p=none; rua=mailto:you@<domain>` (tighten to
  `p=quarantine` once everything passes).

Send from an address on that domain (`SHOPOS_MAIL_FROM='ShopOS <hello@myshopos.com>'`). Some
providers block outgoing port 587 on new servers; the installer warns when it cannot reach the
SMTP server. Ask the provider to open it, or use port 2525 / 465.

## Running it: the `shopos` command

| Command | What it does |
|---|---|
| `shopos status` | Containers, health, newest backup, free disk, deployed version. |
| `shopos logs [app\|nginx\|certbot\|db\|minio\|backup]` | Follows a service's logs. |
| `shopos reload` | Applies changed nginx site files (subdomains, landing page) without downtime. See [nginx.md](nginx.md). |
| `shopos backup` | Database dump + stored-files archive now; checks the dump is not empty. |
| `shopos update` | Backs up, pulls the latest `prod`, rebuilds, waits until healthy. **Rolls back** to the previous version automatically if the new one is not healthy. |
| `shopos restore [file]` | Restores a backup (asks you to type RESTORE; backs up the current data first). |
| `shopos doctor` | Health, containers, disk, backup age, certificate expiry, email, firewall, fail2ban, pending reboot. Runs daily from cron; problems go to `journalctl -t shopos`. |
| `shopos env` | Edit the settings, then apply them. |

## Backups

- The `backup` container dumps the database and archives the stored files (photos, payment proofs)
  when the stack starts and then every 24 hours, keeping 14 days, in `/opt/shopos/backups/production`.
- **Copy them off the server.** A backup on the same disk does not survive the disk. Simplest: from
  your PC, `scp -r root@<server>:/opt/shopos/backups/production ./shopos-backups` weekly, or an
  `rclone` job to Backblaze B2 / Cloudflare R2 (both have free tiers).
- Also keep a copy of `/opt/shopos/.env.production`: without it the backups' database passwords and
  the file-storage keys are lost.
- Test a restore once: `shopos restore` on a spare server.

## Updating

```bash
shopos update
```

Database migrations run when the new app starts; they only add. Update during quiet hours. If the
rollback runs, the database may already have the new version's changes: restore the backup taken at
the start of the update if anything misbehaves.

## Moving to a new server

1. On the old server: `shopos backup`; copy `/opt/shopos/.env.production` and the newest
   `shopos-*.sql.gz` + `shopos-files-*.tar.gz` to your PC.
2. On the new server: copy `.env.production` to `/opt/shopos/.env.production` (create the folder),
   run the installer (it keeps that file), then `shopos restore <file>`.
3. Point DNS at the new server.

## Troubleshooting

| Symptom | Check |
|---|---|
| Installer stopped | It prints the step and line; fix and run it again. Full log in `/var/log/shopos/`. |
| `https://<domain>` not reachable | `shopos doctor`; DNS A record; provider firewall allows 80/443; `shopos logs certbot` for certificate errors (Let's Encrypt needs the DNS record first). |
| "Too many attempts" for everyone behind Cloudflare | `SHOPOS_TRUSTED_PROXIES` missing: run the installer again. |
| Shops do not get emails | `shopos logs app` (look for `[mail] send failed`); SMTP login; SPF/DKIM; spam folder. |
| Disk full | `docker system prune`, delete old files in `backups/production` after copying them off. |
| Lost the admin password | Use Forgot password (needs email). Otherwise reset it in the database from the server. |

See also: [operations.md](operations.md) (runbook), [security.md](security.md).
