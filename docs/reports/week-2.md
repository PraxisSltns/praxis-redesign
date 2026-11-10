# Week 2 report (from 10 Nov 2026)

A running log, one section per phase, in the same form as `week-1.md`: what was done, each check with pass or fail and its evidence, and what is still open.

There is no written Week 2 brief. The plan follows the Week 2 section of the update sent to the client, ordered so that nothing waits on someone else first:

1. Fixes found while preparing the demo.
2. The catalogue in the app: looks use imported pieces, found by the new search, with cut-outs.
3. Search relevance: the two queries that failed in Week 1.
4. Wardrobe and feedback kept with the account.
5. Staging on Railway and the scheduled batch, once the written spend approval is confirmed.

## Before Phase 1: the end of Week 1

- `dev` was pushed for the first time. The first CI run failed on a test, not on the code: the batch-job test depended on the queue's order, which changes every run. Fixed in `d0c803b`. Locally the old test failed 1 run in 8 and the fixed one passed 8 of 8.
- The GitHub setup in `docs/deploy/ci.md` is done:
  - `dev` is the default branch
  - `main` needs a pull request with one approval and a green `test` check
  - `dev` can't be force-pushed or deleted
  - Actions can open pull requests (after an organisation owner allowed it)
  - `MERGE_TOKEN` is set
- Week 1 reached `main` through pull request #1 (`a4f0042`), and CI passed on `main`. The automatic merge failed with `Resource not accessible by personal access token (mergePullRequest)`, so it was merged by hand. The token most likely names a personal account as its resource owner instead of `PraxisSltns` (open item).
- The repository moved to `PraxisSltns/praxis-redesign`. The setup docs were updated in `f416701`.

## Phase 1: fixes found while preparing the demo

Run on 2026-11-10 on `dev`.

### What was done

| Commit | What it changes |
|---|---|
| `ceace7e`, `4932e19` | A CSV import names its store with `--store <id>` (lower-case letters, digits and dashes), and refuses without one. Before, the store's id was the file name. A retailer's `catalogue-nov.csv` and `catalogue-dec.csv` became two stores, and two retailers who both sent `products.csv` shared one, so the second import would have marked the first's pieces as gone. The fixture stores keep their ids (`csv:sample`, `csv:library`), so existing data doesn't move |
| `7ab5935` | Saved looks sync both ways with the account:<br>• removing a look removes it from the account (`DELETE /api/looks { dedupeKey }`, which is idempotent)<br>• each page load drops looks removed on another device and sends what this device hasn't sent yet<br>• a removal that didn't reach the server is kept and retried, so the look doesn't come back<br>• Undo puts the look back on the account too<br>The rules are one pure function, `reconcileAccountLooks` (`src/core/account.ts`). Account writes use `keepalive`, so a change of page straight after them doesn't cancel them |
| `5962cf5` | Your data, signed in with a real account, lists what the account agreed to and when, with "Withdraw my agreement":<br>• it records `withdrawn_at` and keeps the history<br>• it ends every session of the account (`POST /api/account/consents/withdraw`), and signing in again asks again<br>A page whose session has ended now signs itself out on load, whether the session was withdrawn, signed out elsewhere or past 30 days. New event `account_consent_withdrawn` |
| `8551437` | With a real account, Saved looks says "Kept with your account, on every device you sign in on." It used to say "in this browser on this device", which was no longer true |

### Checks

| Check | Result | Evidence |
|---|---|---|
| A CSV store keeps one id across files, and two retailers never share one | pass | `retailers.test.ts`, "a CSV store's id": `catalogue-nov.csv` and `/elsewhere/catalogue-dec.csv` with `--store harbour-and-hide` give the same retailer. Two `products.csv` files with different stores give different retailers. No `--store`, or a bad one, is refused. The fixtures keep `csv:sample` and `csv:library`. The CLI without `--store` prints `Say which store the file is for: --store <id> …` |
| Removing a look removes it everywhere and it stays removed | pass | `node e2e/signin-magic-link.mjs`, 25 of 25:<br>• "Undo on the second device puts the look back here and on the account"<br>• "removing the look on the second device removes it from the account"<br>• "after a reload, the removed look stays gone on the second device"<br>• "the first device drops the look removed on the second"<br>• "the server no longer holds the removed look (0)"<br>`account-sync.test.ts`, 9 tests: pending removals aren't brought back, unsent saves are kept and sent, nothing is dropped when the list may be cut short, and other accounts' looks are left alone. `auth.test.ts`: removing by key twice gives `{ removed: true }`, then `{ removed: false }` with 200; no key 400; no session 401 |
| Withdrawing consent | pass | `auth.test.ts`: withdrawing gives `{ withdrawn: ["privacy","terms"], signedOut: 2 }` and clears the cookie, and both devices' sessions then get 401. A sign-in without consents gets `consent_missing`. Signing in again records new grants (4 rows, 2 withdrawn). From another origin 403. Browser: "Your data shows the two agreements with their dates", "withdrawing signs the account out on this device and the other one", "the other device shows itself signed out on its next load", "the withdrawal is recorded, with the agreements kept as history (2 of 2 withdrawn)" |
| Saved looks wording with a real account | pass | browser: "Saved looks says the looks are kept with the account" |
| Unit tests, typecheck | pass | `Test Files 26 passed, 1 skipped`, `Tests 359 passed, 12 skipped` (from 344); `tsc` 0 errors |
| The default (preview) build still passes the scenarios | pass | `npm run build && npm run e2e` on the Phase 1 code: `247 of 247 runs passed; 2424 of 2424 checks passed` (2026-11-10 19:29 UTC, about 40 minutes). No flaky failures this time, TRY5 included |

