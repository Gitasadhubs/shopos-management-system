-- Rollback of migration 10 (shops.country). Run only together with going back to an app version from
-- before it, after a backup (shopos backup):
--   docker compose -p shopos-prod --env-file .env.production exec -T db sh -c 'exec mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"' < deploy/rollback/0010-shop-country.sql
ALTER TABLE shops DROP KEY IF EXISTS shops_country_idx;
ALTER TABLE shops DROP COLUMN IF EXISTS country;
DELETE FROM schema_migrations WHERE version = 10;
