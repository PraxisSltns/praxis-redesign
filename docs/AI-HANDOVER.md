# AI integration handover (Phase 4)

How each AI capability plugs into Praxis. **Only free pieces are switched on**, and nothing paid is called:

- **Colour reading on the device** (since 2026-10-12): a face photo's undertone and contrast, and a wardrobe photo's main colour, are read in the customer's browser (`src/core/adapters/onDevice.ts`, `src/core/colour.ts`). The photo is never sent. See 4 and 6.
- **The stylist's words from Gemini's free tier**, once `GEMINI_API_KEY` is set on the server (off until then). Text only, never a photo. See 1.

Everything else runs on a free, deterministic mock. `/api/health` reports `providersSet: []` (no provider is named) and `freeOn` (free providers switched on by their key); `GET /api/ai` lists what the server answers now. The quality of real recommendations, generated images, garment recognition and try-on has **not** been validated. That can only happen after a provider is connected and tested.

## What every integration shares

- **Envelope:** `ServiceRequest` / `ServiceResponse` in `src/core/ai/envelope.ts`. A request carries a request id, service, contract version `ai-2026-10-12`, anonymous id, user id, attempt and payload. A response carries a status, result, error `{code, message, retryable}`, provider `{id, version, mode, processing, billable}`, attempts and duration.
- **Runner:** `callService` runs every call in the same order:
  1. checks the payload
  2. applies the billable guard
  3. enforces the time limit and honours cancel
  4. retries once
  5. checks the result

  It never throws into a screen.
- **Contracts and mocks:** the contract for each service is in `DEFINITIONS`, and its mock is in `MOCKS`, both in `src/core/ai/services.ts`. Every mock runs all eight scenarios: success, delayed, partial, empty, validation error, failure, timeout and retry success.
- **Page to server:** `src/core/ai/http.ts` sends `POST /api/ai/<service>`. On the server, `server/ai.mjs` checks the envelope and loads `server/providers/<name>.mjs`. Provider keys live only in the server's environment. The page never holds one.
- **Expected errors:** these error codes apply to every service.

  | Code | When |
  | --- | --- |
  | `validation_error` | The payload was refused before sending. The screen says what to fix. |
  | `invalid_response` | The provider's answer broke the contract. The screen shows a clean failure with Try again. |
  | `provider_error` | Retryable once, then a failure state. |
  | `timeout` | The per-service limit was reached. The screen shows its delay line, then a failure with Try again. |
  | `cancelled` | The customer cancelled. |
  | `billing_blocked` | A paid provider is set but paid calls are off. Status is `disabled` and nothing is charged. |
  | `not_connected` | No provider is set. Status is `disabled`. |
  | `consent_missing` | A photo without current consent. Refused before sending. |

- **Free providers:** a provider in `FREE_DEFAULTS` (`server/ai.mjs`) switches itself on when its key is set, with no other switch; `AI_PROVIDER_<SERVICE>=off` turns it off. Today that is only `gemini-free` for `styling_explanation`.
- **Switches:** for any other provider, three switches turn it on, and all three are off today. With any one of them off, the service answers `disabled`.
  - Server, which provider: `AI_PROVIDER_<SERVICE>=<name>`
  - Server, paid calls: `ALLOW_BILLABLE_AI=true`
  - Page build: `VITE_AI_PROVIDERS=<service,...>`, plus `VITE_ALLOW_BILLABLE_IMAGES=true` for image services
- **Shared tests:**
  - `src/core/__tests__/ai-services.test.ts` covers all nine contracts, the scenarios and the billable guard.
  - `phase2-integrity.test.ts` checks that every answer reaches the request.
  - e2e suite 12 (`e2e/suites/12-contracts.mjs`) covers the server plug-in points, that no key is in the page, and that a session makes no AI calls.

## 1. Gemini styling and reasoning

**Services:** `styling_recommendation`, plus `styling_explanation`.

**Provider interface:**
- `RecommendationAdapter` (`src/core/service.ts`), reached through `serviceRecommendationAdapter` in `src/core/ai/bridge.ts`.
- On the server, a module `server/providers/<name>.mjs` exporting `id`, `version`, `billable` and `run(request, { signal })`.

