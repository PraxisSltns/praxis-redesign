# Remaining integration dependencies (deliverable H)

This is the list of work that cannot be finished inside this repository alone. Each item names what exists in the code today, what the outside service or decision has to supply, the switches that control it, what the screens already do about it, the tests to add, and what must not be switched on or shipped to customers before it is done.

Everything here was read from the code. Praxis today is a static Vite build served by `serve` (`package.json` script `start`, `Dockerfile`). There is no Praxis server, no database, no API endpoint, no identity provider and no payment provider in this repository. Where this document says "server", it means one that has to be built.

Related documents: `docs/architecture.md` (diagram and "Where real integrations plug in"), `docs/api-contracts.md` (shapes and validation rules, with the production adapter checklist in section 10), `docs/data-schemas.md` (every browser store).

## Summary

| Dependency | Plugs into | Switch today | State today |
|---|---|---|---|
| Production Gemini recommendation engine | `RecommendationAdapter` (`src/core/service.ts:15`) | `VITE_RECOMMENDATION_ADAPTER` (`src/core/config.ts:21`) | Only `mock` exists; any other value logs a warning and uses the mock (`src/core/service.ts:153`) |
| Image generation (styled visualizations) | `OutfitVisualizationAdapter` (`src/core/vision.ts:76`) | `VITE_ALLOW_BILLABLE_IMAGES` (`src/core/config.ts:27`) | Mock returns `status: "disabled"`; no screen calls it |
| Colour analysis and garment recognition | `ColourAnalysisAdapter` (`src/core/vision.ts:70`), `GarmentRecognitionAdapter` (`src/core/vision.ts:73`) | `VITE_ALLOW_BILLABLE_IMAGES` | Colour mock returns a fixed sample; garment mock reads nothing |
| Virtual try-on | `TryOnAdapter` (`src/core/vision.ts:79`) | `VITE_ALLOW_BILLABLE_IMAGES` plus `IMAGE_POLICIES.try_on.status` (`src/core/images.ts:103`) | Not collected; the try-on page shows the look on a model |
| Live retailer integrations | `RetailerAdapter` (`src/core/retail.ts:24`) | None (wired in code at `src/core/service.ts:155`) | Mock retailer: sizes listed, stock unknown, nothing can be bought |
| Production payment and sign-in (Clerk, Stripe) | `useUser` (`src/a/lib/user.ts:60`), `SignInStep` and `usePremiumPayment` (`src/a/ui/GateSteps.tsx:109`, `:254`) | None | Visual previews; a timer stands in for each call |
| Legal approval of privacy disclosures | `IMAGE_POLICIES` (`src/core/images.ts:45`) and `disclosure()` (`src/core/images.ts:109`) | `consentVersion` per photo kind | Wording written, not approved |
| Server-side persistence and accounts | `RequestHistory` (`src/core/service.ts:110`), `FeedbackStore` (`src/core/feedback.ts:36`), `useLabStore` (`src/shared/store.ts:95`), `AnalyticsSink` (`src/core/analytics.ts:116`) | None | Everything lives in this browser's `localStorage` and `sessionStorage` |

Phase 2 added one service layer for all nine AI services, with contracts, mocks and a server plug-in point: see `docs/AI-SERVICES.md`. The sections below still describe what each integration must supply.

## Configuration that exists today

