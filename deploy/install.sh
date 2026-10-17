#!/usr/bin/env bash
# ShopOS production installer: from a fresh Ubuntu or Debian server to a running, secured ShopOS.
#
#   curl -fsSL https://raw.githubusercontent.com/Gitasadhubs/shopos-management-system/prod/deploy/install.sh -o install.sh
#   sudo bash install.sh
#
# What it does, in order: checks the server, installs updates and Docker, sets up the firewall,
# fail2ban, automatic security updates and swap, clones ShopOS, asks for anything it needs (domain,
# certificate, email, payment details), writes .env.production with generated passwords, builds and
# starts the stack, checks it is healthy, creates the platform admin and installs the `shopos`
# command for updates, backups and restores. See docs/deployment.md.
#
# Safe to run again: existing settings, passwords and data are kept; only missing values are asked.
# Every question can be answered in advance with an environment variable of the same name
# (SHOPOS_DOMAIN, SHOPOS_SMTP_HOST, ...); with --yes, unanswered questions take their default.
set -Eeuo pipefail

REPO_URL=${SHOPOS_REPO_URL:-https://github.com/Gitasadhubs/shopos-management-system.git}
BRANCH=${SHOPOS_BRANCH:-prod}
DIR=${SHOPOS_DIR:-/opt/shopos}
PROJECT=shopos-prod
ENV_NAME=.env.production
ASSUME_YES=0
SKIP_FIREWALL=0

usage() {
  cat <<EOF
Usage: sudo bash install.sh [options]
  --dir DIR         Where ShopOS lives (default $DIR)
  --branch NAME     Git branch to deploy (default $BRANCH)
  --repo URL        Git repository (default $REPO_URL)
  --yes             Do not ask: use defaults and SHOPOS_* environment variables
  --skip-firewall   Leave the firewall as it is (e.g. the provider's firewall is used instead)
EOF
}

while (($#)); do
  case $1 in
    --dir) DIR=$2; shift 2 ;;
    --branch) BRANCH=$2; shift 2 ;;
    --repo) REPO_URL=$2; shift 2 ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --skip-firewall) SKIP_FIREWALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

ENV_PATH="$DIR/$ENV_NAME"
STEP=0
STEPS=12
CURRENT='starting'

# --- output and questions ---------------------------------------------------------------------

