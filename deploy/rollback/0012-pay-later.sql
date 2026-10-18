-- Undo migration 12 (pay later). Shops that chose "pay later" keep their plan and period end; only
-- the due date is forgotten.
ALTER TABLE subscriptions DROP COLUMN IF EXISTS payment_due_at;
DELETE FROM schema_migrations WHERE version = 12;