| Name | Where read | Values | Effect |
|---|---|---|---|
| `VITE_RECOMMENDATION_ADAPTER` | `src/core/config.ts:21` | `mock` (default). No other value is implemented. | `stylingService()` (`src/core/service.ts:151`) always builds the mock today. |
| `VITE_ALLOW_BILLABLE_IMAGES` | `src/core/config.ts:27` | `true` or anything else (off) | `guardBillable` (`src/core/vision.ts:157`) refuses any adapter with `billable: true` while off. No billable adapter exists yet. |
| `__APP_VERSION__` | `vite.config.ts` (`define`), `src/core/config.ts:9` | `package.json` version | Stamped on every analytics event. |
| `PREMIUM` | `src/core/config.ts:30` | Constant: `Premium`, 9, `USD`, `month` | The name and price shown in the gate. Not an environment value. |
| `VITE_API_BASE_URL` | `src/core/config.ts` (`apiUrl`) | an address such as `http://localhost:3000`; empty (default) | Every `/api` call and `/api` picture goes to that server instead of the page's own origin. Only for builds served away from the server (Vite dev, a preview host). An address only, never a key. |
| `VITE_BACKEND` | `src/core/config.ts` (`HAS_BACKEND`) | `none`, or unset (default) | `none` with no `VITE_API_BASE_URL`: a static preview with no server. The page makes no `/api` call (no live-services check, no error reports) and uses the mocks. Set in `vercel.json`. |
| `DATABASE_URL`, `DB_*` | `server/db.mjs` (server environment) | a Postgres address; pool size and timeouts | The gateway's Postgres pool. Unset: no database, and `/api/health` reports `db: "off"`. |
| `REDIS_URL`, `REDIS_CONNECT_TIMEOUT_MS` | `server/redis.mjs` (server environment) | a Redis address | The gateway's Redis client. Unset: `redis: "off"`. |
| `CORS_ORIGINS` | `server/cors.mjs` (server environment) | comma list of exact origins, such as `http://localhost:5173`; empty (default) | The origins allowed to call `/api` from another site, with credentials. Unset: same origin only. |
| `VITE_AI_PROVIDERS` | `src/core/config.ts` | comma list of service names; empty (default) | A listed service answers through `src/core/ai` and this app's server (`POST /api/ai/<service>`); see `docs/AI-SERVICES.md`. |
| `AI_PROVIDER_<SERVICE>`, `ALLOW_BILLABLE_AI` | `server/ai.mjs` (server environment) | provider module name or `off`; `true` | Which provider module answers a service, and whether a paid one may run. Unset: every service answers `disabled`, except a free provider whose key is set. |
| `RETAIL_SHOPIFY_STORE`, `RETAIL_SHOPIFY_FOR`, `RETAIL_SHOPIFY_NAME` | `server/providers/shopify-feed.mjs` (server environment) | a US Shopify store's address; `test` (default) or `everyone`; a display name | Real pieces from one store for testing (`product_matching`). With `test`, only a tab opened with `?stock=live` uses it. |
| `VISUALIZATION_DAILY_CAP` | `server/visuals.mjs` (server environment) | a whole number, default 20 | New outfit pictures one visitor may ask for per day; cache hits don't count. See docs/CATALOGUE.md |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | `server/providers/gemini-free.mjs` (server environment) | a free AI Studio key; model name (unset: the newest stable Flash Lite the key can use, read from Google's model list) | Switches on the free writer for `styling_explanation`. Use a key from a project without billing. |
| Test mode | `src/core/sim.ts:9`, set from `/internal/analytics` | `fast`, `slow`, `timeout`, `failure`, `partial`, `empty`, `invalid_image`, `unavailable_products`, `validation_error`, `retry_success` | Per tab (`praxis_sim` in `sessionStorage`). Wraps whatever adapter is configured (`withSimulation`, `src/core/service.ts:81`). |

Two facts that apply to every integration below:

- `VITE_*` values are compiled into the JavaScript the browser downloads. They are public. No API key, secret key or service credential may ever be put in one. Every paid or private service therefore needs a server that holds the secret, and that server does not exist yet.
- The `Dockerfile` runs `npm run build` and declares no build `ARG`s. Any `VITE_*` value must be present in the build step of the deployment, not only at runtime, or the build falls back to the defaults above.

---

## 1. Production Gemini recommendation engine

### What exists today

- The interface the engine must meet:

  ```ts
  // src/core/service.ts:15
  export interface RecommendationAdapter {
    readonly id: string;
    readonly version: string;
    recommend(request: StylingRequest, options: { signal?: AbortSignal }): Promise<unknown>;
  }
  ```

- The request it receives: `StylingRequest` (`src/core/contracts.ts:54`), built by `buildStylingRequest` (`src/core/request.ts`) from the URL answers, the owned piece, the Style DNA summary (`StyleProfileSummary`, `src/core/contracts.ts:43`) and the feedback summary (`PreferenceSnapshot`, `src/core/contracts.ts:35`, filled by `requestFor` in `src/a/lib/styling.ts:43`). The `location` field exists in the contract but nothing fills it.
- The answer it must give: `StylingResponse` (`src/core/contracts.ts:209`). The adapter may return anything; `validateStylingResponse` (`src/core/validate.ts:193`) checks it, drops malformed looks, recomputes totals and turns nonsense into a `failed` response.
- The service (`createStylingService`, `src/core/service.ts:38`) adds the time limit (`TIMEOUT_MS = 20000`, `src/core/processing.ts:37`), cancel, product matching and the request history.
- The only adapter: `createMockAdapter` (`src/core/adapters/mock.ts:288`), fixed rules over the fifteen outfits in `src/lib/outfitLibrary.ts`, `mode: "demonstration"`, `explanation.source: "mock_rules"`.

### What the integration must supply