**Request schema:**
- `StylingRequest` (`src/core/contracts.ts`): every quiz answer (occasion, venue, time, feel, budget band), the owned piece as `WardrobeItemRef` (id, slot, label, source, colour), the Style DNA summary, the feedback snapshot, location, and the input key.
- Explanation payload: `{ request, outfitId, looks? }`. `looks` names each look's pieces so one call can word all three.

**Response schema:**
- `StylingResponse`: `outfits[]`, each with a title, rationale, factors, garments (`retail` with a `ProductRef`, or `wardrobe`), pricing and image refs. Plus the recommendation id, provider version and error.
- Explanation result: `{ outfitId, summary, factors, source: "model", looks?: [{ outfitId, summary, note }] }`.

**Mock provider:**
- `src/core/adapters/mock.ts`, the rules engine the app uses today.
- `MOCKS.styling_recommendation` and `MOCKS.styling_explanation` in `src/core/ai/services.ts`.

**Free writer (live once its key is set):** `server/providers/gemini-free.mjs` answers `styling_explanation` on Google's free tier (the newest stable Flash Lite the key can use, read from Google's model list because model names are retired; `GEMINI_MODEL` names one instead). The rules engine still chooses the looks; after it answers, `addStylistWords` (`src/core/ai/words.ts`) asks the server once per journey for each look's line and note, and puts them in `explanation.summary` and `rationale`, marked `source: "model"`.
- Sent: the answers, the Style DNA in words, the owned piece's name and colour, and each look's pieces. Never a photo, email, name or id (Google may use free-tier requests).
- Every line is checked against the voice rules on the server and on the page (no dashes, no AI or data talk, "pieces", "Style DNA" in full, no marketing words). A broken line, a refusal, the free limit (429) or 8 s without an answer keeps the rules engine's words.
- Test mode scenarios skip it. The page asks `GET /api/ai` and never calls a writer marked billable.
- To switch on: a free key from https://aistudio.google.com/apikey on a Google Cloud project without billing, set as `GEMINI_API_KEY` in Railway. To switch off: remove it, or `AI_PROVIDER_STYLING_EXPLANATION=off`.

**Configuration for a paid engine that chooses the looks (not built):**
- `AI_PROVIDER_STYLING_RECOMMENDATION=gemini` (and `..._STYLING_EXPLANATION`)
- `ALLOW_BILLABLE_AI=true`
- `VITE_AI_PROVIDERS=styling_recommendation`
- The key goes in the server's environment, read only by the provider module.

**Error handling:**
- Time limit 20 s for styling and 10 s for the explanation, with one retry.
- An answer that breaks the contract becomes `invalid_response`.
- Results shows the failure with Try again and Change my answers, keeping the answers (e2e P2B, P3-9a).

**Frontend components:**
- `src/a/lib/styling.ts` (`useStylingSpec`, `useStylingResponse`), `Build.tsx` (processing states), `Results.tsx`, `LookDetails.tsx`.
- Explanations are read from `outfit.rationale`, `explanation.summary` and `factors`. `stylingService` calls `styling_explanation` once per journey through `addStylistWords`, only when the server lists a free writer.

**Backend changes needed:**
- Write `server/providers/gemini.mjs`: map `StylingRequest` to a prompt, and map Gemini's JSON to `StylingResponse`.
- Products must come from a real catalogue (see 7), never be invented by the model.

**Tests:** `mock.test.ts`, `request.test.ts`, `validate.test.ts`, `phase2-integrity.test.ts`, e2e suites 2, 3 and 9.

**Remaining dependencies:**
- Your approval and a Gemini key.
- A product catalogue for the model to choose from.
- An evaluation set to judge recommendation quality, which has not been validated.

## 2. Outfit image generation

**Service:** `outfit_visualization`.

**Status:** live for composed looks (`?stock=live` tabs) through `server/providers/gemini-image.mjs`, switched on by `GEMINI_API_KEY` inside the approved budget (20 USD). Needs billing on the key's Google Cloud project; until then it answers `billing_required` and the look keeps its reference photograph.

