# Week 1 report: backend foundation (2 to 6 Nov 2026)

A running log, one section per phase: what was done, each check with pass or fail and its evidence, and what is still open.

## Phase 0: baseline

Run on 2026-11-03 on `b4421f0` (main, 2026-10-29), macOS, Node 22.23.2, npm 10.9.8, Docker 27.5.1. No code was changed.

### Checks

| Check | Command | Result | Evidence | 12 Oct report |
|---|---|---|---|---|
| Clean install | `rm -rf node_modules dist && npm ci` | pass | installs with no errors | n/a |
| Unit tests | `npm test` | pass | `Test Files 20 passed (20)`, `Tests 280 passed (280)`, 6.6 s | 210 tests in 14 files |
| Typecheck and build | `npm run build` | pass | `built in 3.88s`; warning: `index-*.js` is 602 kB (190 kB gzip), over Vite's 500 kB chunk warning | passes |
| Home photos | `npm run photos:check` | pass | `Tests 2 passed (2)` | not in the report (added later) |
| Scenarios | `npm run e2e` | fail (1 flaky check) | `246 of 247 runs passed; 2423 of 2424 checks passed`, 15 suites. The one failure was `TRY5 phone: the camera problem is explained with a way on`. `ONLY=TRY5 npm run e2e` then passed 3 of 3 times | 179 of 179 runs, 1794 of 1794 checks, 13 suites |

### Differences from docs/testing-report.md (12 Oct)

- There are 70 more unit tests (280, up from 210) in 6 more files (20, up from 14). The new files cover the catalogue, outfit images, the free writer, explanations, real stock and occasion photos. The report hasn't been updated since release 0.4.0.
- There are 15 e2e suites, not 13: `14-hybrid.mjs` and `15-round2.mjs` were added after the report.
- e2e needs the Chromium that matches the pinned `playwright-core` 1.56 (headless shell build 1194). A machine that only has a newer cached build fails with `Executable doesn't exist at .../chromium_headless_shell-1194`. Running `npx playwright-core install chromium` (the same step smoke.yml runs) fixes it. CI will need this step too.
- 247 e2e runs and 2424 checks now, up from 179 runs and 1794 checks.
- TRY5 on phone (no camera access) failed once in the full run but passed 3 of 3 times alone. It looks timing-dependent, so I'll watch it in CI before calling it flaky. Open item.
- The build prints a chunk size warning for the main bundle (602 kB). It isn't a failure. The report doesn't mention it.

### One styling request, traced

1. The screens keep every answer in the URL. `useStylingRun` (`src/a/lib/styling.ts:153`) builds a spec, and `buildStylingRequest` (`src/core/request.ts:53`) turns it into a `StylingRequest` (contract `1.0`, `src/core/contracts.ts:13`) with a `requestId` and an `inputKey`.
2. If the history already has an answer for that `inputKey` and owner, that answer is used. Otherwise `stylingService()` (`src/core/service.ts`) is called. It picks `createMockAdapter()` unless `styling_recommendation` is listed in `VITE_AI_PROVIDERS`, and wraps it in `withSimulation` (test mode).
3. `mock.ts` scores the 15 library outfits on feel, place, time and budget and returns raw JSON. `validateStylingResponse` (`src/core/validate.ts:234`) drops malformed looks (the answer becomes `partial`) or turns the whole answer into a `failed` response.
4. Next come the pieces: `composeHybrid` (`src/core/catalogue/hybrid.ts`) calls `GET /api/ai`. If `product_matching` is live there, it calls `POST /api/ai/product_matching` (shopify-feed) and composes store pieces with references. Then the mock retailer adds sizes and stock.
5. Then the words: `addStylistWords` (`src/core/ai/words.ts`) calls `POST /api/ai/styling_explanation` (gemini-free) only if that service is live. The request and its response are then saved in `praxis_styling_history`.
6. `toLook` (`src/a/lib/looks.ts:16`) maps each `OutfitRecommendation` to the view model the screens draw. Rank 1 is "My pick".
7. The AI path: `callService` (`src/core/ai/services.ts`) checks the payload, applies the billable guard, sets the time limit, retries once and checks the result. `httpProvider` (`src/core/ai/http.ts`) then POSTs the envelope to `/api/ai/<service>`.
8. On the server, `server/index.mjs` routes the call to `handleAi` (`server/ai.mjs`). That checks the envelope, picks a provider from `AI_PROVIDER_<SERVICE>` or the free/approved defaults, enforces the billable switch and a 40 s timeout, and loads `server/providers/<name>.mjs` to `run()` it. With no provider set it answers `{status: "disabled", error: not_connected}`.

### What exists, and what Week 1 still needs

| Area | Exists today | Week 1 needs |
|---|---|---|
| Gateway | `server/index.mjs`: plain Node, serves `dist/`, `/api/health`, `/api/ai[/<service>]`, `/api/tryon`, `/api/visuals/*`, `/api/client-error` | db and redis clients, `/api/search`, auth routes, a call to the ai service |
| Database | none. Everything is browser storage. `docs/data-schemas.md` §9 proposes tables | Postgres 16 + pgvector, node-pg-migrate migrations, seed |
| Redis | none | client, health, batch queue for cut-outs and vectors |
| Object storage | none. Outfit pictures are saved to disk under `VISUALS_DIR` / `RAILWAY_VOLUME_MOUNT_PATH` | S3-compatible bucket (MinIO locally) |
| Auth | visual previews only (`src/a/ui/Gate.tsx`, `src/a/lib/user.ts`), random ids per email in localStorage | AuthProvider interface, magic link via Resend, httpOnly session cookies, consents |
| Retailers | `server/providers/shopify-feed.mjs` (public `/products.json`, test only), `createMockRetailer` | RetailerConnector interface, Shopify + CSV adapters, contract test, idempotent import |
| AI service | none (Gemini is called straight from Node providers) | `services/ai` FastAPI: `/health`, `/cutout` (BiRefNet), `/embed` (Marqo-FashionSigLIP) |
| CI/CD | `smoke.yml` (after each Railway deploy), `visual-demo.yml`, `style-dna-image.yml`. No CI on push, no `dev` branch | `ci.yml` (test + open-pr), `automerge.yml`, branch protection, railway.json, vercel.json |
| Local dev | `npm run dev` (Vite) and `npm start` | docker-compose (pgvector, redis, MinIO), `.env.example`, `docs/development.md` |

