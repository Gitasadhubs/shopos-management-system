# nginx: HTTPS, domains and subdomains

nginx is the only part of ShopOS that the internet talks to. It:

- serves HTTPS with a Let's Encrypt certificate, a Cloudflare origin certificate or a self-signed one;
- redirects plain HTTP to HTTPS;
- adds security headers and hides version numbers;
- passes each visitor's real IP address to the app (also behind Cloudflare), so sign-in limits hit
  the right person and a visitor cannot fake their address;
- refuses uploads over 6 MB and slows down floods of sign-in requests (30 a minute per address,
  bursts allowed) before they reach the app;
- compresses pages.

It runs the official `nginx` image (stable line, currently 1.30) with the ShopOS configuration on
top. A `certbot` container gets and renews Let's Encrypt certificates when you use them.

## Files

| File | What it is |
|---|---|
| `deploy/nginx/Dockerfile` | The image: official nginx plus `openssl` and the files below. The nginx version is the `NGINX_VERSION` line. |
| `deploy/nginx/templates/shopos.conf.template` | The ShopOS site: ports, HTTPS, headers, limits, proxy to the app. `${SHOPOS_…}` values are filled in from the settings file when the container starts. |
| `deploy/nginx/40-shopos-tls.sh` | Runs before nginx starts: picks the certificate, writes the trusted-proxy rules, and reloads nginx by itself whenever a Let's Encrypt certificate is issued or renewed. |
| `deploy/nginx/certbot.sh` | The `certbot` container's loop: get missing certificates, renew twice a day. |
| `deploy/nginx/sites/` | Your extra sites (subdomains, landing page). Only `*.conf.template` files load; git ignores them. |
| `docker-compose.yml` | The `nginx` and `certbot` services. |

## Settings

All in `.env.production` (`shopos env` on the server opens it and applies the change).

| Setting | Meaning |
|---|---|
| `SHOPOS_DOMAIN` | The app's hostname, e.g. `app.myshopos.com` (or `1-2-3-4.sslip.io` until you own a domain). |
| `SHOPOS_PUBLIC_URL` | The address people type, `https://` + domain (+ `:port` if not 443). Used for redirects and email links. |
| `SHOPOS_TLS` | The certificate: `internal`, an email address, or two file paths. See below. |
| `COMPOSE_PROFILES` | Must include `letsencrypt` when `SHOPOS_TLS` is an email address, so the `certbot` container runs. Comma-separated, e.g. `mailpit,letsencrypt`. |
| `SHOPOS_HSTS` | `max-age=31536000` once a trusted certificate works (browsers then refuse plain HTTP for a year); `max-age=0` while testing. |
| `SHOPOS_TRUSTED_PROXIES` | Address ranges allowed to tell nginx the visitor's IP. The installer puts Cloudflare's ranges here when your domain is proxied by Cloudflare; otherwise `127.0.0.1/32` (trust nobody). |
| `SHOPOS_REAL_IP_HEADER` | Header the trusted proxy puts the visitor's IP in. Default `CF-Connecting-IP` (Cloudflare). |
| `SHOPOS_EXTRA_DOMAINS` | More names for Let's Encrypt certificates, for sites in `deploy/nginx/sites`. Space-separated. |
| `SHOPOS_CERTS_DIR` | Host folder for certificate files you provide; inside nginx it is `/etc/nginx/certs`. Default `./certs`. |
| `SHOPOS_HTTP_PORT`, `SHOPOS_HTTPS_PORT` | 80 and 443 on a server. Preprod on this PC uses 8080 and 8443. |

## Choosing a certificate

