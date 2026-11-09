# Vercel: the dev preview

Vercel builds the page from `dev` only, in mock mode, as a static site. There's no gateway on Vercel and no serverless functions (the repository has no `api/` folder, and `vercel.json` declares none). The build stays host-agnostic: it is the plain `vite build` into `dist/` that Railway uses too.

## What `vercel.json` sets

| Setting | Value |
|---|---|
| Install | `npm ci` |
| Build | `npm run build` with `VITE_BACKEND=none` (no `/api` calls at all), `VITE_RECOMMENDATION_ADAPTER=mock`, `VITE_AI_PROVIDERS=` (none), `VITE_TRYON_ADAPTER=mock`, `VITE_ALLOW_BILLABLE_IMAGES=false`, set in the command itself so a dashboard variable can't switch a provider on |
| Output | `dist` |
| Rewrites | every path except `/api/...` goes to `index.html` (the app's own routes). `/api/...` gets Vercel's 404, which the page reads as "no backend" |
| Headers | `index.html` no-cache, `/assets/*` immutable for a year (as `server/index.mjs` does) |
| Git | `main` never deploys (`git.deploymentEnabled.main: false`) |

## Dashboard steps (the Praxis Vercel owner)

1. Add New > Project > import `PraxisSltns/praxis-redesign`. Framework preset: Vite (the file overrides the commands anyway).
2. Settings > Git > **Production Branch: `dev`**.
3. Settings > Environment Variables: none are needed. Never add a key. Every `VITE_` value is public.
   - Optional, later: `VITE_API_BASE_URL=https://<staging gateway>` to point the preview at staging. The gateway then needs the Vercel address in `CORS_ORIGINS`. Leave it unset for mock mode.
4. Settings > Functions: nothing to set. If a function ever shows up in a deploy's summary, something added an `api/` folder; remove it.

## What the preview does with no gateway

- `VITE_BACKEND=none` (`HAS_BACKEND` in `src/core/config.ts`) means the page makes no `/api` request at all, so the browser logs no failed request.
- Every look comes from the built-in rules engine (`src/core/adapters/mock.ts`).
- `liveServices()` answers "nothing is live" without asking, so no AI call is made (`src/core/ai/words.ts`).
- Errors aren't reported (`watchErrors` in `src/core/monitoring.ts` doesn't start).
- If something does call `/api`, it gets Vercel's 404, which every caller already treats as "no backend".
- Setting `VITE_API_BASE_URL` brings the server back even with `VITE_BACKEND=none` in the build command.
- Try-on uses the mock (`VITE_TRYON_ADAPTER=mock`) and says no picture was made, as it does on Railway today.

Check it locally with the same build and no server:

```bash
VITE_BACKEND=none VITE_AI_PROVIDERS= npm run build
npx vite preview --port 4174 &
node tools/preview-check.mjs http://localhost:4174   # main journeys, phone and desktop: no /api call, no error
```

Results are in `docs/reports/week-1.md`, Phase 1.