**Request schema:** `{ outfitId, garmentIds[], spec }`, spec version 3 (pieces with source, slot, layer, attributes, store photo or reference id; the model; the render). See docs/CATALOGUE.md.

**Response schema:** `{ outfitId, imageUrl: "/api/visuals/img_<key>.jpg", fidelity: "representative", generated: true, checks[] }`, `metadata: { costUsd, attempts, model, checkModel }`.

**Frontend:** `src/a/lib/outfitPicture.ts` (`useOutfitPicture`) and the print note in `Results.tsx`.

**Guards:** `server/visuals.mjs` (canonical spec, cache, budget, ceilings), `server/visual-check.mjs` (checks). `AI_PROVIDER_OUTFIT_VISUALIZATION=off` stops it.

**Tests:** `outfit-images.test.ts`, `hybrid.test.ts`, suite 14 with `e2e/fixtures/fake-gemini.mjs`.

**Remaining dependencies:**
- Billing on the Google Cloud project of `GEMINI_API_KEY`.
- A Railway volume, so pictures and the spend survive a redeploy.
- The store's permission to use its product photos for generated images, before customers.

## 3. Virtual try-on

**Services:** `virtual_try_on`, plus its own endpoint `POST /api/tryon`.

**Provider interface:** `TryOnAdapter` (`src/core/vision.ts`); the HTTP adapter is `src/core/adapters/tryonHttp.ts`; the server side is `server/tryon.mjs` with `server/providers/*.mjs`. Details are in `docs/TRY-ON.md`.

**Request schema:**
- `{ requestId, outfitId, garmentIds[], person: { image, width, height, consentVersion } }`
- The service-layer version is `TryOnPayload`.

**Response schema:** `GeneratedImage` with status `ready | pending | failed | disabled`, the image URL, and an error code.

**Mock provider:** the mock in `vision.ts` answers after 1.2 s with status `disabled`, and follows the test-mode scenarios. `MOCKS.virtual_try_on` does the same.

**Configuration:**
- `TRYON_PROVIDER=<name>`
- `ALLOW_BILLABLE_IMAGES=true` on the server
- `VITE_TRYON_ADAPTER=http` and `VITE_ALLOW_BILLABLE_IMAGES=true` on the build

**Error handling:**
- Time limit 45 s.
- `invalid_image` says why the photo can't be used and does not retry blindly.
- A timeout offers Send again.
- Decline, Retake and Delete are always available (e2e P3-4a to P3-4f, TRY1 to TRY7).

**Frontend components:** `src/a/screens/moment/TryOn.tsx` (the 14-step flow), `Capture.tsx` (camera or upload), `PhotoConsent.tsx`, `src/core/tryon.ts` (request, reducer).

**Backend changes needed:**
- Write a provider module.
- Decide where the person's photo is processed and how long it is kept. The policy `TRY_ON_SERVER` already words this.
- Get a legal review of the disclosure.

**Tests:** `tryon.test.ts`, e2e suite 4.

**Remaining dependencies:**
- Approval and a provider.
- Legal sign-off.
- A check on real phones with a real camera.
- Try-on quality has not been validated.

## 4. Colour analysis

**Service:** `face_colour_analysis`.

**Provider interface:** `ColourAnalysisAdapter` (`vision.ts`), reached through `serviceColourAdapter`.

**Request schema:** `{ image: ImageRef }`, where `ImageRef` is the ref, width, height, and the consent version `face_colour`.

**Response schema:** `{ undertone: cool | warm | neutral, contrast: high | medium | low, source: "sample" | "model" }`.

**On-device reader (live):** `onDeviceFace` (`src/core/adapters/onDevice.ts`) reads the customer's own photo in the browser. MediaPipe's face landmarker (Apache 2.0) finds the face; it is served from this site (`/mediapipe` wasm, `/models/face_landmarker.task`) and loaded only when a customer asks for their colours. Cheek and forehead skin gives the undertone (CIELAB hue angle: under 47 cool, over 57 warm, between neutral); skin against the darkest of brows, eyes and hair gives the contrast. No face, a dark photo or a strong colour cast answers `unreadable` (`no_face`, `too_dark`, `colour_cast`) with Retake or Skip. Results are estimates marked `model`; the customer corrects them in Style DNA.