| You have | Use | `SHOPOS_TLS` |
|---|---|---|
| A server with no domain yet | Let's Encrypt for the free `<ip>.sslip.io` name the installer offers | your email |
| A domain pointing straight at the server (DNS only, grey cloud in Cloudflare) | Let's Encrypt | your email |
| A domain proxied by Cloudflare (orange cloud) | Cloudflare origin certificate, SSL/TLS mode **Full (strict)** | `'/etc/nginx/certs/origin.pem /etc/nginx/certs/origin.key'` |
| This PC, a shop's local network, testing | Self-signed (browsers warn) | `internal` |

The installer asks which one and does every step. The sections below are for changing it later by
hand.

### Let's Encrypt

1. The domain's DNS A record points at the server, and ports 80 and 443 are open (the installer opens
   them in the firewall; also check your cloud provider's firewall).
2. In the settings: `SHOPOS_TLS=you@example.com`, add `letsencrypt` to `COMPOSE_PROFILES`.
3. Apply (`shopos env`, save and close). nginx serves a temporary self-signed certificate at first;
   `shopos logs certbot` shows `certificate for <domain> issued` within a minute or two, and nginx
   switches to it by itself within a minute.
4. Once `https://<domain>` shows a padlock: `SHOPOS_HSTS=max-age=31536000`, apply again.

Renewal is automatic. If issuing fails (usually DNS not pointing here yet, or port 80 blocked),
certbot tries again every 30 minutes; Let's Encrypt only allows a few failures an hour, so fix the
cause rather than restarting it repeatedly. To experiment without using up that allowance, set
`SHOPOS_LETSENCRYPT_STAGING=1` (browsers will not trust those certificates; remove it and delete the
`letsencrypt` volume to get real ones).

### Cloudflare origin certificate

Cloudflare's free plan hides the server's address, absorbs attacks and caches static files. With it:

1. Cloudflare → your domain → **DNS**: an A record for the app's name pointing at the server, **Proxied**
   (orange cloud).
2. **SSL/TLS → Overview**: encryption mode **Full (strict)**.
3. **SSL/TLS → Origin Server → Create Certificate**: RSA, hostnames `yourdomain.com` and
   `*.yourdomain.com`, 15 years. Save the certificate as `certs/origin.pem` and the private key as
   `certs/origin.key` in the ShopOS folder (`chmod 600 certs/origin.key`). The installer asks you to
   paste them instead.
4. Settings: `SHOPOS_TLS='/etc/nginx/certs/origin.pem /etc/nginx/certs/origin.key'`,
   `SHOPOS_TRUSTED_PROXIES` set to Cloudflare's ranges (all on one line, space-separated, from
   https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6), `SHOPOS_HSTS=max-age=31536000`.
5. Apply.

Because that certificate covers `*.yourdomain.com`, every subdomain you add later works with it.

### Self-signed

`SHOPOS_TLS=internal`. nginx creates a certificate for `SHOPOS_DOMAIN`, `localhost` and `127.0.0.1`,
valid for about two years, kept in a volume so it survives restarts. Browsers warn until the device
trusts it. To trust it on a till (needed for offline mode), copy it out and install it as a trusted
root certificate:

```
docker compose -p shopos-prod cp nginx:/etc/nginx/shopos/state/self-signed.pem shopos-local.crt
```

Windows: double-click the file → Install Certificate → Local Machine → "Trusted Root Certification
Authorities". Android: Settings → Security → Install a certificate → CA certificate.

## Getting your own domain later

You can launch on `<ip>.sslip.io` and move to your own domain whenever you buy one. Shops keep their
accounts and data; only the address changes.

1. Point the domain at the server: an A record for e.g. `app.myshopos.com` (Cloudflare recommended,
   see above).
2. Run the installer again: `sudo bash /opt/shopos/deploy/install.sh`. It keeps every password and
   setting, and asks only for what is new. To make it ask for the domain again, first clear the old
   one: `shopos env`, empty the `SHOPOS_DOMAIN=` line, save.
   By hand instead: set `SHOPOS_DOMAIN`, `SHOPOS_PUBLIC_URL` and the certificate settings above,
   then apply.
