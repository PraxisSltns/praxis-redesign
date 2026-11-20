# Railway: the staging environment

Staging is built from `main` after `ci.yml` passes on it (see `docs/deploy/ci.md`). Only staging is set up here: no production environment and no paid resource beyond the plan Praxis already pays for, and only once the written spend approval exists.

Railway stops reading `railway.json` on 2026-12-01. Since 2026-11-21 the repository's Railway settings are in `.railway/railway.ts` (Infrastructure as Code), and `railway.json` is gone.

- **Staging's services** (gateway, ai, Postgres, Redis) are set in the dashboard, by the steps below. None of them read a config file. `.railway/railway.ts` declares nothing in staging, so applying it there changes nothing.
- **The existing service** (`praxis-redesign`, production environment) is the only one the file manages.

Nothing in `.railway/` applies on a push. A change reaches Railway only through these commands, run by hand:

```
npm ci                                                   # the file needs the `railway` package
railway config plan  --environment production --verbose  # preview, changes nothing
railway config apply --environment production            # applies, and starts a deploy of that service
```

## The gateway's settings (staging, in the dashboard)

These were entered by hand in Week 2, from the old `railway.json`. Check them in the gateway's Settings if a deploy behaves differently.

| Setting | Value | Why |
|---|---|---|
| Builder | `Dockerfile` | the same image as the existing service |
| Start | `npm run start` | `node server/index.mjs` |
| Pre-deploy | `npm run db:migrate` | migrations run once per deploy, before traffic moves. A failed migration stops the deploy and the old one keeps serving |
| Health check | `GET /api/health`, 120 s | a deploy goes live only once it answers 200 |
| Restart | on failure | |
| Watch paths | everything except `docs/`, `README.md`, `.github/`, `e2e/`, `video/`, `tools/`, `services/` | a docs-only or test-only commit doesn't redeploy |

## The existing service: read this first

The project already has a service whose public address is `praxis-redesign-production.up.railway.app`, in the `production` environment. It deploys from `main`, and Tarek decided to keep it as it is.

**It is frozen on the build of 2026-10-30, on purpose.** Its settings run `npm run db:migrate` before each deploy, and it has no database. So every deploy since then fails at that step and the October build keeps serving. `.railway/railway.ts` keeps that step (decided 2026-11-21). Removing `preDeploy` there and applying un-freezes it: the next merge to `main` then deploys the current build to it. Only do that by decision. Don't remove the service without the owner's say.

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
6. **Gateway service.** New > GitHub repo > `PraxisSltns/praxis-redesign`. Then:
   - Settings > Source: **branch `main`**, and turn **Wait for CI** on, so a deploy waits for the `test` check on that commit.
   - Settings > Networking: generate a public domain (this is the staging address).
   - Settings > Volumes: add a volume (mount `/data`) so outfit pictures survive deploys (`RAILWAY_VOLUME_MOUNT_PATH`).
