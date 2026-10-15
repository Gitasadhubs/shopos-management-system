# ShopOS

Point of sale, inventory, customer credit (khata), suppliers, expenses, reports and day-end reports for
independent shops — one install serves many shops, each on a subscription, with a platform admin panel.
Next.js 16 + MariaDB + MinIO + nginx, all in Docker. Works offline at the till.

- **Put it on a server:** `sudo bash deploy/install.sh` — see [docs/deployment.md](docs/deployment.md).
- **Launching:** [docs/launch-checklist.md](docs/launch-checklist.md).
- **Everything else:** [docs/](docs/README.md).

## Developing

```bash
docker compose -f docker-compose.dev.yml up -d --build --renew-anon-volumes   # http://localhost:3000, Mailpit http://localhost:8027
docker exec shopos-dev npm run check                                          # types + lint
.\scripts\e2e.ps1                                                             # end-to-end tests
```

Run `npm run check` before every commit. Work on `dev`; push `dev` only after the e2e suite passes;
then promote to `prod`. Read [AGENTS.md](AGENTS.md) before changing code (this Next.js version has
breaking changes).