1. A server endpoint, holding the Gemini credentials, that accepts a `StylingRequest` and returns a `StylingResponse`. No transport is defined in the code today; choosing it is part of this work (see `docs/api-contracts.md` section 10, item 9).
2. A browser-side adapter in `src/core/adapters/` that calls that endpoint, passes the abort signal through, and returns the raw JSON.
3. A product catalogue the engine picks from, so that each `RetailGarment.product` (`ProductRef`, `src/core/contracts.ts:104`) names a real product. Today the only catalogue is `src/lib/outfitLibrary.ts`.
4. Looks that meet the validator: `requestId` and `inputKey` echoed exactly, three outfits for a complete answer (`EXPECTED_OUTFITS`, `src/core/validate.ts:25`; fewer is `partial`) with distinct ids, USD prices with an honest `priceStatus`, `https` purchase links only (`src/core/validate.ts:114`).
5. Explanations built from the factors the engine actually used, with `explanation.source: "model"`.
6. `mode: "personalized"` only when the looks were built for this customer. The validator already refuses that mode from the mock (`src/core/validate.ts:235`).
7. A picture for each look in `visualization` (`src/core/contracts.ts:152`). If the engine has no picture, it depends on item 2 below (image generation) or on retailer product photos.

### Config and wiring

- Add a branch in `stylingService()` (`src/core/service.ts:151`) that builds the new adapter when `VITE_RECOMMENDATION_ADAPTER` names it. Keep `withSimulation` around it so test mode still works.
- The endpoint address, if it differs per environment, needs a new `VITE_*` value in `src/core/config.ts`. It must be an address only, never a key.
- Check whether 20 seconds (`src/core/processing.ts:37`) and 3 attempts (`MAX_ATTEMPTS`, `src/core/processing.ts:33`) suit the engine's real latency.

### What the UI already handles

- Every processing state: delayed after 5 s (`SLOW_AFTER_MS`, `src/core/processing.ts:35`), timeout, failed with Try again, retry exhausted, partial, empty and cancel (`src/a/screens/moment/Build.tsx`, `useStylingRun` in `src/a/lib/styling.ts`).
- The caption switches on `response.mode` (`captionFor`, `src/a/screens/moment/Results.tsx:40`): "Chosen for your ... plans, preferred style and budget." for `personalized`, the example wording otherwise.
- `explanation.summary` (`src/a/ui/LookDetails.tsx:42`) and "Why this look" with `contributingFactors` (`src/a/ui/LookWhy.tsx`) are drawn from whatever adapter answered.
- More like this and Not for me are recorded with the adapter id and version (`OutfitFeedback`, `src/core/contracts.ts:230`) and sent back on the next request as `preferences`.

### Tests to add

- A contract test that runs recorded engine responses (completed, partial, empty, failed, malformed) through `validateStylingResponse`, in the style of `src/core/__tests__/validate.test.ts`.
- An adapter test with a fake transport: abort is honoured, a non-200 or a network error becomes `adapter_error`, a slow answer becomes `timeout` (pattern: "gives up on a silent service" in `src/core/__tests__/phase2-service.test.ts:72`).
- A test that `stylingService()` builds the new adapter for its `VITE_RECOMMENDATION_ADAPTER` value and still falls back to the mock for an unknown one.
- A test that a `personalized` answer from the new adapter keeps that mode, and that `explanation.source: "model"` passes through.
- End to end: re-run `e2e/scenarios.mjs` scenarios S1, S2 and S3 against the engine (different inputs give different requests and looks; feedback is stored against the right `recommendationId`).

### Must not go live before this is done

- No customer-facing copy may say looks are personal, chosen for you or "AI" styled while `mode` is `demonstration`.
- No Gemini key in a `VITE_*` value or anywhere in `src/`.
- The adapter must not be enabled without the validator in front of it (do not bypass `createStylingService`).

---

## 2. Image-generation services (styled visualizations, colour analysis, garment recognition)

### What exists today

- Interfaces in `src/core/vision.ts`: `ColourAnalysisAdapter` (`:70`), `GarmentRecognitionAdapter` (`:73`), `OutfitVisualizationAdapter` (`:76`). Each declares `billable`.
- The record every generated image must carry: `GeneratedImage` (`src/core/vision.ts:47`): id, outfit, source pieces, provider, model version, status, size, `storageRef`, creation time and `retention`.
- The registry `imageServices()` (`src/core/vision.ts:165`) falls back to the mocks and runs `guardBillable` before every call.
- Mocks: `mockColourAnalysis` (`src/core/vision.ts:86`) returns the same `cool` / `high` estimate for every photo, marked `source: "sample"`; `mockGarmentRecognition` reads nothing; `mockVisualization` returns `status: "disabled"`.
- Only colour analysis is called from a screen: `DnaResult.tsx:49` (`imageServices().analyseColour(...)`). `recogniseGarment` and `visualize` have no caller today.
- Look pictures today are fixed photographs in `public/images/*.jpg`, sent by the mock as `visualization.provider: "praxis-library"`, `fidelity: "representative"`.

