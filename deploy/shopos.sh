#!/usr/bin/env bash
# The `shopos` command on a server set up by deploy/install.sh (/usr/local/bin/shopos runs this file).
#   shopos status | logs [service] | backup | update | restore [file] | doctor [--quiet] | env | reload | help
set -Eeuo pipefail

# shellcheck disable=SC1091
[[ -r /etc/shopos.conf ]] && . /etc/shopos.conf
DIR=${SHOPOS_DIR:-/opt/shopos}
PROJECT=${SHOPOS_PROJECT:-shopos-prod}
BRANCH=${SHOPOS_BRANCH:-prod}
ENV_PATH="$DIR/.env.production"

if [[ -t 1 ]]; then G=$'\033[1;32m'; Y=$'\033[1;33m'; R=$'\033[1;31m'; N=$'\033[0m'; else G=; Y=; R=; N=; fi
say() { printf '%s==>%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s!!  %s%s\n' "$Y" "$*" "$N" >&2; }
die() { printf '%sxx  %s%s\n' "$R" "$*" "$N" >&2; exit 1; }

[[ $EUID -eq 0 ]] || exec sudo bash "$0" "$@"
[[ -f $ENV_PATH ]] || die "$ENV_PATH not found. Run deploy/install.sh first."

compose() { (cd "$DIR" && docker compose -p "$PROJECT" --env-file "$ENV_PATH" "$@"); }

env_get() {
  KEY=$1 awk -v q="'" 'index($0, ENVIRON["KEY"] "=") == 1 {
    v = substr($0, length(ENVIRON["KEY"]) + 2)
    if ((substr(v, 1, 1) == q && substr(v, length(v), 1) == q) || (substr(v, 1, 1) == "\"" && substr(v, length(v), 1) == "\"")) v = substr(v, 2, length(v) - 2)
    print v; exit
  }' "$ENV_PATH"
}

env_set() {
  local key=$1 value=$2
  KEY=$key LINE="$key=$value" awk 'BEGIN { done = 0 } index($0, ENVIRON["KEY"] "=") == 1 { if (!done) print ENVIRON["LINE"]; done = 1; next } { print } END { if (!done) print ENVIRON["LINE"] }' "$ENV_PATH" > "$ENV_PATH.tmp"
  mv "$ENV_PATH.tmp" "$ENV_PATH"
  chmod 600 "$ENV_PATH"
}