**Mock provider:** `mockColourAnalysis` returns a fixed example marked `sample`, so the screen says "Example". It still answers for the sample portrait and in test mode.

**Configuration:**
- `AI_PROVIDER_FACE_COLOUR_ANALYSIS=<name>`
- `ALLOW_BILLABLE_AI=true`
- `VITE_AI_PROVIDERS=face_colour_analysis`

**Error handling:**
- Time limit 15 s.
- An unreadable photo offers Retake or Skip colours (e2e S7, S7b).
- The customer can always correct the result, and the correction is kept apart from the estimate.

**Frontend components:** `src/a/screens/dna/DnaSteps.tsx` (DnaFace), `DnaResult.tsx`, `StyleProfileView.tsx`, `src/core/styleProfile.ts`.

**Backend changes needed:** a provider module, and the processing location and retention for face photos. The policy says the photo stays in the tab today.

**Tests:** `phase2-privacy.test.ts`, `ai-services.test.ts`, e2e suite 5.

**Remaining dependencies:**
- Approval and a provider.
- Legal sign-off for face photos.
- Colour accuracy has not been validated.

## 5. Body and fit analysis

**Service:** `body_fit_analysis`.

**Provider interface:** the service contract only (`DEFINITIONS.body_fit_analysis`). There is no page adapter yet.

**Request schema:** `{ preferredFit?: SLIM | REGULAR | RELAXED, image?: ImageRef }`. A full-length photo is not collected today; policy `body_fit` is `not_collected`.

**Response schema:** `{ recommendedFit, source: "self_reported" | "model", notes[] }`.

**Mock provider:** `MOCKS.body_fit_analysis` returns what the customer said, marked `self_reported`.

**Configuration:**
- `AI_PROVIDER_BODY_FIT_ANALYSIS=<name>`
- `ALLOW_BILLABLE_AI=true`
- `VITE_AI_PROVIDERS=body_fit_analysis`
- Set `IMAGE_POLICIES.body_fit.status` to `collecting` once a photo is asked for.

**Error handling:** time limit 15 s. If no reading is possible, the customer's own answer stands.

**Frontend components:** `DnaSteps.tsx` (DnaFit asks Slim, Regular or Relaxed).

**Backend changes needed:**
- A provider module.
- A photo step in Style DNA with its own consent (the copy is in `images.ts`).
- A bridge adapter, like `serviceColourAdapter`.

**Tests:** `ai-services.test.ts` (fit contract), e2e P3-5a (fit answer saved).

**Remaining dependencies:** approval, a provider, and a product decision on asking for a full-length photo. Accuracy has not been validated.

## 6. Wardrobe recognition

**Service:** `garment_recognition`.

**Provider interface:** `GarmentRecognitionAdapter` (`vision.ts`), reached through `serviceGarmentAdapter`.

**Request schema:** `{ image: ImageRef (consent wardrobe_garment), slotHint? }`.

**Response schema:** `{ slot, category, colour?, source: "customer" | "model" }`.

**On-device reader (live):** `onDeviceGarment` reads the main colour of the customer's own wardrobe photo in the browser (the centre against the border, grouped, named from 23 everyday colours, `src/core/colour.ts`). It fills in the colour only when the customer left it empty. The type stays the customer's choice.

**Mock provider:** `mockGarmentRecognition` reads nothing (test mode). `MOCKS.garment_recognition` returns the slot the customer chose, marked `customer`.

**Configuration:**
- `AI_PROVIDER_GARMENT_RECOGNITION=<name>`
- `ALLOW_BILLABLE_AI=true`
- `VITE_AI_PROVIDERS=garment_recognition`

**Error handling:**
- Time limit 15 s.
- On any failure the customer's own type, name and colour stand, and the piece is still added.

**Frontend components:**
- `src/a/screens/Wardrobe.tsx` (new in Phase 4). It calls `imageServices().recogniseGarment` after a photo is checked, and fills in the type and colour only when the source is `model` and the customer left them empty. The consent wording says the colour is read on the device (`wardrobe-device-2026-10-12`).
- `src/a/screens/moment/You.tsx` (Make it yours).

