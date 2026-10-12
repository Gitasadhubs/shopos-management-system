#!/bin/sh
# Runs in the "backup" service (mariadb image). Dumps the database on start and then every
# BACKUP_INTERVAL_SECONDS, keeping BACKUP_KEEP_DAYS of compressed dumps in /backups.
# Restore: gunzip -c shopos-<stamp>.sql.gz | docker compose exec -T db sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"'
set -eu

interval="${BACKUP_INTERVAL_SECONDS:-86400}"
keep_days="${BACKUP_KEEP_DAYS:-14}"
export MYSQL_PWD="$SHOPOS_DB_PASSWORD"

while true; do
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  target="/backups/shopos-$stamp.sql.gz"
  if mariadb-dump --host=db --user="$SHOPOS_DB_USER" --single-transaction --routines --triggers --hex-blob "$SHOPOS_DB_NAME" | gzip > "$target.partial"; then
    mv "$target.partial" "$target"
    echo "backup: wrote $target ($(du -h "$target" | cut -f1))"
  else
    rm -f "$target.partial"
    echo "backup: FAILED at $stamp" >&2
  fi
  find /backups -name 'shopos-*.sql.gz' -mtime +"$keep_days" -delete
  sleep "$interval"
done
