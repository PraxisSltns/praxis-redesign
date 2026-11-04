# Railway: the staging environment

Staging is built from `main` after `ci.yml` passes on it (see `docs/deploy/ci.md`). Only staging is set up here: no production environment and no paid resource beyond the plan Praxis already pays for, and only once the written spend approval exists.

The gateway's build and deploy settings are in `railway.json` at the repository root (config as code). The dashboard steps below are what the file can't hold. Values in the file override the dashboard.

## What `railway.json` sets for the gateway

| Setting | Value | Why |
|---|---|---|
| Builder | `Dockerfile` | the same image as today |
| Start | `npm run start` | `node server/index.mjs` |
| Pre-deploy (`staging` environment only) | `npm run db:migrate` | migrations run once per deploy, before traffic moves. A failed migration stops the deploy and the old one keeps serving. Set only under `environments.staging`, so the existing service, which has no database, isn't affected |
| Health check | `GET /api/health`, 120 s | a deploy goes live only once it answers 200 |
| Restart | on failure, up to 5 times | |
| Watch paths | everything except `docs/`, `README.md`, `.github/`, `e2e/`, `video/`, `tools/` | a docs-only or test-only commit doesn't redeploy |

## The existing service: read this first

The project already has a service whose public address is `praxis-redesign-production.up.railway.app`. It deploys from `main`, and `smoke.yml` tests it. These steps don't touch its settings, but `railway.json` applies to every service built from this repository. It gains the health check, the restart policy and the watch paths. It doesn't gain the pre-deploy migration, which is set for `staging` only. Its start command and Dockerfile are the same as before. While it still deploys from `main`, every approved release pull request deploys it as well as staging. Decide whether it becomes staging, keeps running as a demo, or stops auto-deploying (Settings > Source > Disconnect, or switch its trigger branch). Don't remove it without the owner's say.

## Dashboard steps (a project admin)

1. **Environment.** Project > Environments > New environment, named `staging`, empty (not a copy of production). Work in `staging` for every step below.
2. **Region.** For each service: Settings > Deploy > Region > **EU West (Amsterdam)**.
3. **Postgres with pgvector.** New > Template > search "pgvector" > deploy the Postgres pgvector template. Then confirm the server version matches local (16):

   ```bash
   railway connect <postgres service>    # opens psql
   SHOW server_version;                  -- expect 16.x
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

   If the template runs a different major version, set its image to `pgvector/pgvector:0.8.0-pg16` (Settings > Source > Image) before any data goes in.
4. **Redis.** New > Database > Redis.
5. **Bucket.** New > Bucket, in EU West. Note the variable names it lists on its Variables tab (endpoint, bucket name, access key, secret, region).
6. **Gateway service.** New > GitHub repo > `bobibcgroup/praxis-redesign`. Then:
   - Settings > Source: **branch `main`**, and turn **Wait for CI** on, so a deploy waits for the `test` check on that commit.
   - Settings > Networking: generate a public domain (this is the staging address).
   - Settings > Volumes: add a volume (mount `/data`) so outfit pictures survive deploys (`RAILWAY_VOLUME_MOUNT_PATH`).
7. **Gateway variables** (Variables tab, using reference variables so nothing is copied by hand):

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   S3_ENDPOINT=${{Bucket.<endpoint variable>}}
   S3_BUCKET=${{Bucket.<bucket name variable>}}
   S3_ACCESS_KEY_ID=${{Bucket.<access key variable>}}
   S3_SECRET_ACCESS_KEY=${{Bucket.<secret variable>}}
   S3_REGION=${{Bucket.<region variable>}}
   S3_FORCE_PATH_STYLE=true
   ALLOW_BILLABLE_AI=false
   ALLOW_BILLABLE_IMAGES=false
   ```

   Use the service names as they appear in your project (`Postgres`, `Redis`, `Bucket` are the defaults). Don't set `GEMINI_API_KEY`, any `AI_PROVIDER_*` or `RETAIL_SHOPIFY_STORE` on staging without the owner's approval. A Gemini key on its own switches on the budgeted outfit pictures (`server/ai.mjs`, `APPROVED_DEFAULTS`).
8. **The ai service** (`services/ai`). New > GitHub repo, same repository, then:
   - Settings > Source: root directory `services/ai`, branch `main`, Wait for CI on. It builds from `services/ai/Dockerfile` with `services/ai/railway.json` (health check `/health`).
   - **Don't generate a public domain.**
   - Name the service `ai`.
   - Variables: `PORT=8000`. Leave `HOST` unset: it defaults to `::`, the private network's IPv6. `CUTOUT_MODEL` is a build-time choice (the image bakes the weights): leave it at `full`.
   - Resources: the image is 3.8 GB (CPU-only PyTorch plus about 1.2 GB of weights). Give the service **at least 8 GB of memory**. With both models loaded it uses 2.4 GB, and a full-size cut-out needs more than another 1.4 GB: in a 3.8 GB Docker VM the container was killed for memory (`OOMKilled`) during its first cut-out (2026-11-04). Start-up takes about 17 s while the models load, inside the 120 s health check.
   - On the gateway, add `AI_SERVICE_URL=http://ai.railway.internal:8000`. Search (`/api/search`) and the batch job (`npm run catalogue:process`, from a Railway one-off command or a cron service) need it. `/api/health` then reports `"ai": "up"`. If it's down, health reports `"down"` but the gateway stays healthy.

## Checking a deploy

- The deploy log shows the pre-deploy step (`npm run db:migrate`) before the health check.
- `curl https://<staging domain>/api/health` answers `{"ok": true, ...}` with the commit that was merged.
- Run the smoke test against it: Actions > "Smoke test live site" > Run workflow, with the staging address.
- In the staging gateway's Settings > Deploy, the pre-deploy command shows `npm run db:migrate` (from `environments.staging` in `railway.json`). In the existing service it stays empty. If staging doesn't show it, the environment isn't named exactly `staging`.