backup_dir() {
  local dir; dir=$(env_get SHOPOS_BACKUP_DIR); dir=${dir:-./backups/production}
  [[ $dir == /* ]] && echo "$dir" || echo "$DIR/${dir#./}"
}

newest_backup() { find "$(backup_dir)" -maxdepth 1 -name 'shopos-[0-9]*.sql.gz' -printf '%T@ %p\n' 2>/dev/null | sort -rn | awk 'NR == 1 {print $2}'; }

health() {
  compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(async (r) => { console.log(await r.text()); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(e.message); process.exit(1) })"
}

wait_healthy() {
  local tries=0
  until health >/dev/null 2>&1; do
    tries=$((tries + 1)); ((tries < 36)) || return 1
    sleep 5
  done
}

cmd_status() {
  compose ps
  printf '\n'
  if health; then say 'App healthy'; else warn 'App is not healthy: shopos logs app'; fi
  local newest; newest=$(newest_backup)
  if [[ -n $newest ]]; then say "Newest backup: $(basename "$newest") ($(du -h "$newest" | cut -f1))"; else warn 'No backups yet'; fi
  say "Disk: $(df -h / | awk 'NR == 2 {print $4 " free of " $2}') · Version: $(git -C "$DIR" log -1 --format='%h %s')"
}

cmd_logs() { compose logs -f --tail 200 "${1:-app}"; }

# The backup container dumps the database (and archives stored files) whenever it starts.
cmd_backup() {
  local before after tries=0
  before=$(newest_backup)
  compose restart backup >/dev/null
  until after=$(newest_backup) && [[ -n $after && $after != "$before" ]]; do
    tries=$((tries + 1)); ((tries < 60)) || die 'No new backup appeared within 5 minutes: shopos logs backup'
    sleep 5
  done
  local size; size=$(du -h "$after" | cut -f1)
  # A dump of a few bytes is a failed dump, not a backup.
  [[ $(stat -c %s "$after") -gt 1000 ]] || die "The new backup $after is empty: shopos logs backup"
  say "Backup: $after ($size)"
}

cmd_update() {
  [[ -z $(git -C "$DIR" status --porcelain --untracked-files=no) ]] || die "$DIR has local changes; commit or discard them first (git -C $DIR status)."
  local previous current
  previous=$(git -C "$DIR" rev-parse HEAD)
  say 'Backing up first'
  cmd_backup
  git -C "$DIR" fetch -q --prune origin
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" pull -q --ff-only origin "$BRANCH"
  current=$(git -C "$DIR" rev-parse HEAD)
  if [[ $current == "$previous" ]]; then say "Already at the latest $BRANCH ($(git -C "$DIR" log -1 --format='%h %s'))."; [[ ${1-} == --force ]] || return 0; fi
  git -C "$DIR" log --oneline "$previous..$current" | sed 's/^/    /' || true
  env_set SHOPOS_VERSION "$(git -C "$DIR" rev-parse --short HEAD)"
  say 'Building and restarting'
  if compose build --pull && compose up -d --remove-orphans --wait --wait-timeout 600 && wait_healthy; then
    docker image prune -f >/dev/null
    docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
    say "Updated to $(git -C "$DIR" log -1 --format='%h %s')"
    return 0
  fi
  warn "The new version did not come up healthy. Rolling back to ${previous:0:7}."
  git -C "$DIR" checkout -q "$previous"
  env_set SHOPOS_VERSION "${previous:0:7}"
  compose build && compose up -d --remove-orphans --wait --wait-timeout 600 || true
  if wait_healthy; then
    warn "Back on ${previous:0:7}. The database may already have the new version's changes; if anything misbehaves, restore the backup taken above (shopos restore)."
    warn "The checkout is detached; when the problem is fixed run: git -C $DIR checkout $BRANCH && shopos update"
  else
    die 'The rollback is not healthy either. See shopos logs app; restore with shopos restore.'
  fi
  exit 1
}

cmd_restore() {
  local file=${1-}
  if [[ -z $file ]]; then
    say 'Backups (newest first):'
    find "$(backup_dir)" -maxdepth 1 -name 'shopos-[0-9]*.sql.gz' -printf '%T@ %f %s\n' | sort -rn | head -15 | awk '{printf "    %s  (%d KB)\n", $2, $3 / 1024}'
    read -r -p 'File to restore: ' file
  fi
  [[ $file == */* ]] || file="$(backup_dir)/$file"
  [[ -f $file ]] || die "$file not found."
  gzip -t "$file" || die "$file is damaged."
  warn "This replaces ALL current ShopOS data with the backup $(basename "$file")."
  local answer; read -r -p 'Type RESTORE to continue: ' answer
  [[ $answer == RESTORE ]] || die 'Cancelled.'
  say 'Backing up the current data first, just in case'
  cmd_backup || warn 'Could not back up the current data; continuing.'
  compose stop app
  gunzip -c "$file" | compose exec -T db sh -c 'exec mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"'
  # The stored files from the same moment, if that archive exists.
  local files; files=$(dirname "$file")/shopos-files-$(basename "$file" .sql.gz | sed 's/^shopos-//').tar.gz
  if [[ -f $files ]]; then
    say "Restoring stored files from $(basename "$files")"
    compose stop minio
    docker run --rm -v "${PROJECT}_minio-data:/data" -v "$files:/files.tar.gz:ro" alpine:3.20 sh -c 'rm -rf /data/* /data/.minio.sys && tar -xzf /files.tar.gz -C /data'
    compose start minio
  else
    warn 'No stored-files archive for that backup; photos and payment proofs are left as they are.'
  fi
  compose start app
  wait_healthy && say 'Restored and healthy.' || die 'The app is not healthy after the restore: shopos logs app'
}

