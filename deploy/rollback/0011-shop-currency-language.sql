-- Rollback of migration 11 (shops.currency, shops.language). Run only together with going back to an app
-- version from before it, after a backup (shopos backup); see README.md.
ALTER TABLE shops DROP COLUMN IF EXISTS language;
ALTER TABLE shops DROP COLUMN IF EXISTS currency;
DELETE FROM schema_migrations WHERE version = 11;