### What the integration must supply

1. A server that receives the photo, calls the provider with credentials it holds, stores the result and returns a `ColourAnalysis` (`src/core/vision.ts:32`), `GarmentAnalysis` (`:39`) or `GeneratedImage`. Nothing uploads a photo today; `ImageInput.ref` (`src/core/vision.ts:15`) is a data URL held in the tab.
2. Storage for generated images, with a deletion route and a retention period, so that `GeneratedImage.storageRef` and `retention.deleteAfter` mean something.
3. Adapters registered in `imageServices()` with `billable: true`.
4. A way to carry a generated picture into a look. `GeneratedImage` and the response's `Visualization` are separate shapes and no code converts one to the other yet.
5. For colour analysis: estimates marked `source: "model"`, and real `unreadable` problems (`ImageProblem`, `src/core/images.ts:122`).
6. Updated `IMAGE_POLICIES` entries (`src/core/images.ts:45`): `processing: "server"`, `leavesDevice: true`, `retention.where: "server"` with `maxDays`, a new `consentVersion`. See section 6.

### Config

- `VITE_ALLOW_BILLABLE_IMAGES=true` is required for any billable adapter to run. It is off by default and must stay off until the spend is authorised.

### What the UI already handles

- Colour result states `completed`, `unreadable`, `failed`, `disabled`, each with its own words and a way forward (`src/a/screens/dna/DnaResult.tsx:86` to `:115`): Retake the photo or Skip colours for now on `unreadable`; Try again or Carry on without colours on `failed`; Carry on without colours on `disabled`.
- The Style DNA keeps each estimate apart from the customer's confirmation and correction, and a new estimate never overwrites a correction (`src/core/styleProfile.ts`).
- Photo checks before use: type, size, smallest edge and brightness (`checkFile`, `checkQuality`, `src/core/images.ts:125`, `:134`).
- Not handled yet: `toLook` (`src/a/lib/looks.ts:22`) takes only `visualization.url`; a `pending`, `failed` or `unavailable` visualization status is accepted by the validator (`src/core/validate.ts:37`) but no screen shows it differently. `imageFidelity` is mapped (`src/a/lib/looks.ts:28`) but not shown.

### Tests to add

- Billable adapter refused while the switch is off, called once it is on (extend "refuses a billable call while the switch is off" in `src/core/__tests__/phase2-privacy.test.ts:70`).
- A model colour estimate is stored as an estimate (`source: "model"`) and never replaces a correction (pattern: `phase2-privacy.test.ts:107`).
- Consent mismatch: no upload when `consentVersion` differs from the policy (pattern: `phase2-privacy.test.ts:79`).
- Every `GeneratedImage` has `provider`, `modelVersion`, `storageRef` and `retention` filled.
- A UI test that a `pending` or `failed` visualization shows a stated placeholder, never a broken image.

### Must not go live before this is done

- Any upload of a customer photo while the matching policy still says `leavesDevice: false`.
- `VITE_ALLOW_BILLABLE_IMAGES=true` in any deployment without authorisation (deliverable I forbids enabling billable services without it).
- Calling a generated picture "exact" (`fidelity: "exact"`) unless it shows those very garments.
- Real photo processing before legal approval (section 6).

---

## 3. Virtual try-on

The full journey, the request contract, the stand-in service and the plug-in point are built and
documented in docs/TRY-ON.md. Status: mock functional, integration ready.

### What the integration must supply

1. A provider module in `server/providers/<name>.mjs` (shape in `server/providers/README.md`).
2. `TRYON_PROVIDER`, `ALLOW_BILLABLE_IMAGES=true` on the server; `VITE_TRYON_ADAPTER=http`,
   `VITE_ALLOW_BILLABLE_IMAGES=true` in the build. All four are off by default.
3. A server-side entitlement check (section 5) in `server/tryon.mjs` before the provider runs.
4. Product images for each garment that the provider can use; today the pieces have no `imageUrl`.
5. Legal review of the `TRY_ON_SERVER` consent wording in `src/core/images.ts`.

### Tests to add

