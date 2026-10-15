#!/bin/sh
# Runs inside the nginx container before nginx starts (the image runs /docker-entrypoint.d/*.sh).
# Writes /etc/nginx/shopos/realip.conf and ssl.conf from the environment:
#   SHOPOS_TLS=internal                     a self-signed certificate (testing, this PC)
#   SHOPOS_TLS=you@example.com              Let's Encrypt via the certbot service (a placeholder until issued)
#   SHOPOS_TLS='/etc/nginx/certs/a.pem /etc/nginx/certs/a.key'   certificate files you provide (Cloudflare origin)
#   SHOPOS_TRUSTED_PROXIES='1.2.3.0/24 …'  proxies allowed to tell nginx the visitor's address
set -eu

dir=/etc/nginx/shopos
state=$dir/state
mkdir -p "$dir" "$state"
domain=${SHOPOS_DOMAIN:-localhost}
tls=${SHOPOS_TLS:-internal}

# --- the visitor's real address ---------------------------------------------------------------
{
  for range in ${SHOPOS_TRUSTED_PROXIES:-127.0.0.1/32}; do echo "set_real_ip_from $range;"; done
  echo "real_ip_header ${SHOPOS_REAL_IP_HEADER:-CF-Connecting-IP};"
  echo 'real_ip_recursive on;'
} > "$dir/realip.conf"

# --- certificate --------------------------------------------------------------------------------
self_signed() {
  # Kept in a volume, so the certificate (and any device that trusts it) survives restarts.
  if [ ! -s "$state/self-signed.pem" ] || [ "$(cat "$state/self-signed.for" 2>/dev/null)" != "$domain" ]; then
    # Browsers accept an IP address only as an IP entry, never as a DNS name.
    case $domain in
      *[!0-9.]*) san="DNS:$domain" ;;
      *) san="IP:$domain" ;;
    esac
    openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=$domain" \
      -addext "subjectAltName=$san,DNS:localhost,IP:127.0.0.1" \
      -keyout "$state/self-signed.key" -out "$state/self-signed.pem" 2>/dev/null
    chmod 600 "$state/self-signed.key"
    echo "$domain" > "$state/self-signed.for"
    # stderr: stdout is the function's answer (the two file paths).
    echo "shopos: created a self-signed certificate for $domain" >&2
  fi
  echo "$state/self-signed.pem $state/self-signed.key"
}

write_ssl() { printf 'ssl_certificate %s;\nssl_certificate_key %s;\n' "$1" "$2" > "$dir/ssl.conf"; }

case $tls in
  internal)
    # shellcheck disable=SC2046
    write_ssl $(self_signed)
    ;;
  /*)
    # shellcheck disable=SC2086
    set -- $tls
    [ -s "${1:-}" ] && [ -s "${2:-}" ] || { echo "shopos: SHOPOS_TLS names certificate files that are missing: $tls" >&2; exit 1; }
    write_ssl "$1" "$2"
    ;;
  *@*)
    live=/etc/letsencrypt/live/$domain
    if [ -s "$live/fullchain.pem" ] && [ -s "$live/privkey.pem" ]; then
      write_ssl "$live/fullchain.pem" "$live/privkey.pem"
    else
      echo "shopos: no Let's Encrypt certificate for $domain yet; serving a temporary one until certbot gets it"
      # shellcheck disable=SC2046
      write_ssl $(self_signed)
    fi
    # Picks up the first certificate and every renewal, the extra domains' too (SHOPOS_EXTRA_DOMAINS):
    # switches ssl.conf to the real certificate and reloads nginx.
    (
      fingerprint() { cat /etc/letsencrypt/live/*/fullchain.pem 2>/dev/null | sha256sum | cut -d' ' -f1; }
      last=$(fingerprint)
      while sleep 60; do
        current=$(fingerprint)
        [ "$current" = "$last" ] && continue
        if [ -s "$live/fullchain.pem" ]; then write_ssl "$live/fullchain.pem" "$live/privkey.pem"; fi
        if nginx -t -q 2>/dev/null && nginx -s reload 2>/dev/null; then
          echo "shopos: Let's Encrypt certificates changed, nginx reloaded"
          last=$current
        fi
      done
    ) &
    ;;
  *)
    echo "shopos: SHOPOS_TLS must be 'internal', an email address (Let's Encrypt) or two certificate file paths; got: $tls" >&2
    exit 1
    ;;
esac