cmd_doctor() {
  local quiet=0 problems=0; [[ ${1-} == --quiet ]] && quiet=1
  ok() { ((quiet)) || say "$*"; }
  bad() { warn "$*"; problems=$((problems + 1)); }
  local domain; domain=$(env_get SHOPOS_DOMAIN)

  if health >/dev/null 2>&1; then ok 'App healthy'; else bad 'App not healthy (shopos logs app)'; fi
  local unhealthy; unhealthy=$(compose ps --format '{{.Service}} {{.State}} {{.Health}}' | awk '$2 != "running" || ($3 != "" && $3 != "healthy") {print $1}' || true)
  [[ -z $unhealthy ]] && ok 'All containers running' || bad "Containers not running or unhealthy: $unhealthy"

  local free; free=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
  ((free >= 3)) && ok "Disk: ${free} GB free" || bad "Disk almost full: ${free} GB free (docker system prune, old backups)"

  local newest age; newest=$(newest_backup)
  if [[ -z $newest ]]; then bad 'No backups'
  else
    age=$((($(date +%s) - $(stat -c %Y "$newest")) / 3600))
    ((age <= 26)) && ok "Newest backup ${age}h old" || bad "Newest backup is ${age}h old (shopos logs backup)"
    [[ $(stat -c %s "$newest") -gt 1000 ]] || bad "Newest backup is empty: $newest"
  fi

  if [[ $(env_get SHOPOS_TLS) != internal ]]; then
    local end days
    end=$(echo | timeout 10 openssl s_client -servername "$domain" -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)
    if [[ -n $end ]]; then
      days=$((($(date -d "$end" +%s) - $(date +%s)) / 86400))
      ((days >= 14)) && ok "Certificate valid for $days more days" || bad "Certificate expires in $days days"
    else
      bad "No certificate served for $domain yet (shopos logs nginx; shopos logs certbot)"
    fi
  fi

  [[ $(env_get SHOPOS_SMTP_HOST) != mailpit ]] && ok 'Email provider set' || bad 'Email not set up: shops cannot confirm sign-ups'
  ufw status 2>/dev/null | grep -q 'Status: active' && ok 'Firewall on' || bad 'Firewall (ufw) is off'
  systemctl is-active --quiet fail2ban && ok 'fail2ban running' || bad 'fail2ban not running'
  [[ $(stat -c %a "$ENV_PATH") == 600 ]] && ok 'Settings file readable by root only' || bad "$ENV_PATH should be chmod 600"
  local pending; pending=$(apt-get -s upgrade 2>/dev/null | grep -c '^Inst' || true)
  ((pending == 0)) && ok 'System packages up to date' || ok "$pending package updates waiting (installed automatically for security fixes)"
  [[ -f /var/run/reboot-required ]] && bad 'A reboot is needed to finish system updates (sudo reboot; ShopOS starts again by itself)'

  ((problems == 0)) && ok 'No problems found.' || { warn "$problems problem(s) found."; return 1; }
}

cmd_env() {
  "${EDITOR:-nano}" "$ENV_PATH"
  chmod 600 "$ENV_PATH"
  say 'Applying the settings'
  compose up -d --remove-orphans --wait --wait-timeout 300
}

# Re-renders nginx's templates (deploy/nginx/sites included) and reloads only when the result is
# valid, so a mistake in a site file never takes the running sites down.
cmd_reload() {
  if compose exec -T nginx sh -c 'rm -rf /etc/nginx/conf.d/sites && /docker-entrypoint.d/20-envsubst-on-templates.sh >/dev/null && nginx -t && nginx -s reload'; then
    say 'nginx reloaded with the new configuration'
  else
    die 'The nginx configuration has an error (above). nginx keeps serving the previous one; fix the file and run shopos reload again.'
  fi
}

usage() {
  cat <<'EOF'
shopos status            containers, health, newest backup, disk, version
shopos logs [service]    follow logs: app (default), nginx, certbot, db, minio, backup
shopos backup            take a backup now (database and stored files)
shopos update [--force]  back up, pull the latest code, rebuild, check; roll back if unhealthy
shopos restore [file]    restore a backup (asks first, backs up the current data)
shopos doctor [--quiet]  check health, disk, backups, certificate, email, firewall
shopos env               edit the settings file, then apply it
shopos reload            apply changed nginx site files (deploy/nginx/sites) without downtime
EOF
}

case ${1-help} in
  status) cmd_status ;;
  logs) cmd_logs "${2-}" ;;
  backup) cmd_backup ;;
  update) cmd_update "${2-}" ;;
  restore) cmd_restore "${2-}" ;;
  doctor) cmd_doctor "${2-}" ;;
  env) cmd_env ;;
  reload) cmd_reload ;;
  help|-h|--help) usage ;;
  *) usage >&2; exit 2 ;;
esac
