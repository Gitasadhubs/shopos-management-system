#!/bin/sh
# Runs in the "backup" service (mariadb image). Dumps the database on start and then every
# BACKUP_INTERVAL_SECONDS, keeping BACKUP_KEEP_DAYS of compressed dumps in /backups. Stored files
# (MinIO's data folder, mounted read-only at /minio-data) are archived alongside each dump.
# Restore: gunzip -c shopos-<stamp>.sql.gz | docker compose exec -T db sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"'
# Files: see "Backups and restore" in DEPLOYMENT.md.
set -eu

interval="${BACKUP_INTERVAL_SECONDS:-86400}"
keep_days="${BACKUP_KEEP_DAYS:-14}"
# After a failed dump, try again this soon instead of waiting a whole interval.
retry=300
export MYSQL_PWD="$SHOPOS_DB_PASSWORD"

# depends_on only holds for "docker compose up": after a reboot Docker restarts this container and
# the database together, so wait until the database answers.
wait_for_db() {
  tries=0
  until mariadb-admin --host=db --user="$SHOPOS_DB_USER" ping >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -ge 60 ] && return 1
    sleep 5
  done
}

while true; do
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  target="/backups/shopos-$stamp.sql.gz"
  # Dump to a file first: in "dump | gzip" the shell only sees gzip's exit status, so a failed
  # dump would be stored as an empty backup.
  if wait_for_db && mariadb-dump --host=db --user="$SHOPOS_DB_USER" --single-transaction --routines --triggers --hex-blob "$SHOPOS_DB_NAME" > "/backups/.dump-$stamp.sql" \
    && gzip -c "/backups/.dump-$stamp.sql" > "$target.partial"; then
    rm -f "/backups/.dump-$stamp.sql"
    mv "$target.partial" "$target"
    echo "backup: wrote $target ($(du -h "$target" | cut -f1))"
    next="$interval"
  else
    rm -f "/backups/.dump-$stamp.sql" "$target.partial"
    echo "backup: FAILED at $stamp, retrying in ${retry}s" >&2
    next="$retry"
  fi
  if [ -d /minio-data ]; then
    files="/backups/shopos-files-$stamp.tar.gz"
    if tar -czf "$files.partial" -C /minio-data .; then
      mv "$files.partial" "$files"
      echo "backup: wrote $files ($(du -h "$files" | cut -f1))"
    else
      rm -f "$files.partial"
      echo "backup: files FAILED at $stamp" >&2
    fi
  fi
  find /backups \( -name 'shopos-*.sql.gz' -o -name 'shopos-files-*.tar.gz' \) -mtime +"$keep_days" -delete
  sleep "$next"
done