if [[ -t 1 ]]; then B=$'\033[1m'; G=$'\033[1;32m'; Y=$'\033[1;33m'; R=$'\033[1;31m'; C=$'\033[1;36m'; N=$'\033[0m'; else B=; G=; Y=; R=; C=; N=; fi
step() { STEP=$((STEP + 1)); CURRENT=$*; printf '\n%s[%d/%d] %s%s\n' "$C" "$STEP" "$STEPS" "$*" "$N"; }
say() { printf '%s==>%s %s\n' "$G" "$N" "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '%s!!  %s%s\n' "$Y" "$*" "$N" >&2; }
die() { printf '%sxx  %s%s\n' "$R" "$*" "$N" >&2; exit 1; }
trap 'printf "%sxx  Stopped during: %s (line %d). Fix the problem above and run the installer again; it continues where it can.%s\n" "$R" "$CURRENT" "$LINENO" "$N" >&2' ERR

# Questions read from the terminal even when the script itself arrives on stdin.
TTY=/dev/tty
can_ask() { ((ASSUME_YES == 0)) && [[ -r $TTY ]]; }

# ask VAR "Question" [default]: keeps a value already set (environment or earlier answer).
ask() {
  local var=$1 question=$2 default=${3-} answer=''
  [[ -n ${!var-} ]] && return 0
  if can_ask; then
    read -r -p "    $question${default:+ [$default]}: " answer < "$TTY" || true
  fi
  printf -v "$var" '%s' "${answer:-$default}"
}

# ask_secret VAR "Question": typed without echo; empty keeps an existing value.
ask_secret() {
  local var=$1 question=$2 answer=''
  [[ -n ${!var-} ]] && return 0
  if can_ask; then
    read -r -s -p "    $question: " answer < "$TTY" || true
    printf '\n'
  fi
  printf -v "$var" '%s' "$answer"
}

# confirm "Question" y|n: true for yes.
confirm() {
  local question=$1 default=${2:-y} answer=''
  if ! can_ask; then [[ $default == y ]]; return; fi
  read -r -p "    $question [$([[ $default == y ]] && echo Y/n || echo y/N)]: " answer < "$TTY" || true
  answer=${answer:-$default}
  [[ ${answer,,} == y || ${answer,,} == yes ]]
}

# choose VAR "Question" option... : numbered menu, the first option is the default.
choose() {
  local var=$1 question=$2; shift 2
  local options=("$@") answer='' index
  [[ -n ${!var-} ]] && return 0
  if can_ask; then
    info "$question"
    for index in "${!options[@]}"; do info "  $((index + 1))) ${options[index]}"; done
    read -r -p "    Choose 1-${#options[@]} [1]: " answer < "$TTY" || true
  fi
  [[ $answer =~ ^[0-9]+$ ]] && ((answer >= 1 && answer <= ${#options[@]})) || answer=1
  printf -v "$var" '%s' "$answer"
}

# --- .env.production ---------------------------------------------------------------------------

env_get() {
  [[ -f $ENV_PATH ]] || return 0
  KEY=$1 awk -v q="'" 'index($0, ENVIRON["KEY"] "=") == 1 {
    v = substr($0, length(ENVIRON["KEY"]) + 2)
    if ((substr(v, 1, 1) == q && substr(v, length(v), 1) == q) || (substr(v, 1, 1) == "\"" && substr(v, length(v), 1) == "\"")) v = substr(v, 2, length(v) - 2)
    print v; exit
  }' "$ENV_PATH"
}

# Writes KEY=value, quoting it when needed; replaces the existing line or appends one.
env_set() {
  local key=$1 value=$2 line
  [[ $value == *"'"* || $value == *$'\n'* ]] && die "The value for $key cannot contain a single quote or a line break."
  if [[ $value =~ ^[A-Za-z0-9._/@:+,=-]*$ ]]; then line="$key=$value"; else line="$key='$value'"; fi
  touch "$ENV_PATH"
  KEY=$key LINE=$line awk 'BEGIN { done = 0 } index($0, ENVIRON["KEY"] "=") == 1 { if (!done) print ENVIRON["LINE"]; done = 1; next } { print } END { if (!done) print ENVIRON["LINE"] }' "$ENV_PATH" > "$ENV_PATH.tmp"
  mv "$ENV_PATH.tmp" "$ENV_PATH"
  chmod 600 "$ENV_PATH"
}

# A value that must be set; placeholders from the example file count as unset.
env_missing() { local value; value=$(env_get "$1"); [[ -z $value || $value == change-me* ]]; }

secret() { openssl rand -hex "${1:-24}"; }

# --- networking helpers ------------------------------------------------------------------------

public_ip() {
  local ip
  for url in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip=$(curl -4 -fsS --max-time 6 "$url" 2>/dev/null | tr -d '[:space:]') && [[ $ip =~ ^[0-9.]+$ ]] && { echo "$ip"; return; }
  done
  hostname -I 2>/dev/null | awk '{print $1}' || true
}

resolve() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1; exit}' || true; }

ip_to_int() { local IFS=.; read -r a b c d <<< "$1"; echo $(((a << 24) + (b << 16) + (c << 8) + d)); }

# in_cidrs IP "cidr cidr ...": whether an IPv4 address is inside any of the ranges.
in_cidrs() {
  local ip; ip=$(ip_to_int "$1")
  for cidr in $2; do
    [[ $cidr == *:* ]] && continue
    local base=${cidr%/*} bits=${cidr#*/} mask
    mask=$(((0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF))
    (((ip & mask) == ($(ip_to_int "$base") & mask))) && return 0
  done
  return 1
}

cloudflare_ranges() {
  local v4 v6
  v4=$(curl -fsS --max-time 10 https://www.cloudflare.com/ips-v4 2>/dev/null) || return 1
  v6=$(curl -fsS --max-time 10 https://www.cloudflare.com/ips-v6 2>/dev/null) || v6=''
  echo $v4 $v6
}

compose() { (cd "$DIR" && docker compose -p "$PROJECT" --env-file "$ENV_PATH" "$@"); }

# Runs JavaScript inside the app container (the stack's own network, no TLS or DNS needed).
app_node() { compose exec -T "$@"; }

app_health() {
  compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(async (r) => { console.log(await r.text()); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(e.message); process.exit(1) })"
}

# =================================================================================================

main() {
  [[ $EUID -eq 0 ]] || { command -v sudo >/dev/null && exec sudo -E bash "$0" "$@"; die 'Run this as root (sudo bash install.sh).'; }
  mkdir -p /var/log/shopos
  LOG=/var/log/shopos/install-$(date +%Y%m%d-%H%M%S).log
  exec > >(tee -a "$LOG") 2>&1
  printf '%sShopOS installer%s · log: %s\n' "$B" "$N" "$LOG"

  preflight
  system_setup
  install_docker
  harden
  get_code
  configure
  certificates
  security_audit
  start_stack
  verify
  create_admin
  finish
}

# 1 -------------------------------------------------------------------------------------------------
preflight() {
  step 'Checking the server'
  [[ -r /etc/os-release ]] || die 'Cannot tell which Linux this is (/etc/os-release missing).'
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID=$ID
  OS_CODENAME=${VERSION_CODENAME:-}
  case "$ID:${VERSION_ID:-}" in
    ubuntu:22.04|ubuntu:24.04|ubuntu:26.04|debian:12|debian:13) say "$PRETTY_NAME" ;;
    ubuntu:*|debian:*) warn "$PRETTY_NAME is not tested; Ubuntu 24.04 LTS or Debian 12 are."; confirm 'Continue anyway?' n || exit 1 ;;
    *) die "$PRETTY_NAME is not supported. Use Ubuntu 24.04 LTS or Debian 12." ;;
  esac
  case $(uname -m) in x86_64|aarch64) ;; *) die "CPU architecture $(uname -m) is not supported." ;; esac

  local cpus mem_mb disk_gb
  cpus=$(nproc)
  mem_mb=$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)
  disk_gb=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
  MEM_MB=$mem_mb
  DISK_GB=$disk_gb
  info "CPU cores: $cpus · memory: ${mem_mb} MB · free disk: ${disk_gb} GB"
  ((mem_mb >= 1800)) || die 'ShopOS needs at least 2 GB of memory.'
  ((disk_gb >= 8)) || die 'ShopOS needs at least 8 GB of free disk space.'
  ((disk_gb >= 15)) || warn 'Less than 15 GB free: keep an eye on disk space (shopos doctor).'

  curl -fsS --max-time 10 -o /dev/null https://github.com || die 'This server cannot reach github.com. Check its internet connection and DNS.'

  # A web server installed on the host (nginx, apache) would block ShopOS's own nginx container.
  local busy
  busy=$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v 'docker-proxy' || true)
  if [[ -n $busy ]]; then
    warn 'Ports 80/443 are already in use:'
    info "$busy"
    for service in nginx apache2 httpd lighttpd; do
      if systemctl is-active --quiet "$service" 2>/dev/null && confirm "Stop and disable $service so ShopOS can use ports 80 and 443?" y; then
        systemctl disable --now "$service"
      fi
    done
  fi
}