### Found on the way

1. **A guest's looks could miss the account at sign-in.** The hand-over request runs as the verify page returns to Looks, and the change of page could cancel it before it reached the server. The browser check's "2 claims" passed or failed depending on timing; it failed once in this phase and had passed by chance in Week 1. Account writes now use `keepalive`. Any look that still doesn't arrive is unsynced on the device and sent on the next load. Three runs in a row then passed.
2. **A page with an ended session looked signed in.** Nothing checked the session after sign-in, so after 30 days, or a sign-out on another device, saves failed silently. The page now signs out when the server answers 401.
3. **The CSV store-id problem was found during the demo.** Importing `sample.csv` by a relative path made a second Harbour & Hide store. That copy, which had no cut-outs or vectors, was deleted. The cause was the file name as the id, which is worse than a path mismatch.

### Open decisions

- **What withdrawing should mean legally.** It now withdraws the terms and privacy agreement together, signs out everywhere and keeps the account and its looks. It doesn't delete the account. A "delete my account and its data" action, and whether the consent history may be kept after it, need the legal text.
- **The merge token.** The automatic merge needs a fine-grained token whose resource owner is `PraxisSltns`, with Contents and Pull requests set to read and write.

## Phase 2: the catalogue in the app

Run on 2026-11-11 on `dev`.

### What was done

| Commit | What it adds |
|---|---|
| `159b649` | `server/providers/catalogue.mjs`, a `product_matching` provider over the imported catalogue:<br>• each part of a look is searched by its colour, material and name (embedded by the ai service), within its slot, with pgvector<br>• the Shopify feed's kind rules then apply: the same layer, and the same subcategory or a close stand-in<br>• it returns up to four live, in-stock pieces per part, and the page's composer picks one<br>• each piece's picture is its cut-out (`/api/cutouts/...`), which the page now accepts beside https photos<br>• switched on with `AI_PROVIDER_PRODUCT_MATCHING=catalogue`; `CATALOGUE_MATCHING_FOR=test` (default) keeps it to `?stock=live` tabs<br>• documented in `.env.example`, `docs/AI-HANDOVER.md` §7 and `docs/integration-dependencies.md` |

### Checks

| Check | Result | Evidence |
|---|---|---|
| Each part of a look finds the right kind of piece | pass | Against the real catalogue and models, two looks:<br>• Dinner: charcoal blazer gave Charcoal blazer, Charcoal tweed blazer, Wool Blazer in Charcoal; navy knit gave Merino Crew in Navy; black tailored trousers gave Black tailored trousers; Chelsea boots gave Black leather Chelsea boots; brown belt gave Tan Leather Belt, Brown leather belt<br>• Weekend: white oxford gave Oxford Shirt in White; white sneakers gave four white sneakers; stone chinos gave navy and charcoal chinos (the catalogue has no stone ones)<br>Warm, five parts take 206 ms in all |
| The rules, without a database | pass | `catalogue-matching.test.ts`, 7 tests: slot, layer and kind; stand-ins rank below the exact kind; colour and meaning raise the rank; one embedding call per look; four per part, best first; the cut-out reaches the page's piece, and any other non-https address is still refused; "disabled" and "failed" answers when the database, ai service or input is missing |
| The app shows catalogue pieces with cut-outs | pass | `node e2e/catalogue-in-app.mjs` (`0ff3d13`), 6 of 6, three runs:<br>• the server offers `product_matching` from `catalogue`<br>• the Dinner look's pieces are all from the catalogue (4 of 4: Charcoal blazer, Merino Crew in Navy from Test Tailors, Black slim trousers, Black leather Chelsea boots)<br>• each piece is shown as its cut-out, and the 4 cut-outs load as `200 image/png`<br>• the big photo still says "Reference photo, not these exact pieces."<br>• the look is ready in 930 ms |

## Phase 3: search relevance

### What was done

| Commit | What it changes |
|---|---|
| `9560041` | When a text search names a kind of piece (by the shared ontology) and gives no slot, it keeps to that kind's slot and puts the closest piece of that exact kind first. If the slot has too few pieces, it fills up from the nearest others. The answer says what it understood (`query.kind`) |

