# Praxis redesign: Concept A ("Stage")

The approved front-end direction for Praxis, extracted as a standalone React app so it can be built into the product. Everything in here is UI: journeys, states, motion, copy and tokens. Data, auth, payment and image generation are stand-ins to be replaced.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build to dist/
npm test           # unit tests for src/core (vitest)
npm start          # server/index.mjs: serves dist/ (Railway runs this)
npm run photos:check  # the home occasion photos
```

Node 22 or newer.

The backend's local dependencies (Postgres with pgvector, Redis, S3-compatible storage) run in Docker: `npm run dev:up`. See `docs/development.md`. Branches, CI and deploys: `docs/deploy/`.

## What it is

One full-viewport stage. The left column asks one question at a time; the right column is a living 3:4 print that previews the occasion, darkens for night, ghosts the chosen feel, builds the three looks in place, holds the result, and wipes to the try-on. Nothing routes away from the stage; every step is a URL so Back and reload work.

Journeys:

- **Style a moment**: occasion (chosen on home), venue, day or night, feel, spend, the build (it follows the real request, see Processing states), then the looks first: three looks with the hero in the print and three labelled thumbnails beside it. Move between the looks with the thumbnails, a sideways swipe on the print, the arrows and counter under the print on desktop, or the left and right keys once the print or the thumbnails have focus; it stops at the first and last look. Everything on the page follows the one look in the URL (`hero`): photo, name, note, pieces, prices, total, Check out, Share, Save and Restyle. A tap or click on the print (a small glass marks it; on desktop it reads View details on hover) opens the look large to study: zoom with the + and − controls, the wheel or trackpad, a pinch or a double tap, drag to move around, Reset to go back; only the photo zooms, never the page. At normal size a sideways swipe or the arrows move between the looks and a swipe down closes it, back on the same look. The results offer "Make it yours": see it on me (the try-on preview, on a model for now) or use something I own (one item by slot, then the looks rebuild around it). Then try-on, save, share, check out (every piece ticked by default with a live total, then a sheet by retailer with a size for each piece and what is known about stock and delivery; open to everyone, no sign in). Each look has "Why this look" (the factors it was picked on) and More like this or Not for me (with a reason or a piece).
- **Style DNA**: face (with the photo notice first), fit, lifestyle, up to two inspiration presets, the colour analysis, and a result that marks each part as an estimate, a confirmed answer or the customer's correction, with "Not quite right?" to change any of it or retake the photo (see Style DNA profile). Saving it changes the home so a returning user starts on the occasion chips.
- **Looks**: saved looks as a horizontal rail; open, remove.
- **Style DNA**: the saved Style DNA, change it, retake the photo, start again, your data on this device, sign out, light or dark.
- **Wardrobe** (`/wardrobe`, in the menu and the desktop bar): the pieces the customer owns, by type, name and colour, with an optional photo kept in the tab only. Add, correct, remove (with Undo), and use a piece in the looks; Make it yours on the results offers these pieces first. Each account sees only its own. A photo's main colour is read on the device to fill in the colour (`garment_recognition`, `src/core/adapters/onDevice.ts`); the photo is never sent.
- **Your data on this device** (`/data`): what is kept in this browser, deleting a photo, and deleting everything.

Full concept spec: `docs/CONCEPT-A.md`.

## Routes and state

Mounted at `/`. Step routes:

```
/                                   home (first visit, or returning with DNA)
/moment/venue  /moment/time  /moment/feel  /moment/spend
/moment/you/face  /moment/you/item   (reached from the results; /moment/you redirects there)
/moment/build  /moment/results  /moment/tryon
/looks  /looks/:id
/dna  /dna/face  /dna/fit  /dna/lifestyle  /dna/inspiration  /dna/build  /dna/result
/wardrobe  /data
/internal/analytics                 events and test mode; only in `npm run dev` or a build with VITE_INTERNAL_PAGE=true
```

Answers travel in search params so reload restores any step: `occasion, venue, time, vibe, spend, face, item, hero, done, mode`; DNA: `face, fit, life, taste`. The gate popup uses `?gate=tryon|dna|signin`; saving needs no gate.

Browser storage (prototype only, replace with real persistence):

| Key | Holds |
|---|---|
| `praxis_lab_a` | version 2: saved looks and Style DNA profiles, each with its owner (anonymous id and account id), so each person on a shared device sees only their own (`src/shared/store.ts`). Unreadable data is copied to `praxis_lab_a_unreadable` before it is written over |
| `praxis_lab_a_premium` | which stand-in accounts have Premium; Premium belongs to the account, not the device |
| `praxis_lab_a_user` | `{ id, name, email, premium }` for the sign-in and Premium previews (`src/a/lib/user.ts`) |
| `praxis_lab_a_accounts` | the stand-in account id for each address signed in on this browser (random, `src/core/identity.ts`) |
| `praxis_anon` | the anonymous visitor id with first and last visit (`src/core/identity.ts`) |
| `praxis_styling_history` | the last 20 styling requests with their validated responses (`src/core/service.ts`) |
| `praxis_feedback` | More like this and Not for me, with reason or piece (`src/core/feedback.ts`) |
| `praxis_events` | the last 1000 analytics events (`src/core/analytics.ts`) |
| `praxis_sync_offer_dismissed` | set when a guest closes the offer to sign in and sync |
| `praxis_lab_a_mode` | `light` or `dark`; light is the default |
| `praxis_lab_a_face`, `praxis_lab_a_item` | captured images for the tab only (sessionStorage); never in localStorage, analytics or saved looks |
| `praxis_image_consent` | which photo notices were agreed to, with the wording version and time (`src/core/images.ts`) |
| `praxis_wardrobe` | pieces the customer owns, by name, type and colour, no photo (`src/core/data.ts`) |
| `praxis_wardrobe_photos` | photos of wardrobe pieces for the tab only (sessionStorage), the newest 8 |
| `praxis_selections` | which look was chosen for each recommendation, 90 days (`src/core/data.ts`) |
| `praxis_dna_draft` | the Style DNA being built, before it is saved (sessionStorage, `src/a/lib/dnaDraft.ts`) |
| `praxis_sim` | the test mode scenario for this tab (sessionStorage, `src/core/sim.ts`) |
| `praxis_lab_a_viewer_hint` | set once a look has been opened large, so the zoom and swipe hint shows only the first time |

## What is a stand-in

- **Recommendations** (`src/core/adapters/mock.ts`): a rules adapter, not a stylist. It scores the fifteen library outfits on the feel, the place, the time and the budget, explains each look with the factors it used, and says the looks are examples. Replace it by adding an adapter (see Recommendation architecture) and setting `VITE_RECOMMENDATION_ADAPTER`.
- **Sign-in and payment** (`src/a/ui/Gate.tsx`, `GateSteps.tsx`): visual previews of Apple, Google and email sign-in, and of a "Premium" purchase with Apple Pay or card. No Clerk or Stripe calls. Replace with Clerk for identity and a Stripe Payment Element (Apple Pay enabled) for the purchase, then check the entitlement server-side before try-on and DNA endpoints run. The plan shape (one membership, $9 a month) and the price are placeholders.
- **Share** (`src/a/ui/ShareSheet.tsx`, `src/a/lib/card.ts`, `src/a/lib/share.ts`): from the results. Draws a 1080 x 1920 story card on a canvas (print, PRAXIS, eyebrow, title, the stylist's note, the address) and hands it to the phone's share sheet (Instagram stories, WhatsApp, Messages); on a computer it saves the image. "Ask a friend to choose" shares the results link with a question (WhatsApp on a computer). Every shared link is tagged with `via` (story, friend or link) and `utm_source=praxis`, `utm_medium`, `utm_campaign=shared_look`, so any analytics tool added later can count visits per channel. A visitor arriving on a tagged link sees the shared view of the results: a "Shared with you" note and "Get your own looks" as the main button, with Check out and Share kept. Starting a journey drops the tags. Shares are counted as `look_shared` (see Analytics).
- **Check out** (`src/a/ui/PiecesSheet.tsx`, `src/a/lib/selection.ts`, `src/core/retail.ts`): every piece carries a box, all chosen at first except sold-out ones; the customer unticks what they do not want, the total follows, and the sheet asks a size per piece. Stock reads "Stock not confirmed" unless the retailer confirms it; delivery shows only when the retailer gives it. A "Buy at" button appears only for a piece with a real purchase route (retailer site or affiliate link); the example pieces have none, so the button says "Buying isn't open yet". Nothing is ordered. Replace `createMockRetailer` with a `RetailerAdapter` that returns sizes, stock and a `PurchaseRoute`.
- **Looks and pieces** (`src/core/adapters/mock.ts`): the fifteen catalog outfits in `src/lib/outfitLibrary.ts` with invented houses and example prices inside the chosen budget; every price is marked `example` and every stock level `unknown`, and the screens say so. Replace with the vendor catalog behind an adapter.
- **Try-on** (`src/a/screens/moment/TryOn.tsx`, `src/core/tryon.ts`, `server/tryon.mjs`): the full See it on me journey works (explanation, consent, camera or upload, checks, preview, request, answer, retry), but no engine is connected, so the answer says plainly that no picture was made. A real engine plugs in on the server; see docs/TRY-ON.md.
- **Colour analysis** (`src/core/vision.ts`, `mockColourAnalysis`): returns the same sample estimate for every photo, marked `source: "sample"`, and the screens call it an example while analysis is in preview. Replace with a `ColourAnalysisAdapter`.
- **Store pieces and outfit pictures** (`src/core/catalogue`, `server/providers/shopify-feed.mjs`): in `?stock=live` tabs each look is rebuilt from one real store's public list where a piece truly fits, with Praxis styling references (never for sale) filling the rest; only store pieces count toward Check out. The look on screen is drawn by Gemini on one Praxis model from its pieces' own photos and attributes, checked before it shows, inside the 20 USD budget Tarek approved; until the key's Google project has billing, the look keeps its reference photograph and says so. See docs/CATALOGUE.md.
- **Images**: `public/images/*.jpg` (catalog looks) and `src/assets/styles/*.jpg` (inspiration presets).

## Recommendation architecture

`src/core` holds everything that is not UI and imports no React. The screens never build looks themselves:

1. `request.ts` turns the answers in the URL, the piece the customer owns and their Style DNA id into a `StylingRequest` (`contracts.ts`, version 1.0). Every answer is in it, budgets as numbers. `inputKey` names the inputs; feedback is sent as `preferences` but is not part of the key.
2. `service.ts` hands the request to the configured adapter (`RecommendationAdapter`: `id`, `version`, `recommend(request)`), validates whatever comes back (`validate.ts`) and records both in the request history. An adapter that throws or answers nonsense becomes a `failed` response; a malformed look is dropped and the answer marked `partial`, never padded.
3. `src/a/lib/styling.ts` sends one request per set of inputs and reuses the stored answer on reload or Back. The build, results, try-on and saved looks read the same response, so a look keeps its `recommendationId`, `requestId` and `outfitId` everywhere.
4. `src/a/lib/looks.ts` (`toLook`) maps an `OutfitRecommendation` to what the screens draw. Rank 1 is "My pick".

Garments are `retail` (a `ProductRef` with price, price status and stock), `wardrobe` (a piece the customer owns, never in the total) or `reference` (a Praxis styling reference, never priced, linked or bought). Visualizations say what they are: a product photo, a styled image, or a try-on, and whether they are exact or representative. Only an adapter other than the mock can answer in `personalized` mode.

## Processing states

`src/core/processing.ts` is the one state machine for a styling request: idle, validating, submitted, processing, delayed (after 5 s: "This is taking a little longer than usual."), partial, completed, empty, failed ("I couldn't put your looks together this time." with Try again), retry requested, retry exhausted (after 3 tries, or at once when the failure cannot be retried) and cancelled. A request times out after 20 s. The build (`src/a/screens/moment/Build.tsx`, `useStylingRun` in `src/a/lib/styling.ts`) shows only the state it is in: a moving line while working, never a percentage or a timed stage. Cancel stops it and keeps the answers; an answer arriving after a cancel is ignored.

## Test mode

`/internal/analytics` (in `npm run dev`, or a build made with `VITE_INTERNAL_PAGE=true`; never in the live build) has a Test mode row: fast, slow, timeout, API failure, partial, empty, invalid image and unavailable products (`src/core/sim.ts`). It lasts for the tab only, shows a "Test mode" strip on every screen, and marks every event `testMode` so the measures leave them out. Invalid image applies to the Style DNA colour analysis; unavailable products marks the shoes sold out.

## Photos and privacy

`src/core/images.ts` holds one policy per kind of photo: face for colour, body for fit, a piece the customer owns, and try-on. Each says why it is needed, how it is used, where it is processed, whether it leaves the device, how long it is kept and how to delete it, the formats and size it accepts, and its consent version. The notice before a photo (`src/a/ui/PhotoConsent.tsx`) is drawn from that policy, so it always matches what the app does. Today the face and owned piece photos stay in the tab and are not analysed by a model; body and try-on photos are not collected. Each photo is checked for type, size, dimensions and light before it is used. A photo can be deleted on its own from `/data` or the Style DNA photo step, and "Delete everything" removes the photos and withdraws consent. The notice wording must be approved by legal counsel before real photo processing goes live.

`src/core/vision.ts` has the adapters for colour analysis, garment recognition, outfit visualization and try-on, each with mocks. Every generated image carries its id, outfit, source pieces, provider and version, status, size, storage reference, creation time and retention. Adapters that cost money declare `billable`, and `guardBillable` refuses them unless `VITE_ALLOW_BILLABLE_IMAGES=true`; it is off by default. The one paid service in use, outfit pictures, runs on the server inside the approved budget instead (docs/CATALOGUE.md).

## Style DNA profile

`src/core/styleProfile.ts`: undertone, contrast, fit and week each keep the estimate, the customer's confirmation and their correction separately. The value used is the correction, then the confirmation, then the estimate. A new photo replaces only the estimate, never a correction. The profile has an id and a version; requests send `profileId_vVersion` and a summary of the values with their basis. Old saved Style DNA is migrated and its portrait dropped.

## Retention

`src/core/data.ts` lists every key Praxis keeps (`STORES`) and how long: request history, events and chosen looks 90 days, feedback 365 days, the rest until deleted. Old entries are pruned when the app starts. `/data` shows them in plain words; `/internal/analytics` lists them with their retention.

## Analytics

`src/core/analytics.ts` is a closed dictionary: each event has a category, a trigger and typed properties. `track()` refuses unknown events or properties, missing or mistyped values, and any string over 160 characters or containing `@`, `data:`, `blob:` or `base64`, so no email, photo or face data can be recorded. Each event carries an event id, time, the anonymous id, the account id when signed in, the journey and the app version. Events go to every sink registered with `addSink`; today the only one is local storage, viewable at `/internal/analytics` (download as JSON, or clear). Adding a real analytics tool is one sink.

## Accounts and saved looks

Saving needs no account. A guest's looks belong to the anonymous id; after saving, the guest is offered to sign in and sync, once, and can close it. Signing in moves this browser's guest looks and feedback onto the account (`src/core/account.ts`): a look saved both ways is kept once, and another account's looks are never touched or shown.

## Brand and element rules

Atelier, in a champagne palette by day and warm mocha by night, with the Hairline element system. Every colour, shadow and corner is a token in `src/a/a.css` under `[data-mode="light"]` and `[data-mode="dark"]`; screens never hardcode a hue. One ink, no other hues. The exceptions are deliberate: the Apple Pay button (Apple's rule), the phone bezel in the home demo, the Style DNA banner's fixed text colours (it sits on a photograph), and the canvas share card in `src/a/lib/card.ts`, which mirrors the light palette.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--bg` | Page | `#EFE2CC` | `#2B241D` |
| `--bg-2` | Second band | `#E9D8BD` | `#30281F` |
| `--surface` | Hover and image wells | `#E5D1B4` | `#3B3127` |
| `--raised` | Cards, answer rows, fields, sheets | `#F8EFE1` | `#352C23` |
| `--champagne` | Accent tint, selected fills | `#E1CAA8` | `#4A3D2F` |
| `--stone` | Quiet panel | `#DCC4A2` | `#3A2F25` |
| `--text` | Text | `#2A241D` | `#F4E9D6` |
| `--muted` | Secondary text (AA on every surface) | `#665A4C` | `#C9B79D` |
| `--faint` | Decoration only, never text | `#8C7B66` | `#94826B` |
| `--rule` | 1 px rules and borders | `#D4BF9F` | `#4D4134` |
| `--accent` / `--ink` | Primary button, selected | `#2C251D` | `#ECD9B8` |
| `--shadow-soft`, `--shadow-lift`, `--shadow-deep` | Cards at rest, on hover, sheets and the phone | warm brown | near black |
| `--r-control` / `--r-card` | Controls / photographs, cards, sheets | 2 px / 6 px | same |

Type: Playfair Display 400 for the question, the home headline, the look title, answer choices and piece names (38 px on mobile, 52 px on desktop for display); Geist 400 and 500 for everything else; small labels (step count, eyebrows, piece houses) in 11 px tracked capitals (`.a-label`); Geist Mono for prices. Body text 16 px on mobile, 15 px on desktop. Fonts load from Google Fonts in `src/shared/fonts.ts`; self-host them for production.

Layout: on desktop the split is half and half, the bar floats over it so the print runs the full window height, and the question block sits centred in its half (max 440 to 520 px). Header: the PRAXIS wordmark in tracked capitals (centred on mobile, left on desktop beside the progress spine) and a menu icon; the spine shows on desktop only. On a phone, home sets the occasions two to a row. An empty portrait print shows a hairline oval. Every page except the result pages (results, try-on, a saved look) fades its photo into the page: full-bleed prints fade from the left edge on desktop and the bottom edge on a phone, framed prints soften on every edge. Result pages keep the hard lookbook edge (`book` on `Frame`). Results on desktop run the print full bleed with the three looks as an index on its right edge (on a phone or tablet they stand beside the print, so it keeps the band's full height); the look's why reads as the stylist's note in the serif italic, and "Get the pieces" is an outlined control beside the primary on desktop.

Imagery: with nothing under it, the print runs full bleed across the canvas like a lookbook page; results keep the framed print with thumbnails. Motion: fades 0.7 s, page entry 0.6 s, moving between looks 0.3 s (the photo glides 32 px from the side it came from while the column fades), reduced motion respected. The desktop column keeps 16 px of room under its last line (padding with a matching negative margin) so serif descenders are never clipped by its scroll box.

Control rules (`src/a/ui/controls.tsx`, `a.css`): every control is 44 px tall with text centred by the box; label 15 px medium and hint 13 px muted on one baseline, 8 px apart; 2 px corners on controls, 6 px on cards, sheets and the sign in panel, 0 on the full-bleed print; 1 px rule borders; selected is ink fill; hover is surface fill; pressed scales to 0.98; focus is a 2 px accent ring with a 2 px gap. Prices are tabular figures on one right edge. The active thumbnail carries a 2 px accent underline flush to its width, 6 px below. Everything sits on an 8 px grid with 48 px desktop and 20 px mobile gutters.

Layout rules: on phones the primary action is pinned at the bottom of the column under one rule and is never below the fold; on desktop the action row follows the content under the same rule, so it sits where the eye already is; the print is sized from the available height; the stage is capped at 1600 px wide. On phones the print band is 40% of the viewport while answering and 50% on results and try-on. Verified at 1440x900, 1920x1080, 2000x1120, 1280x720, 390x844 and 375x667.

Motion is `motion/react` only, transform and opacity only, and every animation respects `prefers-reduced-motion`.

## Tests

`npm test` runs the unit tests in `src/core/__tests__`. `npm run build && npm run e2e` runs fourteen suites (`e2e/suites`, loaded by `e2e/scenarios.mjs`) in Chromium on desktop, phone and seven viewports; results go to `e2e/results`. `SUITE=4 npm run e2e` runs one suite, `ONLY=TRY1 npm run e2e` one scenario. See `docs/testing-report.md`.

## Documentation

`docs/architecture.md` (with the diagram), `docs/api-contracts.md`, `docs/data-schemas.md`, `docs/analytics.md`, `docs/privacy.md`, `docs/integration-dependencies.md`, `docs/testing-report.md`, `docs/AI-SERVICES.md` (the nine AI service contracts, their mocks and how a real provider plugs in), `docs/AI-HANDOVER.md` (each future AI integration: interface, schemas, mock, settings, errors, screens, backend work, tests, dependencies), `docs/TRY-ON.md`, `docs/CATALOGUE.md` (store pieces, styling references, outfit pictures, connecting an image model), `docs/RELEASE.md` (release notes, deploying, environment, monitoring, rollback).

## Structure

```
src/main.tsx            mounts ConceptA at /
src/a/ConceptA.tsx      root: theme, fonts, routes
src/a/screens/          home, moment/*, dna/*, looks, you
src/a/ui/               Stage, Frame, Thumbs, controls, TopBar, Gate, sheets
src/a/lib/              journey context, spine, looks, styling, dna, user, mode, image, stream
src/core/               contracts, request, validation, service, processing, retail, images, vision, style profile, data, test mode, mock adapter, identity, feedback, analytics, accounts (no React)
src/core/__tests__/     unit tests
src/a/a.css, a-layout.css   tokens and layout
src/shared/             catalog, fonts, store
src/lib/outfitLibrary.ts, src/types/praxis.ts   catalog source
```

## Home

`src/a/screens/Home.tsx` is a page that scrolls, not a fixed-height split. On desktop the hero is two columns (about 52/48): the headline with "Every time." in italic, one line ("Choose your occasion. Discover three looks designed for it."), "Where are you going?", and the five occasions as photographs, three over two like a curated set (`src/a/ui/OccasionCards.tsx`: Dinner, Work and Date on the first row, Wedding and Party sharing the second; the name and a round arrow sit on the photo over a warm shade from the foot, the city caption at the top left). On a phone they are two to a row with Party across the width; between 640 and 1023 px they keep three over two. Hover leans the photo in and moves the arrow; touch darkens it slightly; a chosen card is ringed; keyboard focus has its own outline. Beside it, `src/a/ui/HomeDemo.tsx` plays the home film (see below). Below: How it works as one strip between hairlines, then Style DNA as one photograph across the page with the copy on the open wall at the right (on a phone, the photograph above and the copy below on the wall's colour). At 1366 x 768 the headline, the five occasions and the film are all in the first view.

The Style DNA panorama (`public/images/home/style-dna-wide-*.webp`, `style-dna-phone-*.webp`) is an interim image made by `tools/style-dna-banner.py` from the app's own look photo (`public/images/wedding_relaxed_01.jpg`): the wall is extended, warmed and given palm shadows. Replace it with a licensed editorial photograph (a man in light linen against a sunlit cream wall, subject in the left third, open wall on the right) at the same names and sizes.

The home photographs live in `public/images/home` as WebP at 480 and 960 wide (4:3), cropped for the cards; sources are listed in `public/images/home/CREDITS.md`. Every visitor sees the same five occasion photos, listed in `src/config/occasionPhotos.ts`. To swap one, replace both widths under the same name and bump the version there.

The home film (18.5 s, 30 fps, about four seconds each for the looks, Make it yours and Style DNA) is rendered from `video/hero-film` with three.js: a phone (titanium edges, glass, side buttons, the island) on a travertine table in warm window light, with the Style DNA tailoring cloth beside it. Its screen is the real app, captured by `node video/hero-film/capture.mjs` (with `npm start` running): the occasions, a light tap on Dinner, the build with its moving line, then the three dinner looks, then Make it yours (See it on me, Use something I own with a navy overshirt from the wardrobe, the look rebuilt around it) and Style DNA (the fit step, two tastes picked, the saved profile), as a signed in Premium stand-in account. The three looks leave the screen from their thumbnails as prints, rise along curved paths gaining their shadows, and settle as a set above the table (Classic, Sharper, Relaxed); the sharper look, my pick, comes forward, and all three go back into the screen. The camera closes in on Make it yours: See it on me opens, then Use something I own takes the navy overshirt from the wardrobe and the look comes back with it marked Yours. Then Style DNA: Slim is chosen, then Quiet luxury and Classic tailored, and the saved profile's five colours lift off the screen as woven swatches, hang in an arc and go back; the screen returns to the occasions, so the loop has no cut. `node video/hero-film/render.mjs` steps through it frame by frame in Chromium (SwiftShader, no GPU needed, about 25 minutes per cut) and writes `public/media/praxis-hero-film.mp4` (1200 x 1000, 6:5, from 640 px up) and `praxis-hero-film-mobile.mp4` (800 x 1000, 4:5, phones), each with a VP9 WebM and a WebP poster of the phone and the three looks. `--stills 0,2.6,5.6` writes single frames to `video/.frames` instead. Re-capture and re-render whenever the home cards, the build, the results, Make it yours, the wardrobe or the Style DNA screens change visibly. The film is muted, loops, plays inline and only while a quarter of it is on screen; it holds while the pointer or focus is on the occasions; the round control in the lower right always shows its real state, and a film the visitor paused never restarts on its own. With reduced motion the poster shows and the film plays only when Play is chosen. The earlier phone-screen film and its source (`video/hero-demo`) were removed; both remain in the history at commit 33a62f1.

## Restyle

"Restyle" (in the pinned action row) on the results opens a sheet with the answers that change the looks: the feel, the budget, the occasion (each shows the current answer), and "Start a new look". Picking one opens that question with `restyle=1`; the answer goes straight back to the looks (a new occasion asks the place first). The PRAXIS wordmark always starts a fresh journey. On desktop the bar is 80 px with a 22 px wordmark; Saved looks, Style DNA and Sign in sit top right straight on the photo, in ink with a soft ivory halo so they read over dark photos too, and the menu button is phone only. Starting over is always called "Start a new look"; the saved page is "Saved looks".

Moving between steps: the progress lists every step (Occasion, Place, Time, Feel, Budget, Looks). On desktop it sits in the bar; on a phone it sits above each question. Any answered step opens from any other, backwards or forwards, with every answer kept. After an answer the journey goes to the first question still unanswered, or straight to the looks once all are in, so changing one answer never means repeating the others. Restyle carries the hint "Change an answer". On the results, Make it yours sits above the pieces as two cards that say what they do. An unticked piece reads "Not included" and the print says "Original look, 1 piece not included": the photo stays the stylist's reference. A friend opening a shared link sees "Get your own looks" and a quiet "Forward", never Check out; each share option says what the friend will see.

Time of day offers sunrise and sunset only where they fit the occasion (`timesFor` in `src/shared/catalog.ts`); they warm the photo (`golden` on Frame), night darkens it. Check out lists the pieces ticked on the page with a size for each; it confirms no stock, delivery or order the retailer has not given.

## Phones and iOS Safari

- Under 1024 px the page itself scrolls, never a box inside it: the photo band takes a fixed share of `100svh` (so it does not jump when Safari's toolbar hides), the top bar sticks to the top and the action row sticks to the bottom (`a-layout.css`, the max-width 1023 px block). Desktop keeps the fixed split.
- `html, body` clip sideways overflow and do not bounce past their edges (`src/index.css`).
- Text fields are 16 px; anything smaller makes iOS zoom the page on focus.
- Sheets, the gate, the menu and the full-screen look hold the page still while open (`src/a/lib/scrollLock.ts`); their own content scrolls with `overscroll-behavior: contain`.

## Monitoring and smoke tests

Errors that reach a customer are sent to `POST /api/client-error` (name, where, path and app stack frames; never the message) and written as one JSON line to the server log with server errors (`server/monitor.mjs`). `GET /api/health` gives the version, commit and that no AI provider is on. `node tools/smoke.mjs <url>` checks a deployed site without changing anything; `.github/workflows/smoke.yml` runs it after each Railway deploy. See `docs/RELEASE.md`.

## Known gaps

- "New moment" lives in the overlay menu on mobile; the spine fills the bar.
- The Dinner mood image is the same file as the Dinner "sharper" look, so one preview swap shows no change.