### Found while reading: needs a decision before Phase 1

1. **No CLAUDE.md.** It's listed under "READ FIRST" but doesn't exist. I used the README and docs as the source of truth.
2. **No `dev` branch on origin.** I created `dev` locally from `main` at `b4421f0` and committed this log to it. It isn't pushed yet.
3. **The `.gitignore` rule `.env.*` also ignores `.env.example`.** Phase 1 adds `!.env.example`.
4. **The paid AI ground rule doesn't match the code.** `server/ai.mjs` has `APPROVED_DEFAULTS = { outfit_visualization: gemini-image }`. That paid provider switches itself on with `GEMINI_API_KEY` alone and is marked `budgeted`, so it skips `ALLOW_BILLABLE_AI`. The page finds it through `GET /api/ai`, not `VITE_AI_PROVIDERS`. The 20 USD budget Tarek approved on 2026-10-12 caps it. `product_matching` (shopify-feed, free) likewise switches on with `RETAIL_SHOPIFY_STORE` alone. So "needs all three switches" holds for every service except these two.
5. **The page calls `/api` even when `VITE_AI_PROVIDERS` is empty.** `liveServices()` (`GET /api/ai`, `src/core/ai/words.ts:31`) runs once per tab, from `composeHybrid` and `addStylistWords`. `/api/client-error` is posted on errors in builds that aren't dev. With no gateway, `/api/ai` would get `index.html` from the SPA rewrite. `liveServices` already catches that and answers `[]`, so the looks stay on the mock. Phase 1 will check this in a real browser.
6. **No API base URL exists.** Every endpoint is relative (`/api/ai`, `/api/tryon`, `/api/client-error`). Pointing a Vercel build at a gateway on another origin needs a new `VITE_API_BASE_URL`, plus CORS on the gateway. For Phase 5 it also needs cross-site cookies (`SameSite=None; Secure`), or a Vercel rewrite that proxies `/api` to the gateway so cookies stay first-party. A rewrite isn't a serverless function.
7. **Railway already has a service called `praxis-redesign-production`.** It deploys from `main`, and smoke.yml tests it by default. The ground rules say there's no production environment. Is this the service we treat as staging, or should staging be a new Railway environment?
8. **Some docs are out of date.** `docs/architecture.md`, `docs/integration-dependencies.md` and `docs/data-schemas.md` still say "there is no server", and integration-dependencies says the app is served by `serve`. They need updating when the db and gateway work lands.
9. **Table names.** `docs/data-schemas.md` §9.2 names `users`, `consents`, `wardrobe_items`, `feedback` and `saved_looks` (not `looks`), plus `anonymous_sessions`, `style_profiles`, `styling_requests`, `recommendations`, `selections`, `image_assets` and `analytics_events`. It has no retailer, product or variant tables ("out of scope"). Phase 2 will need new names for those.
10. **Slots.** In the ontology (`src/shared/ontology.mjs`) the slots are `top`, `bottom`, `shoes` and `extras`. A jacket is slot `top` with layer `outer`, not a slot of its own. Phase 3's "top, bottom, shoes, jacket" would mean either adding a slot or mapping on (slot, layer).
11. **DECISIONS still has two placeholders:** the first retailer (`<SHOPIFY STORE DOMAIN or CSV PATH>`) and the merge token (`GitHub App` or `MERGE_TOKEN` PAT).

## Phase 1: branches, CI/CD, dev environment

Run on 2026-11-03 and 2026-11-04, on local branch `dev` (not pushed). Phase 0's defaults were used for the open decisions: the paid image switch stays as it is and no Gemini key is set on staging, staging is a new Railway environment, the docs are the source of truth, and the merge token is a fine-grained PAT in `MERGE_TOKEN`.

### What was done

| Commit | What it adds |
|---|---|
| `b6047c1` | `.github/workflows/ci.yml` (job `test`: npm ci, unit tests, build; job `open-pr`: after a green push to dev, opens or updates the one dev -> main PR as github-actions[bot]), `.github/workflows/automerge.yml` (on an approved review of dev -> main, `gh pr merge --merge` with `MERGE_TOKEN`, a comment if refused), `docs/deploy/ci.md` (the flow and the exact `gh` commands) |
| `3c26481` | `VITE_API_BASE_URL` and `apiUrl()` (`src/core/config.ts`) for every `/api` call and `/api` picture; `server/cors.mjs` with `CORS_ORIGINS` (exact origins, credentials, preflight); 6 unit tests |
| `13c56be` | `docker-compose.yml` (Postgres 16 + pgvector 0.8.0, Redis 7.4, SeaweedFS for S3, a bucket job), `.env.example`, `!.env.example` in `.gitignore`, `.env` kept out of the Docker image (`.dockerignore`), npm scripts `dev:up`, `dev:down`, `dev:reset`, `db:migrate`, `db:seed`, `dev:api`, `docs/development.md` |
| `24a049c` | `railway.json` (Dockerfile, `npm run start`, health check `/api/health`, restart on failure, watch paths that skip docs, tests, video and tools; pre-deploy `npm run db:migrate` for the `staging` environment only), `docs/deploy/railway.md` |
| `d7dee01` | `vercel.json` (mock build, `dist`, SPA rewrite except `/api`, `main` never deploys), `VITE_BACKEND=none` so a preview with no server makes no `/api` call, `tools/preview-check.mjs`, `docs/deploy/vercel.md` |