- Extend "generates no try-on while try-on photos are not collected" (`src/core/__tests__/phase2-privacy.test.ts:89`) with the collecting case: called only with the switch on, the policy collecting and current consent.
- Deleting the try-on photo and withdrawing consent removes it (pattern: `phase2-privacy.test.ts:43`).
- Entitlement: a request without Premium is refused by the server, whatever the browser's `premium` flag says.
- UI: the caption no longer says "On a model" when a real try-on image is shown, and still does when generation fails.

### Must not go live before this is done

- Any copy that says the customer is seeing the look on themselves while the image is the library photograph.
- Collecting a body or person photo before the policy, the deletion route and legal approval are in place.
- Try-on without a server-side entitlement check (the Premium flag in the browser can be edited by anyone).

---

## 4. Live retailer integrations

### What exists today

- `RetailerAdapter` (`src/core/retail.ts:24`) with `lookup(products, { signal })` returning `RetailerProductInfo[]` (`src/core/retail.ts:10`): category, price with `priceStatus`, availability, sizes, stock per size, product URL, `PurchaseRoute`, delivery estimate and freshness.
- `matchProducts` (`src/core/retail.ts:73`) folds the answer into the response after validation. A failed lookup leaves the pieces as they were. A price is taken only when the retailer states its `priceStatus` (`mergeProduct`, `src/core/retail.ts:96`).
- `createMockRetailer` (`src/core/retail.ts:49`): lists sizes, sets `availability: "unknown"`, sets `purchase: { kind: "none", reason: "example_product" }`. It is wired directly at `src/core/service.ts:155`.
- `PurchaseRoute` (`src/core/contracts.ts:98`): `retailer_site`, `affiliate`, `retailer_integration`, `native`, `none`.
- The sample houses and prices in `src/core/adapters/mock.ts:89` are invented.

### What the integration must supply

1. Product feeds (or APIs) per retailer, reached through a server, returning per-size stock, live prices in USD, product URLs and, where agreed, affiliate links.
2. A `RetailerAdapter` that maps those into `RetailerProductInfo`, with `lastUpdatedAt` set.
3. Product ids that match what the recommendation engine sends (section 1, item 3).
4. Only `https` purchase URLs; the validator drops anything else (`src/core/validate.ts:114`).
5. A decision on `retailer_integration` and `native` routes. Both exist in the contract, but the check-out sheet only links out for `retailer_site` and `affiliate` (`linkOf`, `src/a/ui/PiecesSheet.tsx:26`). An in-app order would need its own payment work (section 5 covers only the subscription).
6. Currency: the contract allows only `USD` (`src/core/contracts.ts:21`). Other currencies need a contract version change.

### Config

- None today. A retailer adapter is chosen in code at `src/core/service.ts:155`. A switch, if wanted, would be a new value in `src/core/config.ts`.

### What the UI already handles

- The check-out sheet (`src/a/ui/PiecesSheet.tsx`) asks a size per piece, reads stock per size (`stockFor`, `src/core/retail.ts:115`), says "Stock not confirmed" unless a live feed says in stock, shows delivery only when given, and shows "Buy at {house}" only for a real route. With no route it shows the disabled "Buying isn't open yet" button and the reason.
- Leaving for a retailer is tracked as `retailer_redirected` with the route (`src/core/analytics.ts:62`).
- Sold-out pieces start unticked; test mode `unavailable_products` shows that state.
- `canPurchase` (`src/core/retail.ts:121`) exists but no screen calls it.

### Tests to add

- Recorded feed answers through `matchProducts`: live price replaces example price, missing sizes read as unknown, a feed error leaves pieces untouched (existing patterns in `src/core/__tests__/phase2-service.test.ts:18` to `:58`).
- A stale `lastUpdatedAt` policy, once one is decided (none exists in code today).
- UI: "Buy at" appears only for an `https` route, is disabled until a size is chosen and for a sold-out size; `retailer_redirected` fires once per click. Re-run the check-out scenario in `e2e/scenarios.mjs` that asserts no "Buy at" link for example pieces, with the inverse for live pieces.

### Must not go live before this is done

- Any price shown without the "Prices are examples." note unless its `priceStatus` is `live` or `estimated` from a feed.
- "In stock" or a delivery promise not supplied by the retailer.
- Affiliate links without the disclosure that the retailer agreement and legal require (no such disclosure text exists in the code today).

---

## 5. Production payment configuration and sign-in (Clerk and Stripe, planned)

### What exists today