# 2 -------------------------------------------------------------------------------------------------
system_setup() {
  step 'Installing updates and base tools'
  # No questions from apt or needrestart: restart services automatically when libraries change.
  export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
  apt-get update -qq
  apt-get -y -qq -o Dpkg::Options::=--force-confold upgrade
  apt-get -y -qq install ca-certificates curl git gnupg openssl jq ufw fail2ban python3-systemd unattended-upgrades cron iproute2 >/dev/null
  # Security updates install themselves every day.
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

  # Builds and spikes are safer with some swap; only when there is none and disk allows.
  if ! swapon --show | grep -q . && ((DISK_GB >= 12)); then
    say 'Adding 2 GB of swap'
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl -q -w vm.swappiness=10
    echo 'vm.swappiness=10' > /etc/sysctl.d/60-shopos-swap.conf
  fi
}

# 3 -------------------------------------------------------------------------------------------------
install_docker() {
  step 'Installing Docker'
  if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/$OS_ID/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$OS_ID $OS_CODENAME stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get -y -qq install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  fi
  # Container logs are capped, so they cannot fill the disk.
  if [[ ! -f /etc/docker/daemon.json ]]; then
    printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "3" },\n  "live-restore": true\n}\n' > /etc/docker/daemon.json
    systemctl restart docker
  fi
  systemctl enable --now docker >/dev/null
  say "$(docker --version) · $(docker compose version --short 2>/dev/null || docker compose version)"
}