### Checks

| Check | Result | Evidence |
|---|---|---|
| 10 sample queries, the Week 1 criteria unchanged | **9 of 10 pass (8 in Week 1). The 10th puts the belt first but can't meet "three of the right slot"** | `SEARCH_QUALITY=1 npx vitest run src/core/__tests__/search-quality.test.ts`:<br>• "navy blazer" now gives Navy blazer, Navy suit jacket, Charcoal tweed blazer (in Week 1 the third was trousers)<br>• "brown leather belt" now gives Brown leather belt first (in Week 1 it gave three loafers), then two loafers, because the library catalogue has exactly one extras piece<br>All 10 take 51 to 98 ms |
| The rule on the database | pass | `catalogue.test.ts`: words that name a blazer, with a vector that points at sneakers, give the blazer first and the sneakers only to fill up; no kind named, or a slot given, works as before |

### Found on the way

1. **Putting every exact match first made results worse.** A charcoal blazer (0.072) went above a navy suit jacket (0.103) for "navy blazer". Now only the closest exact match goes first, and the rest follow by closeness.

## Phase 4: wardrobe and feedback kept with the account

### What was done

| Commit | What it adds |
|---|---|
| `3453e83` | • `server/auth/records.mjs` and routes: `GET`/`PUT`/`DELETE` on `/api/wardrobe` and `/api/feedback`, for the signed-in account only<br>• a migration (`…600_wardrobe-per-account.sql`) that keys a wardrobe piece by account and id<br>• on the page, `src/core/accountSync.ts`, a pure three-way merge. This device remembers each record's version at the last sync, so it can tell a piece added, edited or removed here from one changed on another device<br>• `src/core/accountRecords.ts` runs the merge for wardrobe and feedback on each load and each change of screen, one run at a time<br>• a failed send is found again on the next run, and a 401 signs the page out<br>Photos of pieces still never leave the tab |

### Checks

| Check | Result | Evidence |
|---|---|---|
| The server keeps each account's records apart | pass | `auth.test.ts`: two accounts add the same sample piece, which has the same id for everyone, and each keeps its own; an edit replaces, a removal removes; feedback saved twice stays once; another account's feedback id gets 409; bad input 400; no session 401; another origin 403 |
| The merge rules | pass | `account-records-sync.test.ts`, 7 tests: added here or there, removed here or there, changed here or there, both changed (newer wins), and a failed send of each kind is sent again |
| Across two devices in a browser | pass | `node e2e/signin-magic-link.mjs`, 31 of 31, three full runs: "a piece added on one device is kept with the account", "the other device's wardrobe shows it", "removing it on the other device removes it from the account", "and from the first device's wardrobe", "feedback on a look is kept with the account (more_like_this)", "the other device has the feedback too" |

### Found on the way

1. **The sign-in rate limit stopped a test run, as designed.** One run of the browser check stopped at "Check your email." Redis showed 31 links from this machine in the hour (`auth:start:ip:…` at 31, against a limit of 30), after a day of test runs. The local counter was cleared and the run passed. On staging, test runs from CI's single address would hit the same limit after about 7 full runs an hour.
2. **Wardrobe ids aren't random.** They're a hash of the piece's type, name and source (`src/core/request.ts` `wardrobeRef`), so two people with the same sample piece share an id. The table's key was the id alone, which would have refused or overwritten the second person's piece. It's now keyed by account and id, and the migration runs down and up cleanly.

## Week 2 at the end

On local `dev` (`20eb247`), not pushed:
- **Unit tests:** 375 passed, from 344 at the end of Week 1. `tsc` shows 0 errors.
- **Browser scenarios, default build, final code:** the suites these phases touch (3 results, 6 wardrobe, 7 accounts, 8 retail, 12 contracts, 13 analytics, 14 hybrid) all pass: `SUITE=3,6,7,8,12,13,14 npm run e2e` gives `84 of 84 runs passed; 615 of 615 checks passed`. The full run passed on the Phase 1 code (above).
- **Real sign-in, two devices:** `e2e/signin-magic-link.mjs`, 31 of 31.
- **Catalogue in the app:** `e2e/catalogue-in-app.mjs`, 6 of 6.
- **Search quality:** 9 of 10.
- **Migrations:** 7, and the new one runs down and up cleanly.

Still needed from people: the staging spend approval, a merge token owned by `PraxisSltns` (`docs/deploy/ci.md` §6, now explained), Resend, the legal text (including what account deletion keeps), and the first real retailer. Also, the retailers' agreement before `CATALOGUE_MATCHING_FOR=everyone`.

## Phase 5: staging

Not started. It waits on the written spend approval, as in Week 1. Everything it needs is in `docs/deploy/railway.md`, plus `AI_PROVIDER_PRODUCT_MATCHING=catalogue` and a Railway cron service for `npm run catalogue:process`.