3. Tell shops the new address. Optionally keep the old name working as a redirect (an extra site,
   below, with `return 308 https://app.myshopos.com$request_uri;`).

## Adding a subdomain or another site

Use this for `www` and the bare domain (the landing page), a `demo.` site, or a redirect.

1. **DNS:** an A record for the new name (e.g. `www.myshopos.com`) pointing at the server (Proxied if
   you use Cloudflare).
2. **Certificate:**
   - Cloudflare origin certificate: nothing to do, it already covers `*.myshopos.com`. For the bare
     domain `myshopos.com` it covers that too.
   - Let's Encrypt: `shopos env`, add the name to `SHOPOS_EXTRA_DOMAINS` (e.g.
     `SHOPOS_EXTRA_DOMAINS='www.myshopos.com myshopos.com'`), save. Wait for
     `certificate for www.myshopos.com issued` in `shopos logs certbot`.
3. **Site file:** on the server,
   ```
   cd /opt/shopos/deploy/nginx/sites
   cp example.conf.template.sample www.conf.template
   nano www.conf.template
   ```
   Replace `www.example.com` with the new name (two places) and set where requests go: a container
   (next section), or a redirect. With Let's Encrypt, swap the `include` line for the two
   commented `/etc/letsencrypt/live/<name>/…` lines.
4. **Apply:** `shopos reload`. It renders the file, tests the whole configuration and reloads nginx
   without dropping a connection. If the file has a mistake, it prints the error and the running sites
   carry on with the old configuration; fix the file and run it again.

To remove a site: delete its file, `shopos reload`.

### Sending a site to another container

The ShopOS stack runs on its own Docker network. To put another stack behind the same nginx (for
example the growth landing page), connect nginx to that stack's network with a file next to
`docker-compose.yml` called `docker-compose.override.yml` (Docker Compose reads it automatically;
git ignores it):

```yaml
services:
  nginx:
    networks: [default, growth]
networks:
  growth:
    external: true
    name: shopos-growth_default   # docker network ls shows the name
```

Apply with `shopos env` (save without changes), then in the site file set the upstream to that
container's service name and port, e.g. `set $site_upstream http://agent:8090;`. Never publish the
growth dashboard (port 8091) this way: it has no login of its own.

## Day to day

| Task | Command |
|---|---|
| Apply changed site files | `shopos reload` |
| See requests, errors and certificate messages | `shopos logs nginx`, `shopos logs certbot` |
| Check certificate expiry, DNS, ports | `shopos doctor` |
| Newer nginx | change `NGINX_VERSION` in `deploy/nginx/Dockerfile`, commit, `shopos update` |

## Troubleshooting

| Problem | Fix |
|---|---|
| Browser warns about the certificate on a real domain | `shopos logs certbot`: not issued yet. Check the A record (`getent hosts <domain>` on the server should print the server's IP, or Cloudflare's when proxied), and that port 80 is open in the cloud provider's firewall. |
| Cloudflare error 526 | SSL/TLS mode is Full (strict) but nginx is not using the origin certificate: check `SHOPOS_TLS` and the files in `certs/`. |
| Cloudflare error 521/522 | nginx not reachable: `shopos status`; provider firewall allows 443; DNS points at the right server. |
| Too many redirects | Cloudflare SSL/TLS mode is "Flexible". Set it to Full (strict). |
| Every visitor shows the same IP in sign-in limits | Behind Cloudflare but `SHOPOS_TRUSTED_PROXIES` is not set to Cloudflare's ranges. |
| `413` when uploading | The file is over 6 MB (the app accepts up to 5 MB). |
| `429` on sign-in | More than 30 sign-in requests a minute from one address; it clears within a minute. |
| nginx container keeps restarting | `shopos logs nginx`. Usually `SHOPOS_TLS` names files that do not exist in `certs/`. |
| Extra site answers 502 | The container it points at is down, or nginx is not on its network (override file above). |