- The gate (`src/a/ui/Gate.tsx`) shows, as needed: an introduction, sign in, then Premium. Which steps show is decided by `stepsFor` (`src/a/lib/user.ts:51`) from the stored user.
- Sign in (`SignInStep`, `src/a/ui/GateSteps.tsx:109`): Apple, Google and email buttons. Each waits 900 ms (`SIGNIN_MS`, `GateSteps.tsx:11`) and then calls `signIn`. No identity provider is called. Apple and Google return no email, so `useUser().signIn` falls back to the stored address or `bob@praxis.app`, and the name is always "Bob" (`src/a/lib/user.ts:25`, `:65`, `:66`).
- The account id is a random id kept per address in this browser (`userIdFor`, `src/core/identity.ts:66`).
- Premium (`PremiumTop`, `PremiumCard`, `usePremiumPayment`, `GateSteps.tsx:167`, `:203`, `:254`): an Apple Pay button and a card form. Paying waits 1200 ms (`PAY_MS`) and calls `grantPremium` (`src/a/lib/user.ts:77`), which sets `premium: true` in `localStorage` key `praxis_lab_a_user`. The form says "This is a preview. No charge is made." (`GateSteps.tsx:247`).
- The plan is a constant: `PREMIUM` (`src/core/config.ts:30`), one membership, $9 a month. README marks the shape and price as placeholders.
- Gated actions: try-on (`src/a/screens/moment/Results.tsx:171`) and starting Style DNA (`src/a/screens/Home.tsx:33`, `src/a/ui/Completion.tsx:69`, `src/a/screens/dna/DnaResult.tsx:202`). Saving and check out need no sign-in.

### What the integration must supply

1. Clerk for identity: sign-in with Apple, Google and email, returning a stable user id and the verified email. That id replaces `userIdFor` and the `LabUser.id` in `src/a/lib/user.ts`.
2. Stripe for the subscription: a Payment Element with Apple Pay enabled, replacing the card fields in `PremiumCard` and the timer in `usePremiumPayment`. Card numbers must never pass through Praxis's own inputs.
3. A server that creates the subscription, receives Stripe's webhooks, stores the entitlement and answers "does this user have Premium". The browser's `premium` flag becomes a cached copy, not the source of truth.
4. A server-side entitlement check before any try-on or Style DNA analysis call runs (README "What is a stand-in").
5. The real plan: name, price, currency, period, trial (if any), cancellation and refund terms, replacing `PREMIUM`.
6. Sign out that ends the provider session as well as clearing `praxis_lab_a_user` (`signOut`, `src/a/lib/user.ts:72`).
7. Publishable keys only in `VITE_*` values. No such values exist in `src/core/config.ts` today; adding them is part of this work. Secret keys stay on the server.

### What the UI already handles

- Step order and skipping steps already satisfied (`stepsFor`), focus trap, Escape, return of focus (`Gate.tsx:69` to `:96`).
- Busy states on each button, a card error message, a success state ("You're in.", `Gate.tsx:167`).
- On sign-in, the guest's saved looks, feedback and wardrobe move to the account (`signIn` in `src/a/lib/journey.tsx:37` to `:55`), with `account_migrated` or `account_migration_failed` recorded.
- Analytics events for every step: `premium_intro_viewed`, `premium_intro_continued`, `paywall_viewed`, `premium_started`, `signin_completed` (`src/core/analytics.ts:80` to `:86`). Their trigger text says "preview"; update it when they become real.
- Not handled yet: a declined or failed payment, 3-D Secure, a cancelled Apple Pay sheet, sign-in errors, an expired or cancelled subscription, and a page to manage or cancel the subscription.

### Tests to add

- `stepsFor` against entitlement from the server, not from `localStorage` (existing behaviour has no test file of its own; add one beside `src/core/__tests__/identity.test.ts`).
- Stripe test mode: success, decline, authentication required, Apple Pay cancelled. Each leaves the gate in a clear state with the customer's place kept.
- Webhook handling on the server: subscription created, renewed, cancelled, payment failed.
- An edited `praxis_lab_a_user` with `premium: true` does not unlock any server call.
- Account migration with real ids: re-run `src/core/__tests__/feedback-account.test.ts` ("account migration") and e2e scenario S5 against Clerk users.

### Must not go live before this is done

- The current card form (`PremiumCard`) collecting real card numbers. It must be replaced, not wired up.
- Any charge before the price, terms, "Cancel any time." wording (`GateSteps.tsx:57`, `:186`) and the cancellation flow are real and approved.
- Treating the browser's `premium` flag as permission for any paid call.
- The `bob@praxis.app` / "Bob" fallback in any build a customer can reach.

---

## 6. Legal approval of privacy disclosures

