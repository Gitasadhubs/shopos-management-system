# Migration rollbacks

Migrations (lib/local-db.ts) only run forward. Each one that changes the schema has its undo here,
`NNNN-name.sql`, tested in CI against the migration it reverses. To roll back:

1. `shopos backup` (the safety net: `shopos restore` puts everything back exactly).
2. Switch the code back to the version before the migration (`git checkout <commit>` in /opt/shopos).
3. Run the rollback SQL (command at the top of each file), then `shopos update`-style rebuild:
   `docker compose -p shopos-prod --env-file .env.production up -d --build --wait`.

Data written into a removed column is lost by its rollback; restoring the backup taken in step 1 keeps it.