### Checks

| Check | Result | Evidence |
|---|---|---|
| Unit tests and build after the changes | pass | `npm test`: `Test Files 21 passed (21)`, `Tests 287 passed (287)`; `npm run build`: `built in 4.18s` |
| No regression in the browser scenarios (normal build, real server) | pass, same as baseline | `npm run build && npm run e2e`: `246 of 247 runs passed; 2423 of 2424 checks passed`, the same as Phase 0. The only failure is again the flaky `TRY5 phone` |
| Workflows parse | pass | `python3 -c "import yaml; ..."` on both files: `yaml ok`. actionlint isn't installed here, so GitHub's own parse on the first push is the real check |
| A red push gives a red `test`, no PR update, merge blocked | not run | needs `dev` pushed and the branch protection in `docs/deploy/ci.md` applied |
| A green push opens or updates the PR as github-actions[bot] | not run | same |
| Approval merges, ci.yml runs on main, Railway deploys | not run | same, plus the Railway staging setup; Sami confirms the Railway side |
| CORS on the real gateway | pass | `CORS_ORIGINS=http://localhost:5173`: preflight from that origin `204` with `Access-Control-Allow-Origin: http://localhost:5173` and `-Credentials: true`; from `https://evil.example` `403` with no CORS headers; `GET /api/ai` keeps `{"live":[]}` and gets `Vary: Origin, Accept-Encoding`; `/api/health` unchanged |
| Vercel build works with no gateway: journeys | pass | build with the `vercel.json` command, `vite preview` on :4174, `node tools/preview-check.mjs`: 18 of 18 journeys (home, first question, build to results, results with next look and why, try-on, Style DNA, saved looks, wardrobe, your data; desktop and phone) with no `/api` request, no console error and no error screen. The same probe against a build without `VITE_BACKEND=none` fails with `called the server: GET /api/ai`, so it does detect the problem |
| Vercel build works with no gateway: full scenarios | pass, expected failures only | `BASE_URL=http://localhost:4174 npm run e2e` against the `vercel.json` build: `234 of 247 runs passed; 2313 of 2363 checks passed`, with no "no page errors" failure left. The 13 failing runs all need a server by design. Suite 14 (hybrid catalogue, 10 runs) stands in for a store behind `/api/ai`, which a `VITE_BACKEND=none` build never calls. Suite 12 P3-12b and P4-12e call the server's API directly from node and get HTML or nothing. The last is the flaky TRY5 phone |
| `npm run dev:up` brings every container up healthy | pass | `docker compose ps`: postgres, redis and s3 `Up (healthy)`; s3-bucket `Exited (0)` after `make_bucket: praxis-local` |
| `CREATE EXTENSION vector` works locally | pass | `CREATE EXTENSION`; `extversion 0.8.0`; `'[1,2,3]'::vector <=> '[1,2,4]'::vector` = `0.0085`; `server_version 16.10` |
| `dev:reset` starts empty, `dev:api` reads `.env` | pass | after reset the vector extension count is `0` (volume wiped); `npm run dev:api` serves on :3000 and a preflight from :5173 gets `204` (CORS_ORIGINS from `.env`) |

### Found on the way