### What exists today

- One policy per photo kind in `IMAGE_POLICIES` (`src/core/images.ts:45`): face for colour, body for fit, owned piece, try-on. Each holds why, use, processing place, whether it leaves the device, retention, deletion, accepted formats, size and a `consentVersion`.
- The notice the customer reads is built from the policy by `disclosure()` (`src/core/images.ts:109`) and shown by `PhotoConsent` (`src/a/ui/PhotoConsent.tsx:20`), so wording and behaviour cannot drift apart.
- Consent is stored with the wording version and time (`grantConsent`, `src/core/images.ts:170`, called at `PhotoConsent.tsx:37`). Consent to older wording does not count (`consentFor`, `src/core/images.ts:163`).
- Withdrawing consent deletes the photos (`withdrawConsent`, `src/core/images.ts:178`), used by "Delete everything" on `/data` (`src/a/screens/YourData.tsx:48`).
- Retention periods in one table (`RETENTION`, `src/core/data.ts:12`): history, events and selections 90 days, feedback 365 days, the rest until deleted.
- The code itself says the wording must be approved by legal counsel before real personal-image processing goes live (`src/core/images.ts:11`).

### What legal must supply

1. Approved wording for each photo notice, for the version that actually processes photos (sections 2 and 3), not only for today's in-tab version.
2. Approved retention periods for photos, generated images, derived attributes (undertone, contrast), request history, feedback and analytics, once they are kept on a server.
3. The lawful basis and any explicit consent wording for face photos and derived attributes.
4. A privacy notice and terms that the app can link to. No such link or page exists in the code today.
5. Review of other customer-facing statements that carry legal weight: "Cancel any time." and the Premium price (section 5), "This is a preview. No charge is made.", the affiliate disclosure (section 4), and the `utm_*` tagging on shared links (`src/a/lib/share.ts`).

### Config

- Each approved wording change means a new `consentVersion` in `IMAGE_POLICIES`. That alone makes every customer agree again, because `consentFor` rejects older versions.

### What the UI already handles

- The notice before every photo, drawn from the policy.
- `/data` (`src/a/screens/YourData.tsx`): what is kept, delete a photo, delete everything.
- `/internal/analytics` lists the policies and stores with their retention (`src/a/screens/Internal.tsx:127`).

### Tests to add

- A test that each approved wording string is exactly what `disclosure()` returns (a snapshot per category), so an unapproved edit fails the build.
- A test that changing `consentVersion` invalidates stored consent (pattern: `src/core/__tests__/phase2-privacy.test.ts:43`).
- "never says a photo stays on the device unless the policy keeps it there" (`phase2-privacy.test.ts:17`) extended to the server policies.

### Must not go live before this is done

- Any photo leaving the device.
- Any server-side storage of photos or derived attributes.
- Any notice wording not marked approved.

---

## 7. Server-side persistence and accounts

### What exists today

All customer data lives in this browser. `STORES` (`src/core/data.ts:30`) lists every key; `docs/data-schemas.md` gives each shape.

| Data | Where today | Interface a server store can sit behind |
|---|---|---|
| Saved looks and saved Style DNA | `localStorage` `praxis_lab_a` (`useLabStore`, `src/shared/store.ts:95`) | None separate: the hook reads and writes `localStorage` directly (`src/shared/store.ts:69`, `:80`) |
| Styling request history | `praxis_styling_history`, last 20 (`src/core/service.ts:119`) | `RequestHistory` (`src/core/service.ts:110`), passed into `createStylingService` |
| Feedback | `praxis_feedback` (`src/core/feedback.ts:11`) | `FeedbackStore` (`src/core/feedback.ts:36`) |
| Wardrobe (name and type only) | `praxis_wardrobe` (`src/core/data.ts:135` to `:156`) | Plain functions, no interface |
| Chosen look per recommendation | `praxis_selections` (`src/core/data.ts:115`) | Plain functions, no interface |
| Analytics events | `praxis_events`, last 1000 (`localSink`, `src/core/analytics.ts:171`) | `AnalyticsSink` (`src/core/analytics.ts:116`), add with `addSink` (`:175`) |
| Account | `praxis_lab_a_user`, `praxis_lab_a_accounts` (`src/a/lib/user.ts`, `src/core/identity.ts`) | Replaced by Clerk (section 5) |
| Anonymous id | `praxis_anon` (`src/core/identity.ts:9`) | Stays in the browser; sent with requests and events |