7. **Gateway variables** (Variables tab, using reference variables so nothing is copied by hand):

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   REDIS_FAMILY=6
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
   - Settings > Source: root directory `services/ai`, branch `main`, Wait for CI on. It builds from `services/ai/Dockerfile`. Settings > Deploy: health check `/health`, 120 s; restart on failure. Settings > Build: watch paths `services/ai/**`, `!services/ai/tests/**`.
   - **Don't generate a public domain.**
   - Name the service `ai`.
   - Variables: `PORT=8000`, `TORCH_THREADS=8`, `OMP_NUM_THREADS=8` (match the memory/CPU plan: the container sees the host's 48 CPUs but may use 8, and with 48 threads a text vector took 11 s instead of 0.05 s). Leave `HOST` unset: it defaults to `::`, the private network's IPv6. `CUTOUT_MODEL` is a build-time choice (the image bakes the weights): leave it at `full`.
   - Resources: the image is 3.8 GB (CPU-only PyTorch plus about 1.2 GB of weights). Give the service **at least 8 GB of memory**. With both models loaded it uses 2.4 GB, and a full-size cut-out needs more than another 1.4 GB: in a 3.8 GB Docker VM the container was killed for memory (`OOMKilled`) during its first cut-out (2026-11-04). Start-up takes about 17 s while the models load, inside the 120 s health check.
   - On the gateway, add `AI_SERVICE_URL=http://ai.railway.internal:8000`. Search (`/api/search`) and the batch job (`npm run catalogue:process`, from a Railway one-off command or a cron service) need it. `/api/health` then reports `"ai": "up"`. If it's down, health reports `"down"` but the gateway stays healthy.

## Lessons from building staging (2026-11-14)

- Dashboard edits are staged: nothing changes until **Deploy** (or a redeploy) picks them up.
- **Pre-deploy command** and **Custom start command** are separate boxes. The migration goes in pre-deploy; the start command stays `npm run start`.
- Set `REDIS_FAMILY=6` on every service that uses Redis: Railway's Redis answers only on the private network's IPv6 address.
- `railway environment edit --service-config` didn't apply service settings (CLI 5.74), so set them in the dashboard.
- Set `TORCH_THREADS` and `OMP_NUM_THREADS` on `ai` to its CPU limit (8). Without them PyTorch starts a thread per host CPU (48) and is throttled: search took 11 s and a cut-out 145 s.
- Batch work runs over SSH: `railway ssh -s gateway -e staging -- 'cd /app && npm run db:seed'`.

## Backups and the down-alert

- **Backups.** Railway backs up volumes from the dashboard: staging → `Postgres` → **Backups** → turn on a **daily** schedule. Do the same for `gateway-volume` (outfit pictures) if they matter. A restore is from the same tab. The bucket isn't backed up this way: cut-outs can be made again from the products' photos (`npm run catalogue:process`).
- **Down-alert.** `.github/workflows/uptime.yml` checks staging every hour (health ok with the database, Redis and the ai service up, and the page loading), trying three times a minute apart. A failed run is the alert: GitHub emails whoever last changed the schedule. Run it by hand from Actions → "Staging uptime". About 720 Actions minutes a month.

## Checking a deploy

- The deploy log shows the pre-deploy step (`npm run db:migrate`) before the health check.
- `curl https://<staging domain>/api/health` answers `{"ok": true, ...}` with the commit that was merged.
- Run the smoke test against it: Actions > "Smoke test live site" > Run workflow, with the staging address.
- In the staging gateway's Settings > Deploy, the pre-deploy command shows `npm run db:migrate`.

## Sign-in on staging

The page signs people in for real only when it's built with `VITE_AUTH=magic-link` (`src/core/config.ts`). Until then the sign-in screens are the preview, as on the existing service. The page is served by the gateway itself, on one address, so the session cookie is first-party and the staging app already talks to the staging gateway. `VITE_API_BASE_URL` stays unset.

1. **Mail.** In Resend, verify the domain `trypraxis.ai` (Resend lists the DNS records to add at the domain's DNS host), then on the gateway set `RESEND_API_KEY` and `MAIL_FROM=Praxis <no-reply@trypraxis.ai>` (the sender Praxis chose, 2026-11-13). Without them, a production server answers that sign-in isn't available. It never pretends to send.
2. **Address.** On the gateway, set `APP_ORIGIN` to the staging address (`https://<staging domain>`). Links point there, and changing requests must come from it.
3. **Build.** On the gateway, set the variable `VITE_AUTH=magic-link`. The Dockerfile declares it as a build argument, so Railway passes it into `npm run build`. Redeploy.
4. **Check.** `curl -X POST https://<staging domain>/api/auth/start -H 'Origin: https://<staging domain>' -H 'Content-Type: application/json' -d '{"email":"you@example.com","anonymousSessionId":"anon_check12345","consents":[{"category":"terms","version":"terms-draft-2026-11"},{"category":"privacy","version":"privacy-draft-2026-11"}]}'` answers 202, and the email arrives.

## The browser scenarios against staging

Actions > "E2E against staging" > Run workflow, with the staging address (`.github/workflows/e2e-staging.yml`). It runs every suite except 12 and 14, which need a server the test run starts itself, and keeps the report as an artifact. Suite 7 (accounts) tests the sign-in **preview**. Run it while staging is built with `VITE_AUTH` unset. The real sign-in has its own check, `e2e/signin-magic-link.mjs`, which reads the link from a local server's log and so runs locally (`docs/development.md`).
