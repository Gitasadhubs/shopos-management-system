# The HTTPS front of ShopOS: the official nginx image (latest stable line) plus openssl, for the
# self-signed and placeholder certificates, and the ShopOS configuration. See docs/nginx.md.
ARG NGINX_VERSION=1.30-alpine
FROM nginx:${NGINX_VERSION}

RUN apk add --no-cache openssl \
  && rm -f /etc/nginx/conf.d/default.conf \
  && mkdir -p /var/www/acme /etc/nginx/shopos/state

# Rendered at start by the image's envsubst step: only ${SHOPOS_*} variables are filled in.
COPY templates/ /etc/nginx/templates/
# Runs before nginx starts: real-IP ranges and which certificate to use.
COPY 40-shopos-tls.sh /docker-entrypoint.d/40-shopos-tls.sh
RUN chmod 0755 /docker-entrypoint.d/40-shopos-tls.sh

ENV NGINX_ENVSUBST_FILTER=^SHOPOS_