- Guest to account: pure functions `migrateLooks` (`src/core/account.ts:36`), `migrateFeedback` (`src/core/account.ts:69`) and `migrateWardrobe` (`src/core/data.ts:156`), run at sign-in (`src/a/lib/journey.tsx:37`). `visibleTo` (`src/core/account.ts:23`) hides another account's looks on a shared browser; they still sit in the same `localStorage`.
- Retention is enforced by pruning when the app starts (`pruneExpired`, `src/core/data.ts:66`). "Delete everything" is `deleteLocalData` (`src/core/data.ts:81`).

### What the integration must supply

1. A database and API for saved looks, Style DNA profiles (with `profileId` and `version`, `src/core/styleProfile.ts`), feedback, wardrobe items, selections and request history, keyed by the Clerk user id and, for guests, the anonymous id.
2. A server-backed `RequestHistory` and `FeedbackStore` that meet the existing interfaces.
3. A store interface in front of `useLabStore` so saved looks and Style DNA can be read from and written to the server. This interface does not exist yet; adding it is part of the work.
4. The guest-to-account merge run on the server with the same rules as `src/core/account.ts` (newest copy kept, another account's data untouched).
5. Server-side retention jobs matching the approved periods (section 6), and a server-side "delete everything" and export for a signed-in customer.
6. An analytics sink for an approved analytics service through `addSink`. The `track()` guard (`src/core/analytics.ts:192`) already refuses emails, data URLs and long strings before any sink sees them.

### Config

- None today. Endpoint addresses would be new `VITE_*` values in `src/core/config.ts`; credentials stay on the server.

### What the UI already handles

- The offer to sign in and sync after a guest saves, shown once (`praxis_sync_offer_dismissed`).
- Save, remove with Undo, and the saved looks rail (`src/a/screens/Looks.tsx`).
- `/data` explains what is kept and deletes it, but today it covers only this browser; its wording says "on this device".
- Not handled yet: loading and error states for reading saved looks or Style DNA over a network, conflicts between two devices, and offline saves.

### Tests to add

- The existing migration tests (`src/core/__tests__/feedback-account.test.ts`) run against the server merge.
- A shared contract test for `RequestHistory` and `FeedbackStore` that both the local and the server implementation must pass.
- Retention: records past their period are removed on the server (pattern: "prunes records older than their retention period", `phase2-privacy.test.ts:155`).
- Delete everything removes server records for the account and nothing for other accounts (pattern: `phase2-privacy.test.ts:180`).
- e2e S4 and S5 (a saved look survives a refresh; signing in moves it) on two browsers with the same account.

### Must not go live before this is done

- Any server storage of photos, derived colour attributes or feedback before the retention and deletion rules are approved (section 6).
- A `/data` page that still says "on this device" while data is also on a server.
- Account data keyed by the stand-in ids from `userIdFor`; they are random per browser and cannot be trusted across devices.

---

## Stand-ins listed in the README ("What is a stand-in")

| Stand-in | Files | Replace with |
|---|---|---|
| Recommendations | `src/core/adapters/mock.ts` | A `RecommendationAdapter` selected by `VITE_RECOMMENDATION_ADAPTER` (section 1) |
| Sign-in and payment | `src/a/ui/Gate.tsx`, `src/a/ui/GateSteps.tsx` | Clerk for identity, a Stripe Payment Element with Apple Pay, and a server-side entitlement check (section 5). Plan shape and price are placeholders. |
| Share | `src/a/ui/ShareSheet.tsx`, `src/a/lib/card.ts`, `src/a/lib/share.ts` | Works today (canvas story card and the device share sheet). Links carry `via` and `utm_*` tags for an analytics tool that is not connected yet. |
| Check out | `src/a/ui/PiecesSheet.tsx`, `src/a/lib/selection.ts`, `src/core/retail.ts` | A `RetailerAdapter` that returns sizes, stock and a `PurchaseRoute` in place of `createMockRetailer`. Nothing is ordered today (section 4). |
| Looks and pieces | `src/core/adapters/mock.ts`, `src/lib/outfitLibrary.ts` | The vendor catalogue behind an adapter. Today: fifteen outfits, invented houses, example prices, stock `unknown`. |
| Try-on | `src/a/screens/moment/TryOn.tsx` | The rendering pipeline behind `TryOnAdapter`, then ask for the photo again (section 3). |
| Colour analysis | `src/core/vision.ts` (`mockColourAnalysis`) | A `ColourAnalysisAdapter`. Today the same sample estimate for every photo, marked `source: "sample"` (section 2). |
| Images | `public/images/*.jpg`, `src/assets/styles/*.jpg` | Catalogue looks and inspiration presets; real product or generated images replace the look photographs. |
