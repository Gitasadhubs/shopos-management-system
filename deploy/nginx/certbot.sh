#!/bin/sh
# Runs in the certbot container (COMPOSE_PROFILES includes letsencrypt): gets a Let's Encrypt
# certificate for SHOPOS_DOMAIN and each of SHOPOS_EXTRA_DOMAINS through nginx's
# /.well-known/acme-challenge/, then renews them twice a day when due. nginx notices new files by
# itself (40-shopos-tls.sh). See docs/nginx.md.
set -eu
trap 'exit 0' TERM INT

domain=${SHOPOS_DOMAIN:?}
email=${SHOPOS_TLS:?}
staging=''
[ "${SHOPOS_LETSENCRYPT_STAGING:-}" = 1 ] && staging='--staging'

while :; do
  failed=0
  for name in $domain ${SHOPOS_EXTRA_DOMAINS:-}; do
    [ -s "/etc/letsencrypt/live/$name/fullchain.pem" ] && continue
    # shellcheck disable=SC2086
    if certbot certonly --webroot -w /var/www/acme -d "$name" --cert-name "$name" --email "$email" \
        --agree-tos --no-eff-email --non-interactive --keep-until-expiring $staging; then
      echo "certbot: certificate for $name issued"
    else
      echo "certbot: could not get a certificate for $name (DNS not pointing here yet, or port 80 closed)"
      failed=1
    fi
  done
  if [ $failed = 1 ]; then
    # Let's Encrypt allows only a few failures an hour, so wait before trying again.
    echo 'certbot: trying again in 30 minutes'
    sleep 1800 & wait $!
    continue
  fi
  certbot renew --webroot -w /var/www/acme --quiet --no-random-sleep-on-renew || echo 'certbot: renewal failed; trying again in 12 hours'
  sleep 43200 & wait $!
done
