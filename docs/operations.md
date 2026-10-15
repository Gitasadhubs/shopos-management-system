# Operations runbook

Day-to-day running of a ShopOS server set up with [deploy/install.sh](../deploy/install.sh).
Everything lives in `/opt/shopos`; settings in `/opt/shopos/.env.production`.

## Routine

| When | Do |
|---|---|
| Daily (2 min) | `/admin`: new shops, trials ending in 7 days, payment proofs waiting → record payments. |
| Daily (automatic) | Backups at start-up + every 24 h; `shopos doctor` at 07:17 (problems → `journalctl -t shopos`); security updates. |
| Twice a week | `shopos status`; copy `backups/production` off the server. |
| Monthly | `shopos doctor`; reboot if it says a reboot is needed (`sudo reboot`, ShopOS starts by itself); test-restore a backup on a spare machine every few months. |
| Each release | Tests pass on dev → push dev → preprod check → merge to prod → `shopos update`. |

## Monitoring

- **Uptime:** UptimeRobot (free) on `https://<domain>/api/health`, keyword `"ok":true`. The endpoint
  needs no sign-in and checks the database; `"files":"error"` means MinIO is down (sales still work).
- **Server:** `shopos status` (containers, disk, newest backup), `shopos doctor` (everything).
- **Logs:** `shopos logs app` (errors start with the failing action, e.g. `Unable to complete sale.`),
  `shopos logs nginx` (requests), `shopos logs certbot` (certificates), `shopos logs backup`.
- **Capacity:** the app idles at ~100 MB, the database at ~100 MB. Consider a bigger server when
  `docker stats` shows memory above 70% at busy hours or the disk is over 80%.

## Incidents

### The site is down
1. `shopos status` — which container is not running/healthy?
2. `shopos logs <service>` for its last errors.
3. Restart it: `cd /opt/shopos && docker compose -p shopos-prod --env-file .env.production restart <service>`.
4. Whole stack: `docker compose -p shopos-prod --env-file .env.production up -d --wait`.
5. After a server reboot everything starts by itself (restart policies); if not: `systemctl status docker`.

### A bad update
`shopos update` rolls back by itself when the new version is unhealthy. If the problem shows up later:
```bash
cd /opt/shopos && git log --oneline -5          # find the previous version
git checkout <previous-commit> && shopos update --force
```
If data looks wrong after the update, `shopos restore` the backup taken at the start of the update.

### Certificate problems
`shopos doctor` shows the days left. Let's Encrypt renews itself 30 days before expiry; failures are in
`shopos logs certbot` (usually DNS not pointing here, or port 80 blocked). Cloudflare origin certificates
last 15 years.

### Disk full
```bash
df -h /
docker system df
docker system prune -f            # unused images and build cache (does not touch data volumes)
ls -lh /opt/shopos/backups/production   # copy off, then delete the oldest
```
Never delete Docker *volumes* (`shopos-prod_db-data`, `shopos-prod_minio-data`): they are the data.

### Email stopped
`shopos logs app | grep mail` shows `[mail] send failed` with the provider's reason (wrong password,
daily limit, unverified sender). Fix with `shopos env` (applies on save).

### A shop owner is locked out
- Forgot password on the sign-in page (email needed).
- Too many attempts: they wait 15 minutes.
- Disabled staff member: the owner re-enables them on the Staff page.

### Restore after data loss
`shopos restore` → pick the backup → type RESTORE. The current data is backed up first, so a restore can
itself be undone.

### Suspected break-in
1. Rotate secrets: admin password; SMTP password at the provider; `shopos env`.
2. End every session: `docker compose -p shopos-prod --env-file .env.production exec db sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" -e "DELETE FROM sessions"'`.
3. Check `/var/log/auth.log` / `journalctl -u ssh`, `fail2ban-client status sshd`, `shopos logs nginx`.
4. Tell affected shops if their data may have been exposed (legal duty in the UK/EU).

## Useful commands

```bash
cd /opt/shopos
docker compose -p shopos-prod --env-file .env.production ps
docker compose -p shopos-prod --env-file .env.production exec db sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"'   # SQL shell
ssh -L 9001:127.0.0.1:9001 root@<server>        # then http://localhost:9001: MinIO console
ssh -L 8025:127.0.0.1:8025 root@<server>        # Mailpit, if email is not set up yet
```
