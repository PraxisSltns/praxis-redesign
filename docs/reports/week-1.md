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