# 4 -------------------------------------------------------------------------------------------------
harden() {
  step 'Securing the server (firewall, fail2ban, SSH)'
  # Every port sshd listens on stays open, so the firewall cannot lock out this session.
  local ssh_ports
  ssh_ports=$( { sshd -T 2>/dev/null | awk '$1 == "port" {print $2}'; ss -ltnpH 2>/dev/null | awk '/"sshd"/ {sub(/.*:/, "", $4); print $4}'; } | sort -un | tr '\n' ' ' || true)
  ssh_ports=${ssh_ports:-22}
  if ((SKIP_FIREWALL)); then
    warn 'Firewall left unchanged (--skip-firewall). Allow only SSH, 80/tcp, 443/tcp and 443/udp in your provider firewall.'
  else
    # Docker publishes only 80/443 publicly; the MinIO console and mail inbox listen on 127.0.0.1.
    ufw --force default deny incoming >/dev/null
    ufw --force default allow outgoing >/dev/null
    local port
    for port in $ssh_ports; do ufw allow "$port/tcp" comment 'SSH' >/dev/null; done
    ufw allow 80/tcp comment 'ShopOS HTTP' >/dev/null
    ufw allow 443/tcp comment 'ShopOS HTTPS' >/dev/null
    ufw allow 443/udp comment 'ShopOS HTTP/3' >/dev/null
    ufw --force enable >/dev/null
    say "Firewall on: SSH (${ssh_ports% }), 80, 443"
  fi
  # Debian 12 logs SSH to the journal only, so the jail reads the journal.
  printf '[sshd]\nenabled = true\nbackend = systemd\nmaxretry = 5\nbantime = 1h\n' > /etc/fail2ban/jail.d/shopos.local
  if systemctl enable fail2ban >/dev/null 2>&1 && systemctl restart fail2ban; then say 'fail2ban on (blocks repeated SSH login failures)'; else warn 'fail2ban did not start; see: journalctl -u fail2ban'; fi

  # Password logins over SSH are the usual way servers get broken into. Only offered when a key
  # is already set up, so nobody locks themselves out.
  local keys=0 home
  for home in /root /home/*; do
    if [[ -s $home/.ssh/authorized_keys ]]; then keys=1; fi
  done
  local hardening=/etc/ssh/sshd_config.d/60-shopos.conf
  if [[ -f $hardening ]]; then
    say 'SSH: password login already off'
  elif ((keys)) && confirm 'Turn off SSH password login (key login keeps working)? Only say yes if you log in with an SSH key.' n; then
    printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > "$hardening"
    if sshd -t; then systemctl reload ssh 2>/dev/null || systemctl reload sshd; say 'SSH: password login off'; else rm -f "$hardening"; warn 'SSH settings rejected; left unchanged.'; fi
  else
    warn 'SSH password login is still on. Add an SSH key and run the installer again to turn it off.'
  fi
}

# 5 -------------------------------------------------------------------------------------------------
get_code() {
  step "Getting ShopOS ($BRANCH) into $DIR"
  export GIT_TERMINAL_PROMPT=0
  local key=/root/.ssh/shopos_deploy_ed25519
  if [[ -d $DIR/.git ]]; then
    if [[ -n $(git -C "$DIR" status --porcelain --untracked-files=no) ]]; then
      warn "$DIR has local changes to tracked files; keeping them and not pulling."
    else
      git -C "$DIR" fetch --prune origin
      git -C "$DIR" checkout -q "$BRANCH"
      git -C "$DIR" pull -q --ff-only origin "$BRANCH"
    fi
  else
    if ! git ls-remote --heads "$REPO_URL" "$BRANCH" >/dev/null 2>&1; then
      # Private repository: a read-only deploy key on this server.
      warn 'The repository is private or unreachable over HTTPS. Using a read-only deploy key.'
      mkdir -p /root/.ssh && chmod 700 /root/.ssh
      [[ -f $key ]] || ssh-keygen -q -t ed25519 -N '' -C "shopos-deploy@$(hostname)" -f "$key"
      info 'Add this key on GitHub: repository → Settings → Deploy keys → Add deploy key (leave "Allow write access" off):'
      printf '\n%s\n\n' "$(cat "$key.pub")"
      if can_ask; then read -r -p '    Press Enter once the key is added... ' _ < "$TTY"; fi
      REPO_URL=$(sed -E 's#^https://github.com/([^/]+)/([^/]+)$#git@github.com:\1/\2.git#' <<< "${REPO_URL%.git}")
      export GIT_SSH_COMMAND="ssh -i $key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
      git ls-remote --heads "$REPO_URL" "$BRANCH" >/dev/null || die "Still cannot read $REPO_URL. Check the deploy key and the repository name."
    fi
    git clone -q --branch "$BRANCH" "$REPO_URL" "$DIR"
    if [[ -n ${GIT_SSH_COMMAND-} ]]; then git -C "$DIR" config core.sshCommand "$GIT_SSH_COMMAND"; fi
  fi
  [[ -f $DIR/docker-compose.yml && -f $DIR/$ENV_NAME.example ]] || die "$DIR does not look like ShopOS (docker-compose.yml missing)."
  say "At $(git -C "$DIR" log -1 --format='%h · %s')"
}

# 6 -------------------------------------------------------------------------------------------------
configure() {
  step 'Settings (.env.production)'
  local fresh=0
  if [[ ! -f $ENV_PATH ]]; then
    # Passwords are fixed when the database is created; without the old file they are gone.
    if docker volume inspect "${PROJECT}_db-data" >/dev/null 2>&1; then
      die "A ShopOS database already exists (volume ${PROJECT}_db-data) but $ENV_PATH is missing. Restore that file from your copy, or remove the volume to start empty: docker volume rm ${PROJECT}_db-data ${PROJECT}_minio-data"
    fi
    cp "$DIR/$ENV_NAME.example" "$ENV_PATH"
    chmod 600 "$ENV_PATH"
    fresh=1
  else
    say "Keeping the existing $ENV_PATH; asking only for what is missing."
  fi

  # Generated secrets: only when unset, never replaced.
  for key in SHOPOS_DB_PASSWORD SHOPOS_DB_ROOT_PASSWORD SHOPOS_S3_SECRET_KEY; do
    if env_missing "$key"; then env_set "$key" "$(secret 24)"; fi
  done
  if ((fresh)); then env_set SHOPOS_S3_ACCESS_KEY "shopos-$(secret 6)"; fi

  # --- address --------------------------------------------------------------------------------
  local ip current_domain
  ip=$(public_ip)
  current_domain=$(env_get SHOPOS_DOMAIN)
  if [[ $current_domain == localhost ]]; then current_domain=''; fi
  if [[ -z $current_domain ]]; then
    info "This server's public IP address: ${ip:-unknown}"
    info 'Enter the domain ShopOS will use (e.g. app.myshopos.com), pointed at that IP with an A record.'
    info "No domain yet? Leave it empty for a temporary address: ${ip//./-}.sslip.io"
    ask SHOPOS_DOMAIN 'Domain' ''
    SHOPOS_DOMAIN=${SHOPOS_DOMAIN,,}
    SHOPOS_DOMAIN=${SHOPOS_DOMAIN#http://}; SHOPOS_DOMAIN=${SHOPOS_DOMAIN#https://}; SHOPOS_DOMAIN=${SHOPOS_DOMAIN%%/*}
    if [[ -z $SHOPOS_DOMAIN && -n $ip ]]; then SHOPOS_DOMAIN="${ip//./-}.sslip.io"; fi
    [[ $SHOPOS_DOMAIN =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "\"$SHOPOS_DOMAIN\" is not a valid domain name."
    env_set SHOPOS_DOMAIN "$SHOPOS_DOMAIN"
    env_set SHOPOS_PUBLIC_URL "https://$SHOPOS_DOMAIN"
    env_set SHOPOS_HTTP_PORT 80
    env_set SHOPOS_HTTPS_PORT 443
  fi
  DOMAIN=$(env_get SHOPOS_DOMAIN)

  # Behind Cloudflare's proxy the domain resolves to Cloudflare, not to this server.
  local resolved ranges='' behind_cloudflare=0
  resolved=$(resolve "$DOMAIN")
  ranges=$(cloudflare_ranges || true)
  if [[ -n $resolved && -n $ranges ]] && in_cidrs "$resolved" "$ranges"; then
    behind_cloudflare=1
    say "$DOMAIN → $resolved (Cloudflare proxy)"
  elif [[ -n $resolved && $resolved == "$ip" ]]; then
    say "$DOMAIN → $resolved (this server)"
  else
    warn "$DOMAIN resolves to ${resolved:-nothing} but this server is ${ip:-unknown}."
    info 'Create or fix the DNS A record now (the certificate needs it). It can take a few minutes to update.'
    confirm 'Continue anyway?' y || exit 1
  fi
  BEHIND_CLOUDFLARE=$behind_cloudflare
  if ((behind_cloudflare)); then
    # nginx then takes the visitor's address from Cloudflare's header (rate limits per visitor).
    env_set SHOPOS_TRUSTED_PROXIES "$ranges"
  elif env_missing SHOPOS_TRUSTED_PROXIES; then
    env_set SHOPOS_TRUSTED_PROXIES 127.0.0.1/32
  fi

  # --- certificate ----------------------------------------------------------------------------
  local tls
  tls=$(env_get SHOPOS_TLS)
  if [[ -z $tls || $tls == internal ]]; then
    local mode=''
    if ((behind_cloudflare)); then
      choose mode 'HTTPS certificate:' \
        'Cloudflare origin certificate (recommended behind Cloudflare; set SSL/TLS mode to "Full (strict)")' \
        "Let's Encrypt (temporarily switch the DNS record to \"DNS only\" while it is issued)" \
        'Self-signed (testing only; browsers warn)'
    else
      choose mode 'HTTPS certificate:' "Let's Encrypt, free and automatic (recommended)" 'Self-signed (testing only; browsers warn)'
      if [[ $mode == 2 ]]; then mode=3; else mode=2; fi
    fi
    case $mode in
      1) env_set SHOPOS_TLS '/etc/nginx/certs/origin.pem /etc/nginx/certs/origin.key'; NEED_ORIGIN_CERT=1 ;;
      2)
        local le_email=''
        ask le_email "Email for Let's Encrypt (expiry notices)" "${SHOPOS_ADMIN_EMAIL-}"
        [[ $le_email == *@*.* ]] || die "Let's Encrypt needs a valid email address."
        env_set SHOPOS_TLS "$le_email" ;;
      *) env_set SHOPOS_TLS internal; warn 'Self-signed certificate: fine for testing, not for customers.' ;;
    esac
  fi
  if [[ $(env_get SHOPOS_TLS) == internal ]]; then env_set SHOPOS_HSTS max-age=0; else env_set SHOPOS_HSTS max-age=31536000; fi

  # --- email ----------------------------------------------------------------------------------
  if [[ $(env_get SHOPOS_SMTP_HOST) == mailpit || -z $(env_get SHOPOS_SMTP_HOST) ]]; then
    info 'Email is needed for sign-up confirmation, password resets and staff invitations.'
    local provider=''
    # Unattended (--yes) there is no one to type the SMTP login, so keep the test inbox; preset the
    # SHOPOS_SMTP_* lines in .env.production to use a real provider.
    if ! can_ask; then provider=5; fi
    choose provider 'Email provider:' 'Brevo (free 300/day): smtp-relay.brevo.com' 'Gmail or Google Workspace (app password): smtp.gmail.com' 'Zoho Mail: smtp.zoho.com' 'Another SMTP server' 'None yet: keep emails in a test inbox on this server (customers cannot confirm sign-ups)'
    local host='' port=587
    case $provider in
      1) host=smtp-relay.brevo.com ;;
      2) host=smtp.gmail.com ;;
      3) host=smtp.zoho.com ;;
      4) ask host 'SMTP host' ''; ask port 'SMTP port' 587 ;;
      *) host=mailpit ;;
    esac
    if [[ $host == mailpit ]]; then
      env_set SHOPOS_SMTP_HOST mailpit
      env_set SHOPOS_SMTP_PORT 1025
      env_set SHOPOS_SMTP_SECURE false
      warn 'Emails stay in the test inbox (ssh -L 8025:127.0.0.1:8025 this server, then open http://localhost:8025).'
    else
      local user='' password='' from=''
      ask user "SMTP username (login) for $host" ''
      ask_secret password 'SMTP password or key (not shown)'
      ask from 'Send emails from (e.g. ShopOS <hello@yourdomain.com>)' "ShopOS <no-reply@$DOMAIN>"
      env_set SHOPOS_SMTP_HOST "$host"
      env_set SHOPOS_SMTP_PORT "$port"
      env_set SHOPOS_SMTP_SECURE "$([[ $port == 465 ]] && echo true || echo false)"
      env_set SHOPOS_SMTP_USER "$user"
      if [[ -n $password ]]; then env_set SHOPOS_SMTP_PASSWORD "$password"; fi
      env_set SHOPOS_MAIL_FROM "$from"
      # A connection test (no login): catches a wrong host or a blocked port early.
      if timeout 8 bash -c "exec 3<>/dev/tcp/$host/$port" 2>/dev/null; then say "Reached $host:$port"; else warn "Could not reach $host:$port from this server (some providers block outgoing SMTP; ask them or use port 2525/465)."; fi
    fi
  fi

  # --- payments shown to shops on their Billing page ---------------------------------------------
  if [[ -z $(env_get SHOPOS_PAY_WHATSAPP)$(env_get SHOPOS_PAY_WALLET)$(env_get SHOPOS_PAY_ACCOUNT_NUMBER) ]]; then
    info 'Where shops send their subscription payments (shown on their Billing page). Leave empty to skip.'
    local bank='' title='' account='' iban='' wallet='' whatsapp=''
    ask whatsapp 'WhatsApp number for payment screenshots, with country code (e.g. 923001234567)' ''
    ask wallet 'JazzCash / EasyPaisa number' ''
    ask bank 'Bank name' ''
    if [[ -n $bank ]]; then ask title 'Account title' ''; ask account 'Account number' ''; ask iban 'IBAN' ''; fi
    env_set SHOPOS_PAY_WHATSAPP "${whatsapp//[^0-9]/}"
    env_set SHOPOS_PAY_WALLET "$wallet"
    env_set SHOPOS_PAY_BANK_NAME "$bank"
    env_set SHOPOS_PAY_ACCOUNT_TITLE "$title"
    env_set SHOPOS_PAY_ACCOUNT_NUMBER "$account"
    env_set SHOPOS_PAY_IBAN "$iban"
  fi

  # --- optional services: the test inbox, and certbot for Let's Encrypt -------------------------
  local profiles=()
  if [[ $(env_get SHOPOS_SMTP_HOST) == mailpit ]]; then profiles+=(mailpit); fi
  if [[ $(env_get SHOPOS_TLS) == *@* ]]; then profiles+=(letsencrypt); fi
  env_set COMPOSE_PROFILES "$(IFS=,; echo "${profiles[*]}")"

  # --- sizing for this server ------------------------------------------------------------------
  if ((MEM_MB >= 7500)); then env_set SHOPOS_DB_BUFFER_POOL 1G; env_set SHOPOS_APP_MEMORY 1536m
  elif ((MEM_MB >= 3500)); then env_set SHOPOS_DB_BUFFER_POOL 512M; env_set SHOPOS_APP_MEMORY 1g
  else env_set SHOPOS_DB_BUFFER_POOL 256M; env_set SHOPOS_APP_MEMORY 768m; fi
  env_set SHOPOS_BACKUP_DIR ./backups/production
  if [[ -z $(env_get SHOPOS_TZ) ]]; then env_set SHOPOS_TZ Asia/Karachi; fi
  env_set SHOPOS_VERSION "$(git -C "$DIR" rev-parse --short HEAD)"
  mkdir -p "$DIR/backups/production" "$DIR/certs"

  # Compose must be able to read it, every required value set.
  compose config --quiet || die "$ENV_PATH has a problem (see above). Edit it and run the installer again."
  say "Settings saved to $ENV_PATH (readable by root only). Keep a copy somewhere safe: the passwords in it cannot be recovered."
}

# 7 -------------------------------------------------------------------------------------------------
certificates() {
  step 'Certificate files'
  if [[ ${NEED_ORIGIN_CERT-0} == 1 || $(env_get SHOPOS_TLS) == /etc/nginx/certs/* ]]; then
    if [[ -s $DIR/certs/origin.pem && -s $DIR/certs/origin.key ]]; then
      say 'Using the Cloudflare origin certificate in certs/'
    else
      info "Cloudflare → your domain → SSL/TLS → Origin Server → Create Certificate (RSA, keep the suggested hostnames yourdomain and *.yourdomain, 15 years)."
      info 'Paste the certificate (the whole block, ending with -----END CERTIFICATE-----):'
      read_pem "$DIR/certs/origin.pem" 'END CERTIFICATE'
      info 'Paste the private key (ending with -----END PRIVATE KEY-----):'
      read_pem "$DIR/certs/origin.key" 'END PRIVATE KEY'
      openssl x509 -in "$DIR/certs/origin.pem" -noout >/dev/null 2>&1 || die 'That is not a valid certificate. Run the installer again and paste it whole.'
      openssl pkey -in "$DIR/certs/origin.key" -noout >/dev/null 2>&1 || die 'That is not a valid private key. Run the installer again and paste it whole.'
      chmod 600 "$DIR/certs/origin.key"
      say 'Saved. In Cloudflare set SSL/TLS encryption mode to "Full (strict)".'
    fi
  else
    say "Not needed: $( [[ $(env_get SHOPOS_TLS) == internal ]] && echo 'self-signed' || echo "Let's Encrypt") certificate is created automatically (nginx makes self-signed ones; the certbot service gets Let's Encrypt's)."
  fi
}

read_pem() {
  local file=$1 end=$2 line
  can_ask || die "Put the certificate in $file first (non-interactive run)."
  : > "$file"
  while IFS= read -r line < "$TTY"; do
    printf '%s\n' "$line" >> "$file"
    if [[ $line == *"-----$end-----"* || $line == *"-----END RSA PRIVATE KEY-----"* || $line == *"-----END EC PRIVATE KEY-----"* ]]; then break; fi
  done
}

# 8 -------------------------------------------------------------------------------------------------
security_audit() {
  step 'Checking dependencies for known vulnerabilities'
  # Reads package-lock.json only; reports, does not stop the install.
  if docker run --rm -v "$DIR/package.json:/a/package.json:ro" -v "$DIR/package-lock.json:/a/package-lock.json:ro" -w /a node:22-bookworm-slim \
      npm audit --omit=dev --audit-level=high > /tmp/shopos-audit.txt 2>&1; then
    say 'No high or critical vulnerabilities in production dependencies.'
  else
    warn 'npm audit reports issues in production dependencies:'
    tail -n 25 /tmp/shopos-audit.txt | sed 's/^/    /'
    warn 'ShopOS still installs; update the dependencies on the dev branch and redeploy (shopos update).'
  fi
}

# 9 -------------------------------------------------------------------------------------------------
start_stack() {
  step 'Building and starting ShopOS (a few minutes the first time)'
  compose build --pull
  compose up -d --remove-orphans --wait --wait-timeout 600
  # The build cache and old images take most of a small disk.
  docker image prune -f >/dev/null
  docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
  compose ps
}

# 10 ------------------------------------------------------------------------------------------------
verify() {
  step 'Checking that it works'
  local tries=0
  until app_health >/tmp/shopos-health.txt 2>&1; do
    tries=$((tries + 1)); ((tries < 30)) || { cat /tmp/shopos-health.txt; die 'The app did not become healthy. See: shopos logs app'; }
    sleep 5
  done
  say "App: $(cat /tmp/shopos-health.txt)"
  grep -q '"files":"ok"' /tmp/shopos-health.txt || warn 'File storage is not answering yet (photos and payment proofs). See: shopos logs minio'

  # Over the internet, through DNS, the certificate and the firewall.
  local url="https://$DOMAIN/api/health" ok=0 flags=(-fsS --max-time 10)
  if [[ $(env_get SHOPOS_TLS) == internal ]]; then flags+=(-k); fi
  for _ in $(seq 1 24); do
    if curl "${flags[@]}" "$url" >/dev/null 2>&1; then ok=1; break; fi
    sleep 5
  done
  if ((ok)); then say "Reachable at https://$DOMAIN"
  else
    warn "https://$DOMAIN is not reachable from here yet."
    info 'Usually DNS still updating, or the certificate waiting for DNS. certbot retries every 30 minutes; check later with: shopos doctor'
    compose logs --tail 20 nginx certbot 2>/dev/null | sed 's/^/    /' || true
  fi
}

# 11 ------------------------------------------------------------------------------------------------
create_admin() {
  step 'Platform admin account'
  local status
  status=$(compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/auth/setup').then((r) => r.json()).then((b) => console.log(b.data && b.data.needs_setup ? 'needed' : 'done'))" 2>/dev/null || echo unknown)
  if [[ $status != needed ]]; then
    say 'An admin account already exists.'
    return
  fi
  # Until this exists, whoever opens the site first could create it; so the installer does it now.
  info 'The platform admin runs ShopOS: shops, subscriptions and payments, at /admin.'
  local email='' name='' password='' again=''
  while :; do
    ask email 'Admin email' "${SHOPOS_ADMIN_EMAIL-}"
    if [[ $email =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then break; fi
    can_ask || die 'Set SHOPOS_ADMIN_EMAIL to a valid email address.'
    warn 'That is not an email address.'; email=''
  done
  ask name 'Admin full name' "${SHOPOS_ADMIN_NAME-ShopOS Admin}"
  while :; do
    password=${SHOPOS_ADMIN_PASSWORD-}
    if [[ -z $password ]]; then
      ask_secret password 'Admin password (10+ characters, not shown)'
      ask_secret again 'Same password again'
      if [[ $password != "$again" ]]; then warn 'They do not match.'; password=''; again=''; continue; fi
    fi
    if ((${#password} >= 10)); then break; fi
    can_ask || die 'SHOPOS_ADMIN_PASSWORD must be at least 10 characters.'
    warn 'Use at least 10 characters.'; password=''; again=''
  done
  local result
  result=$(compose exec -T -e SETUP_EMAIL="$email" -e SETUP_NAME="$name" -e SETUP_PASSWORD="$password" app node -e "
    fetch('http://127.0.0.1:3000/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: process.env.SETUP_EMAIL, full_name: process.env.SETUP_NAME, password: process.env.SETUP_PASSWORD }) })
      .then(async (r) => console.log(r.status, (await r.json()).error || 'created'))" 2>&1 || true)
  info "Setup: $result"
  # The person running the installer controls the server, so the admin email counts as confirmed
  # (sign-in works even before email is set up).
  local sql="UPDATE users SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP(3)) WHERE role = 'admin'"
  if compose exec -T -e SQL="$sql" db sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" -e "$SQL"'; then
    say "Admin $email ready. Sign in at https://$DOMAIN/login"
  else
    warn 'Could not mark the admin email as confirmed; use the link in the confirmation email.'
  fi
}

# 12 ------------------------------------------------------------------------------------------------
finish() {
  step 'Finishing'
  printf 'SHOPOS_DIR=%q\nSHOPOS_PROJECT=%q\nSHOPOS_BRANCH=%q\n' "$DIR" "$PROJECT" "$BRANCH" > /etc/shopos.conf
  # A wrapper, so `shopos` always runs the copy that `shopos update` just pulled.
  printf '#!/bin/sh\nexec bash %q "$@"\n' "$DIR/deploy/shopos.sh" > /usr/local/bin/shopos
  chmod 0755 /usr/local/bin/shopos
  # A daily check that writes problems to the system log (journalctl -t shopos).
  printf '%s\n' '17 7 * * * root /usr/local/bin/shopos doctor --quiet 2>&1 | logger -t shopos' > /etc/cron.d/shopos-doctor

  cat <<EOF

${G}ShopOS is installed.${N}

  Address        https://$DOMAIN
  Admin panel    https://$DOMAIN/admin
  Shop sign-up   https://$DOMAIN/signup
  Settings       $ENV_PATH   (root only; back it up somewhere safe)
  Backups        $DIR/backups/production   (daily; copy them off this server)
  Install log    $LOG

  shopos status     health, containers, disk, newest backup
  shopos logs app   follow the app's logs (also: nginx, certbot, db, minio)
  shopos update     back up, pull the latest $BRANCH, rebuild, check, roll back on failure
  shopos backup     take a backup now
  shopos restore    restore a backup
  shopos doctor     check certificate, DNS, disk, backups and security settings

Next: sign in as the admin, sign up a test shop at /signup, and make a test sale.
EOF
  if ((BEHIND_CLOUDFLARE)); then info 'Cloudflare: SSL/TLS mode "Full (strict)"; keep the DNS record proxied (orange cloud).'; fi
  if [[ $(env_get SHOPOS_SMTP_HOST) == mailpit ]]; then warn 'Email is not set up: shops cannot confirm their sign-up. Run the installer again after getting SMTP details.'; fi
  return 0
}

[[ ${BASH_SOURCE[0]} == "$0" ]] && main "$@"