1. **MinIO can't be pulled.** `minio/minio`, `minio/mc` (Docker Hub: "pull access denied ... repository does not exist") and `quay.io/minio/minio` ("unauthorized") all refuse, while `redis:7.4-alpine` pulls fine. Local S3 is SeaweedFS 4.50 (Apache 2.0) instead, checked for bucket creation, upload, list and refusal of a wrong key (`InvalidAccessKeyId`). The gateway will use a plain S3 client, so the Railway bucket works the same way. This changes the "MinIO locally" decision.
2. **A preview with no server used to log a failed request on every journey.** Run against `vite preview` before the `VITE_BACKEND` change, the scenarios had 2399 of 2550 checks passing and 97 of 247 runs. Almost every failed run was the "no page errors" check catching `Failed to load resource: 404` from `GET /api/ai`. The page itself was fine. `VITE_BACKEND=none` now skips that call and the error reporter in such a build.
3. **`railway.json` applies to every service built from this repository**, including the existing `praxis-redesign-production`. That's why the migration step is set under `environments.staging` only. The existing service gains the health check, restart policy and watch paths, and otherwise stays the same.
4. **The existing service deploys from `main`.** Once the flow is on, every approved release PR deploys it as well as staging, unless its trigger is changed. The same goes for `visual-demo.yml`: a merged PR that touches `.github/visual-demo-request.txt` makes up to three paid outfit pictures on that service, within its approved budget.
5. **`.env` would have been copied into a locally built Docker image** (`.dockerignore` didn't list it). It's listed now.
6. **TRY5 phone is flaky.** It failed again in the preview run. It passes alone.
7. **`npm run e2e` will quietly test against whatever is already on port 4173.** It starts its own server with output ignored. If an old server still holds the port (here one left behind by the stopped Phase 0 run), the new one can't bind, and the suite tests the old process. That old process serves an `index.html` whose assets a rebuild has deleted, so the run hangs with no screenshots. Workaround: `lsof -ti :4173 | xargs kill` before running. A fix (fail when the port is taken) is an open item.

### By hand (Sami or a repository admin)

1. Push `dev`: `git push -u origin dev`.
2. Run the `gh` commands in `docs/deploy/ci.md` §1 to §6: default branch, the Actions setting, merge commits, `main` and `dev` protection, the `MERGE_TOKEN` secret.
3. Then run the three flow checks in `docs/deploy/ci.md` "Checking it works". I can push the failing and green commits once `dev` is protected and you say so.
4. Railway: the steps in `docs/deploy/railway.md`, once the written spend approval exists.
5. Vercel: the steps in `docs/deploy/vercel.md`.

### Open items

- The three CI flow checks (waiting on the push and the settings).
- What the existing `praxis-redesign-production` service becomes (finding 4).
- The `ai` service on Railway once `services/ai` exists (Phase 3).

## Phase 2: data model, migrations, health

Run on 2026-11-04 on local branch `dev` (not pushed).

### What was done

| Commit | What it adds |
|---|---|
| `4557403` | Five SQL migrations in `server/db/migrations` (node-pg-migrate 8.0.4): the `vector` extension; `users`, `consents`; `wardrobe_items`; `retailers`, `products` (with `slot`, `layer`, `cutout_url`, `embedding vector(768)` and an HNSW index on `vector_cosine_ops`), `product_variants` (size, price, `available`, `stock_quantity`); `saved_looks`, `feedback`. npm scripts `db:migrate`, `db:migrate:down`, `db:migrate:create`. CI's `test` job now runs a `pgvector/pgvector:0.8.0-pg16` service and migrates up, down to zero tables, and up. Local Postgres moves to port 5433. `docs/data-schemas.md` §9 now marks which tables are built and how they differ from the proposal, with a new §9.5 for the catalogue |
| `a9107d7` | `server/db.mjs` (pg 8.23 pool: 10 connections, 5 s connect, 10 s statement, 15 s query, 30 s idle, each overridable), `server/redis.mjs` (node-redis 5.12: no offline queue, so commands fail at once while down; growing reconnect delay; errors logged at most every 30 s), `server/health.mjs`; `/api/health` gains `dependencies: {db, redis}` (each `up`, `down` or `off`), answers 503 with `ok: false` when a configured one is down, and keeps every earlier field. The server closes the pool and Redis on SIGTERM. 12 unit tests |

Table names follow `docs/data-schemas.md`: `wardrobe_items` (the brief's "wardrobe"), `saved_looks` (the brief's "looks"), and `product_variants` for variants, since the doc has no name for it.

### Checks

| Check | Result | Evidence |
|---|---|---|
| Up, down, up on an empty database | pass | after `npm run dev:reset`, `npm run db:migrate` creates 8 tables plus `pgmigrations` and `products_embedding_hnsw`. `npm run db:migrate:down -- 1000` runs all five DOWN migrations: 0 tables left, the `vector` extension removed. `npm run db:migrate` applies all 5 again, and a further run says `No migrations to run!` |
| The same in CI's steps | pass locally | the `Migrations up, down, up` step's commands, run against the local database: `after down: 0 tables`, then 5 UP migrations. CI itself runs once `dev` is pushed |
| Constraints | pass | slot `jacket` is refused (`products_slot_check`); a 3-number vector is refused (`expected 768 dimensions, not 3`); a second (retailer, external id) is refused (`products_retailer_id_external_id_key`); deleting a retailer removes its products |
| Stopping Redis gives 503 with `redis: down` | pass | `npm run dev:api` with compose up: `200 {"ok":true,"dependencies":{"db":"up","redis":"up"}}`; `docker compose stop redis` then `503 {"ok":false,"dependencies":{"db":"up","redis":"down"}}`; `docker compose start redis` then `200` again. Stopping Postgres the same way: `503 ... "db":"down"`, then `200` |
| A server with no database still passes | pass | `node server/index.mjs` with no `DATABASE_URL` or `REDIS_URL` (the existing Railway service): `200 {"ok":true,"dependencies":{"db":"off","redis":"off"}}` |
| Health unit tests | pass | `src/core/__tests__/health.test.ts`: 12 tests (off, up, down, throws, timeout; 200 and 503 cases; settings) |
| Smoke test still passes | pass | `node tools/smoke.mjs http://localhost:3000` against `npm run dev:api`: `38 of 38 smoke checks passed` |
| Unit tests and build | pass | `Test Files 22 passed (22)`, `Tests 299 passed (299)`; `built in 4.42s` |

### Found on the way

1. **A Postgres already installed on this machine was answering on 5432.** A Homebrew `postgresql@14` listens on `127.0.0.1:5432` and won over Docker's port, so the first migration got `role "praxis" does not exist`. Local Postgres is now published on 5433 (`docker-compose.yml`, `.env.example`, `docs/development.md`). CI and Railway are unaffected.
2. **On Railway, a 503 now fails the deploy's health check.** In staging, a deploy whose Postgres or Redis is unreachable won't go live, which is the intent. The existing service has neither configured, so it reports `off` and stays at 200.
3. **`npm audit` (lockfile only) goes from 15 findings to 17.** Before Phase 2: 8 moderate, 5 high, 2 critical. After: 10 moderate, 5 high, 2 critical. The 2 new moderate findings are `node-pg-migrate` through `glob` ("AbortSignal cancellation bypass allows post-timeout filesystem traversal"). That code runs only in the migration CLI, at deploy time, on our own files. npm's suggested fix is a downgrade to node-pg-migrate 7.6.1, so I left it. The existing findings include runtime packages, not only dev tools:
   - `sharp` (high, libvips, libheif and librsvg CVEs; fixed in 0.35.5, a major bump)
   - `react-router` (moderate, an open redirect in `<Link>`; fixed in v7)
   - `vitest` and `tinypool` (critical, but only while the Vitest UI server is listening or through worker options; non-breaking fix available)
   None are fixed here. Open item.

### Open items

- CI's migration step runs on GitHub once `dev` is pushed.
- Not built yet: `anonymous_sessions`, `style_profiles`, `styling_requests`, `recommendations`, `selections`, `image_assets`, `analytics_events` (doc §9.2, still proposals).
- `npm audit`: decide on the sharp, react-router and vitest upgrades (finding 3). My default: apply the non-breaking vitest/tinypool fix now, and schedule sharp 0.35 and react-router 7 as their own changes with the e2e suite.

## Phase 3: retailer connectors, first import, ai service skeleton

Run on 2026-11-04 on local branch `dev` (not pushed). No retailer feed arrived, so the first import uses the fixtures: the e2e test store (`e2e/fixtures/test-store.mjs`, as the Shopify retailer) and a new sample CSV (`server/retailers/fixtures/sample.csv`).

### What was done

| Commit | What it adds |
|---|---|
| `134d271` | Shared ontology: a knit, silk or wool tie is a tie. Before, "Silk Knit Tie" was filed as `top` / knitwear, because "knit" came first. This affects the live store feed too |
| `c6dede0` | `server/retailers/`:<br>• `connector.mjs`: the normalised item and `problemsWith`<br>• `shopify.mjs`: grown out of `shopify-feed.mjs`, which now reads stores through `readShopifyProducts`<br>• `csv.mjs`: an RFC 4180 reader, one row per variant, bad rows rejected with their line<br>• `import.mjs`: one transaction; upsert on (retailer, external id); pieces that leave are kept with `removed_at` and their sizes made unavailable; changed photos clear the cut-out and vector; slots from the ontology, with unmapped and not-a-garment lists<br>• `cli.mjs`: `npm run retailers:import`, and `npm run db:seed` for the fixtures<br>The CSV spec is in `docs/CATALOGUE.md`. 20 tests. CI now migrates before the unit tests, so the database tests run there |
| `52435e2` | `services/ai`:<br>• FastAPI 0.162 with `/health` only (no docs or schema exposed)<br>• every package pinned for Python 3.12, `python:3.12.16-slim`, a non-root user<br>• binds `HOST` (default `::`) on `PORT` (default 8000)<br>• pytest, its own `railway.json`<br>It's in `docker-compose.yml` (`HOST=0.0.0.0` locally), and `dev:up` now builds it. CI runs its pytest inside the `test` job. The gateway reports it in `/api/health` as `ai` from `AI_SERVICE_URL`, without letting it cause a 503 |

### Checks

| Check | Result | Evidence |
|---|---|---|
| Both connectors pass the contract test | pass | `src/core/__tests__/retailers.test.ts`, "the connector contract, met by both connectors": for `shopify` (the test store via `fixtureStoreFetcher`) and `csv` (the sample), every item has `problemsWith(item) = []`, exactly the contract's fields, and ids stable between reads. `Tests 20 passed (20)` with `DATABASE_URL` set; 15 passed and 5 skipped without it |
| First import slots at least 95% of in-stock items, the rest listed | pass for the first retailer and for both together; the CSV alone is 94.7% by design | `npm run db:seed`. **Test Tailors** (Shopify fixture): `in-stock garments slotted: 9 of 9 (100%)`, `not a garment, skipped: 11 "Gift Card"`. **Harbour & Hide** (sample CSV): `18 of 19 (94.7%)`, `unmapped: WKD-OLV "The Weekender" (type none, in stock)`, `not a garment, skipped: GFT-100 "Gift Card"`, `rejected: line 32 BAD-001: price is not a number of at least 0`. Both together: 27 of 28 (96.4%). The Weekender (a bag) is in the sample on purpose, to show an unmapped piece being listed and not guessed |
| The import is idempotent | pass | second `npm run db:seed`: `0 new, 0 changed, 0 back in the feed, 0 left the feed` for both; the test compares every product's `updated_at` before and after |
| Removals are kept, not deleted | pass | test: without the navy blazer's rows, `removed: 1, variantsMadeUnavailable: 3`, `removed_at` set, no size available; with them back, `restored: 1` and sizes available again |
| A failed import changes nothing | pass | test: an item whose price overflows `numeric(12,2)` fails the import, and the variant count is unchanged |
| The live feed still works after its reader moved | pass | `real-stock` and `hybrid` unit tests `34 passed`; `SUITE=14 npm run e2e`: `11 of 11 runs passed; 110 of 110 checks passed` |
| Gateway to ai `/health` locally | pass | `npm run dev:up`: `ai Up (healthy)`; `curl localhost:8000/health`: `{"ok":true,"service":"ai","version":"0.1.0","commit":"local","models":[]}`; `npm run dev:api` with `AI_SERVICE_URL=http://localhost:8000`: `/api/health` gives `200 {"db":"up","redis":"up","ai":"up"}`; with `docker compose stop ai`: `200 {"db":"up","redis":"up","ai":"down"}` |
| The image binds `::` by default | pass | `docker run praxis-ai` with no `HOST`: `Uvicorn running on http://[::]:8000`; `[::1]` gets 200; `127.0.0.1` refused (IPv6 only, as on Railway) |
| ai service tests | pass | `python -m pytest -q`: `2 passed, 1 warning` |
| Unit tests and typecheck | pass | with `DATABASE_URL`: `Test Files 23 passed (23)`, `Tests 321 passed (321)`; `tsc` 0 errors |

### Found on the way

1. **The shared ontology filed knit ties as knitwear.** Fixed in `134d271`. The tie entry now comes before "knit". "Tie-Dye Tee" is still a t-shirt, checked.
2. **Gift cards.** Both fixtures include one. The ontology already refuses them, and the import lists them as "not a garment" so they don't count as unmapped clothing. The list is `NOT_A_GARMENT` in `server/retailers/import.mjs`.
3. **Uvicorn's `::` socket is IPv6 only.** asyncio sets `IPV6_V6ONLY`. On Railway, whose private network is IPv6, that's what we want. Locally the IPv4 port mapping was refused, so compose sets `HOST=0.0.0.0`.
4. **`docker compose up` reused an old ai image** after a code change. `dev:up` and `dev:reset` now pass `--build`.
5. **The first CSV retailer id depended on the file's absolute path.** Fixed before committing: ids come from the connector's id (`csv:<file name>`, `shopify:<store>`).
6. **Starlette's test client warns that it wants `httpx2`.** Installing it was blocked, rightly, because I hadn't checked the package's provenance. `httpx` 0.28.1 stays, and the warning remains. Open item.

### Open items

- The real first retailer (a store address or CSV) to replace the fixtures.
- `httpx2`: check that it's the official successor before switching (finding 6).
- The ai service on Railway (`docs/deploy/railway.md` step 8) once staging exists.

## Phase 4: cut-outs, vectors, search

Run on 2026-11-04 on local branch `dev` (not pushed), on the Week 1 laptop: Apple M1, 8 GB of RAM, 6.7 GB of swap in use, load average 5 to 35 from other apps during the run. Every timing below is from that machine and is a worst case, not a figure for Railway.

### What was done

| Commit | What it adds |
|---|---|
| `e4f7e58` | Shared ontology: "Black leather oxfords" (and suede, patent or calf oxfords and derbies) are shoes. Before, they matched the oxford-shirt rule, and the search test found it (finding 1) |
| `db85e95` | `tools/fixture-images.mjs`: real garment photos for the fixtures, cut from the library photographs. That gives `server/retailers/fixtures/library.csv` (46 pieces, one per region of each photograph) and stand-in photos for the e2e store and `sample.csv` (29), 1.8 MB in all. `npm run db:seed` imports the library catalogue as a third retailer |
| `cad78d2` | The batch job and search:<br>• `server/storage.mjs`: an S3 client for one private bucket (AWS SDK v3)<br>• `server/ai-service.mjs`: the client for `/cutout` and `/embed`<br>• `server/catalogue/process.mjs` + `cli.mjs`: `npm run catalogue:process`, the Redis queue with recovery, retries and an idempotent key per photo<br>• `server/search.mjs`: `POST /api/search` and `GET /api/cutouts/...`<br>Also 10 job and search tests on real Postgres and Redis, the 10-query search test (`SEARCH_QUALITY=1`), and Redis in CI |
| `224976b` | `services/ai`:<br>• `POST /cutout` (BiRefNet) and `POST /embed` (Marqo-FashionSigLIP via open_clip `local-dir:`), with both models loaded once at start-up and inference one call at a time<br>• `app/download.py` fetches the weights at pinned revisions, and the Dockerfile bakes them in (CPU-only torch). `CUTOUT_MODEL=full\|lite`<br>• requirements split into web, runtime and dev, every package pinned; 9 pytest tests with a stand-in for the models<br>• the licence inventory in `docs/integration-dependencies.md` |

### Checks

| Check | Result | Evidence |
|---|---|---|
| Every imported item has exactly one cut-out and one 768-number vector | pass, except 2 items whose photo the e2e fixture breaks on purpose | `npm run catalogue:process` over the three fixture retailers: `done 73, retried 0, failed 2`, `coverage: 73 of 75 have a cut-out, 73 of 75 a vector (0 of the wrong size)`. Per retailer: Harbour & Hide 19 of 19, Praxis Library 46 of 46, Test Tailors 8 of 10. There are 73 distinct cut-out keys for 73 products. The 2 failures are `the photo was not found (/missing.jpg)`, the e2e store's deliberately broken photo, after 1 try, because a missing photo isn't retried. The 75 eligible are live, slotted products with a photo. Gift cards and the unmapped Weekender aren't eligible |
| The job is idempotent and resumable | pass | a second run: `queued 2 new` (only the two that failed), `done 0`, and no cut-out made again. Tests: a job a stopped worker had taken is recovered (`recovered: 1`); a passing ai failure is retried once and then done; nothing is queued twice; the bucket key is `cutouts/<product>/<sha256 of the photo URL>.png` |
| 10 sample queries return relevant in-stock items in under 1 s | **speed: pass, 10 of 10. Relevance: 8 of 10 pass the test as written. 9 of 10 put a piece of the right kind first** | `SEARCH_QUALITY=1 npx vitest run src/core/__tests__/search-quality.test.ts` against the library catalogue. Every query takes 49 to 76 ms in all (embed 44 to 71 ms, pgvector 4 to 7 ms). The test asks for the right kind first and the right slot in all of the top three. Failures: `"navy blazer"` gives Navy blazer, Navy suit jacket, then Navy tailored trousers (the 3rd is a bottom); `"brown leather belt"` gives three loafers (the catalogue's one belt is a small crop). The criteria were set before the first run and weren't changed. The first run had 2 more failures, both from the oxford bug fixed in `e4f7e58` |
| Search over HTTP, through the gateway | pass | `npm run dev:api`, `/api/health` `{"db":"up","redis":"up","ai":"up"}`. Text: `{"text":"white leather sneakers","size":"10"}` returns `HTTP 200 in 0.158 s`, three sneakers in size 10 with cut-out URLs. Photo: a shoe photo as base64 returns `HTTP 200 in 0.229 s` (embed 216 ms). `GET` on a cut-out URL returns `200 image/png`, RGBA, alpha 0 to 254. Bad body `400`, GET on search `405`, unknown or traversal cut-out path `404` |
| Models load once and are never fetched at run time | pass | the image with `--network none`: `/health` lists `BiRefNet e2bf8e4` and `Marqo-FashionSigLIP c56244c`, `load ms 17119` |
| Cut-out timing on CPU (more than 5 s means batch-only) | **more than 5 s: cut-outs are batch-only** | The full BiRefNet at 1024 px, alone: 37 s, 73 s (and 43 s at 768, 31 s at 512). BiRefNet_lite at 1024: 16 s, 22 s, 18 s. In the batch run (lite, 73 photos): median 22.9 s, 90th percentile 60.8 s, slowest 89.8 s. Image vectors in the batch: median 4.5 s, slowest 21.7 s, under contention. A single warm image query took 216 ms. Text vectors: 42 to 71 ms |
| ai service tests | pass | `9 passed` (`requirements-dev.txt` only, in a clean venv, with no warning) |
| Unit tests, typecheck, the live feed | pass | `Test Files 24 passed, 1 skipped`, `Tests 331 passed, 12 skipped` (the search-quality test) with `DATABASE_URL` and `REDIS_URL`; `tsc` 0 errors; `SUITE=14 npm run e2e` after the ontology fix: `11 of 11 runs passed; 110 of 110 checks passed` |

### Found on the way

1. **The ontology filed "Black leather oxfords" as a shirt.** The dress-shoe rule needed the word "shoes", so "oxfords" fell through to the oxford-shirt rule. A store's "Leather Oxfords" would have been misfiled by the live feed and the import alike. Fixed in `e4f7e58`; "Oxford Shirt in White" and "Washed Oxford" are still shirts.
2. **The full ai image doesn't fit a 3.8 GB Docker VM.** It loads (2.4 GB) and is then killed for memory on the first cut-out (`OOMKilled true`, exit 137). Railway needs at least 8 GB for the ai service (`docs/deploy/railway.md`). Locally, on small machines, run the service from a venv with `CUTOUT_MODEL=lite` (`docs/development.md`). That's how this phase's batch ran.
3. **The batch ran with BiRefNet_lite, not the full model,** because the full model takes 40 to 70 s a photo here. Lite is the same code with the small backbone (compared line by line, MIT). The image's default stays `full`. Cut-out quality between the two hasn't been compared yet.
4. **BiRefNet runs with `trust_remote_code`.** Its code at the pinned revision was read first (no network, subprocess or file access; weights only from safetensors). Changing the revision means reading it again.
5. **The Redis client wasn't connected when the job started** (`The client is offline`), because commands fail at once while the client is down (no offline queue). Jobs now wait with `redisReady()`. `/api/health` keeps failing fast, which is the intent.
6. **Tests that searched the whole catalogue broke once local data had vectors.** The catalogue tests now search only their own retailer. Search takes a `retailerId` scope for tests and operators, which isn't part of the HTTP body.
7. **`httpx2` is resolved.** It came in as a dependency of `huggingface_hub`, is published by the author of `httpx` under the pydantic organisation, and is what Starlette's test client asks for. The tests use it now, and the warning is gone.
8. **The explanations unit test timed out once under load** (8.4 s against vitest's 5 s, while the models were running). It passes alone and in the later full run. It's the same kind of timing flake as TRY5.

### Open items

- Search relevance: the two failing queries (finding: the third "navy blazer" result, and the belt). Options: rank within the query's slot when the query names a kind, or compare `full` against `lite` cut-outs on the same photos.
- Benchmark cut-outs on Railway's CPU once staging exists, and decide whether a GPU is needed for production volumes.
- Image queries took 4.5 s median inside the batch, under contention, and 216 ms alone. Measure on Railway.
- Run the batch on a schedule on staging (a Railway cron service running `npm run catalogue:process`).

## Phase 5: sign-in, consent, the app on staging

Run on 2026-11-05 on local branch `dev` (not pushed). Staging doesn't exist yet (no spend approval confirmed), so the staging checks couldn't run.

### What was done

| Commit | What it adds |
|---|---|
| `e7df51b`, `9a54b8d` | `server/auth/`:<br>• `provider.mjs`: the AuthProvider contract (`start` / `finish`), picked by `AUTH_PROVIDER`<br>• `magic-link.mjs`: the default. A one-use link valid for 15 minutes, with only its sha256 stored; 5 links an hour per address and 30 per network address, through Redis, refusing if Redis can't be checked; the same answer whether or not an account exists<br>• `mailer.mjs`: Resend with `RESEND_API_KEY` and `MAIL_FROM`; otherwise a local outbox, and none in production<br>• `sessions.mjs`: a 30-day session in an httpOnly, SameSite=Lax cookie (Secure on https), stored as a hash<br>• `account.mjs`: the claim and the account's looks<br>• `routes.mjs`: `/api/auth/start, verify, me, sign-out`, `/api/account/claim`, `/api/looks`; POST and DELETE only from `APP_ORIGIN` or `CORS_ORIGINS`<br>Migration `…500_sign-in-and-sessions.sql` (`sign_in_links`, `sessions`, `account_claims`). `src/shared/consents.mjs` holds the account consents (`terms`, `privacy`, draft versions). 13 tests over HTTP |
| `7615efa` | The page, behind `VITE_AUTH=magic-link` (default `preview`, unchanged):<br>• the sign-in step is email only, with an explicit consent checkbox, then "Check your email."<br>• `/auth/verify` POSTs the token, takes it out of the address bar and returns to where sign-in began<br>• sign-in claims the guest's looks, and every load merges the account's looks from other devices<br>• saving a look also keeps it with the account; sign-out ends the server session<br>• Your data says looks are kept with the account<br>Also `e2e/signin-magic-link.mjs` |
| `0803f05` | The Dockerfile declares the page's `VITE_*` build arguments, so a Railway variable reaches `npm run build`. `.dockerignore` keeps the ai weights (1.2 GB) out of the gateway image. `.github/workflows/e2e-staging.yml` runs the scenarios against a staging address by hand (`workflow_dispatch`, `BASE_URL`). Steps in `docs/deploy/railway.md` ("Sign-in on staging") |

### Checks

| Check | Result | Evidence |
|---|---|---|
| A guest saves a look, signs up, and still sees it | pass | `VITE_AUTH=magic-link npm run build`, then `node e2e/signin-magic-link.mjs` against Postgres and Redis: `15 of 15 checks passed`. Among them: "the guest's saved look is on Looks"; "after signing up, the guest's look is still there"; "the page is signed in as the server's account (user_8237…)"; "the look is kept with the account on the server (1)"; "on a second device, the same account sees the look"; "the server holds the look once (1)"; "each device's guest data was handed over once (2 claims)"; "sign-up recorded the consents (privacy privacy-draft-2026-11, terms terms-draft-2026-11)"; "the session cookie is httpOnly and SameSite=Lax"; "the page's script can't read the session"; "a used link is refused with a way to ask for a new one" |
| Consents record type, version, granted_at, withdrawn_at; sign-up records the required ones | pass | `auth.test.ts`: a sign-in without consents gets `consent_missing`. After sign-up, `consents` has `privacy privacy-draft-2026-11` and `terms terms-draft-2026-11` with `granted_at` set and `withdrawn_at` null. A second sign-in adds no duplicates (`count = 2`) |
| The hand-over happens exactly once, with no duplicates | pass | `auth.test.ts`: the first claim gives `{ moved: 2, duplicates: 1, rejected: 1, already: false }`, the second `{ moved: 0, …, already: true }`. A second guest's claim on the same account gives `{ moved: 1, duplicates: 1 }`. A guest id the account didn't sign in from gets `403` |
| Sign-in security | pass | `auth.test.ts`: from another origin or none, `403`; the 6th link in an hour, `429`; a reused or expired link, `link_expired`; no session or a forged cookie, `401`; only `token_hash` is stored, never the token |
| e2e passes against staging | **not run** | there's no staging yet. The workflow is in place (`e2e-staging.yml`) |
| The default (preview) build still passes the scenarios | pass | `npm run build && npm run e2e`: `242 of 247 runs passed`. The 5 failures were 4 network drops while loading outside resources (`ERR_INTERNET_DISCONNECTED`, `ERR_NETWORK_CHANGED`, a QUIC write error, `ERR_CONNECTION_CLOSED`) and the TRY5 flake. Rerun alone (`ONLY=FACE2,P3-6b,P3-6c,P3-7c,TRY5`): `12 of 12 runs passed; 340 of 340 checks passed` |
| Unit tests, typecheck | pass | `Test Files 25 passed, 1 skipped`, `Tests 344 passed, 12 skipped`; `tsc` 0 errors |

### Found on the way

1. **A reload during sign-in lost the account's looks from other devices.** The merge ran once, in the background, just after sign-in, so a reload cancelled it. The browser check caught this on the second device. Every page load with a real account now merges the account's looks.
2. **Staging can't use the real sign-in until mail is set up.** A production server with no `RESEND_API_KEY` answers 503 for sign-in rather than pretending to send. So staging keeps `VITE_AUTH` unset (the preview) until Resend has a verified domain.
3. **Suite 7 (accounts) tests the sign-in preview.** It passes against a preview build only. The real sign-in has its own check, `e2e/signin-magic-link.mjs`, which needs a server whose log it can read, so it runs locally, not against staging.
4. **The gateway image would have copied the ai weights.** `COPY . .` would have taken `services/ai/.models` (1.2 GB). It's in `.dockerignore` now.
5. **The consent wording isn't legally approved.** The checkbox reads "I agree to the Praxis terms and privacy notice." There are no terms or privacy pages to link yet. The versions are named `-draft-` so that approved text gets a new version, and accounts are asked again.

### Open items

- Staging: everything in `docs/deploy/railway.md`, then the e2e workflow against it.
- Resend: a verified sending domain, `RESEND_API_KEY`, `MAIL_FROM`.
- Legal: approved terms and privacy text with pages to link, then new consent versions.
- The page doesn't yet withdraw account consents, and removing a look doesn't remove it from the account (it comes back on the next load).
- Wardrobe and feedback stay on the device; only saved looks move to the account so far.

## Week 1 at the end

On local `dev` (not pushed), on top of `main` at `b4421f0`:
- **Tests:** unit tests went from 280 to 344, and the browser scenarios pass as before.
- **Database:** Postgres 16 with pgvector, 11 tables in 6 migrations.
- **Gateway:** Redis, a private bucket, and health with per-dependency status.
- **Catalogue:** Shopify and CSV connectors and an idempotent import.
- **ai service:** BiRefNet cut-outs and Marqo-FashionSigLIP vectors, with pinned, baked-in weights.
- **Batch and search:** a resumable batch job, and search by words or a photo in under 0.25 s.
- **Accounts:** sign-in by emailed link, with consents and the guest hand-over.
- **Delivery:** CI that opens the release PR, automerge, and Railway, Vercel and staging-e2e config.

What's still needed from people: pushing `dev` and the GitHub settings (`docs/deploy/ci.md`), Railway staging (`docs/deploy/railway.md`, after the spend approval), Vercel (`docs/deploy/vercel.md`), Resend, the legal text, and the first real retailer.