**Backend changes needed:** a provider module. Decide whether wardrobe photos may be kept beyond the tab; today they are kept by name, type and colour only.

**Tests:** `phase4.test.ts` (wardrobe records), `ai-services.test.ts`, e2e suite 6 (P3-6a to P3-6c, P4-6d to P4-6f).

**Remaining dependencies:** approval and a provider. Recognition accuracy has not been validated.

## 7. Retailer product matching

**Services:** `product_matching`, plus `inventory_pricing` for stock and price.

**Provider interface:** `RetailerAdapter` (`src/core/retail.ts`), reached through `serviceRetailer` for inventory. Matching is called by `addRealPieces` (`src/core/ai/stock.ts`) after validation, when the server lists a free `product_matching` provider.

**Test store (free, for private testing):** `server/providers/shopify-feed.mjs` reads one store's public Shopify product list (`/products.json`) and matches each piece to the store's closest piece of the same kind and colour, in stock first, with its real name, price, sizes in stock and link. It is not an official API: the store's agreement is needed before customers see it.
- `RETAIL_SHOPIFY_STORE=www.taylorstitch.com` switches it on (prices are read as USD, so a US store).
- `RETAIL_SHOPIFY_FOR=test` (default): only a tab opened with `?stock=live` uses it (`?stock=off` stops it). `everyone`: every visitor.
- `RETAIL_SHOPIFY_NAME` overrides the store name shown on pieces.
- The list is read whole on the server and kept for 30 minutes; nothing about the customer reaches the store. Results then say the pieces are real and the photos show the look, not these exact pieces.

**Imported catalogue (free, Week 2):** `server/providers/catalogue.mjs` matches each part of a look to the pieces imported into Postgres (`npm run retailers:import`, then `npm run catalogue:process` for cut-outs and vectors).
- Each part's words are embedded by the ai service, and pgvector returns the nearest live, in-stock pieces in its slot. Then the same kind rules as the test store apply: same layer, and same kind or a close stand-in.
- Each piece's picture is its cut-out on this server (`/api/cutouts/...`).
- `AI_PROVIDER_PRODUCT_MATCHING=catalogue` switches it on, in place of the test store. It needs `DATABASE_URL` and `AI_SERVICE_URL`.
- `CATALOGUE_MATCHING_FOR=test` (default): only a tab opened with `?stock=live` uses it. `everyone`: every visitor, once the retailers have agreed.

**Request schema:**
- Matching: `{ garments: [{ garmentId, slot, name }], budget, currency, country? }`
- Inventory: `{ products: [{ productId, retailerId }] }`

**Response schema:**
- Matching: `{ matches: [{ garmentId, products: ProductRef[] }] }`
- Inventory: `{ items: InventoryItem[] }`, each with price status, availability, sizes, `checkedAt`, and freshness `live | cached | example`.

**Mock provider:**
- `createMockRetailer` (`retail.ts`): example prices, unknown stock, the sold-out scenario.
- `MOCKS.product_matching` and `MOCKS.inventory_pricing`.

**Configuration:**
- `AI_PROVIDER_PRODUCT_MATCHING=<name>` and `AI_PROVIDER_INVENTORY_PRICING=<name>`
- `VITE_AI_PROVIDERS=product_matching,inventory_pricing`
- Retailer feed keys go in the server's environment.

**Error handling:**
- Time limits 10 s and 8 s.
- A failed check leaves the pieces as they were.
- A price only replaces another when it says how sure it is.
- A link must be https.
- No purchase is ever made in the app (e2e suite 8).

**Frontend components:** `PiecesSheet.tsx` (Check out), `PieceRow.tsx`, `src/a/lib/selection.ts`, `LookDetails.tsx`.

**Backend changes needed:**
- Retailer feed provider modules.
- Affiliate or checkout routes.
- Server storage for prices if caching is wanted.

**Tests:** `phase2-service.test.ts`, `ai-services.test.ts`, e2e suite 8, S10.

**Remaining dependencies:**
- Retailer agreements and feeds.
- Approval.
- A real payment or affiliate route.
