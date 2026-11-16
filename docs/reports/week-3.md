# Week 3 report (from 16 Nov 2026)

A running log, one section per phase, in the same form as `week-2.md`: what was done, each check with pass or fail and its evidence, and what is still open.

There is no written Week 3 brief. The plan was agreed in chat on 2026-11-15, and work ran in the order where nothing waits on someone else:

1. Finish staging: Railway's new config format (waits for Tarek), backups and a down-alert, and Wait for CI confirmed.
2. A search box in the app: Find a piece.
3. A retailer onboarding kit.
4. Account controls: download my data, delete my account.
5. Browser tests against staging, and this report.

The retailer and legal items stay on hold by Tarek's decision. Customer-visible catalogue pieces stay off (`CATALOGUE_MATCHING_FOR=test`).

## Phase 2: Find a piece

### What was done

| Commit | What it changes |
|---|---|
| `7dbe2eb` | **Find a piece** (`/search`, `src/a/screens/Search.tsx`): a few words or a photo of a piece, and the closest pieces in stock. Each piece is shown as its cut-out with its store, price and sizes, and a "View at <store>" link that opens the store's own page (https only).<br>• **Who sees it:** the same rule as catalogue pieces in the looks (`searchAvailable`, `src/core/catalogueSearch.ts`). The server must offer free catalogue matching, and while that is for testing, only a tab opened with `?stock=live` sees it. Customers see neither the screen nor the menu entry until the catalogue opens. A build with no server shows "coming soon".<br>• **Where it is:** "Find a piece" in the desktop bar (a magnifier below 1280 px) and in the menu, only when open to this visitor.<br>• **Privacy:** the words and the photo go only to this app's own server and model, for this search, and aren't kept. A photo is shrunk to 768 px first. Analytics records only how the search was asked (`words` or `photo`), the number of results and the kind understood, never the words or the photo (`catalogue_searched`, `search_piece_opened`).<br>• **Better ordering** (`server/search.mjs`, `withinKind`): when the words name a colour as well as a kind, that kind in that colour comes first. "navy blazer" had shown a stone blazer first; now the navy blazers lead |

### Checks

| Check | Result | Evidence |
|---|---|---|
| Unit tests | pass | 11 new (`catalogue-search.test.ts`): reading a result (only https links, only cut-outs on this server), prices, errors in words, who may search, and the kind-and-colour ordering |
| In the browser | pass | `node e2e/catalogue-in-app.mjs`, 11 of 11. New checks: the bar offers Find a piece; "navy blazer" gives blazers first (Navy blazer, Navy Wool Blazer, then Stone); the screen says it read a blazer; every result is a cut-out; a photo of a belt finds the Tan Leather Belt first |
| Search quality | 9 of 10, as before | `SEARCH_QUALITY=1`: the colour change moved nothing else. The belt query still fails only "three belts in the top three", because the library catalogue has one belt |
| Phone and desktop | pass | screenshots at 390 and 1280 px, no sideways scroll |

## Phase 3: the retailer onboarding kit

### What was done

| Commit | What it changes |
|---|---|
| `019ca2e` | **For retailers:** `docs/retailers/README.md` explains in plain words what to send (a Shopify address or a CSV file), what makes a good photo and what customers see. `docs/retailers/catalogue-template.csv` is a filled-in example.<br>**The checker,** `npm run retailers:check -- --csv <file>` or `-- --shopify <store>` (`server/retailers/check.mjs`). It reads the catalogue exactly as the import does, writes nothing, and lists every problem in turn: rows left out (with line numbers), repeated ids, pieces it can't place as clothing, pieces without a photo, pieces sold out in every size, things that aren't clothing, and mixed currencies. It ends with how many pieces would be ready.<br>**The store report,** `npm run retailers:report [-- --store <id>]` (`server/retailers/report.mjs`). Per store: last import, live pieces, how many can be shown now, how many are processed, waiting or failed (with the batch job's reason from Redis), not placed, without a photo, and removed |

### Checks

| Check | Result | Evidence |
|---|---|---|
| The checker agrees with the import | pass | on `sample.csv`: 21 pieces, 18 ready, line 32 left out, WKD-OLV not placed, GFT-100 not clothing, POL-GRN sold out. These are the same as the import's own report |
| The template is clean | pass | 3 pieces, 5 sizes, 3 ready, no problems |
| The report on the local catalogue | pass | Harbour & Hide 18 of 21 shown; Library 46 of 46; Test Tailors 7 of 11, with the two missing photos named |
| Unit tests | pass | 4 new (`retailer-kit.test.ts`), one against Postgres |

## Phase 4: account controls

### What was done

| Commit | What it changes |
|---|---|
| `0acb043` | **Download my data** (`GET /api/account/export`, `server/auth/controls.mjs`): one JSON file with everything the server keeps for the account:<br>• the account itself<br>• every agreement given and withdrawn<br>• sessions and sign-in links (dates only, never a token)<br>• saved looks, wardrobe pieces and feedback<br>• guest hand-overs<br>**Delete my account** (`POST /api/account/delete { confirm: "delete" }`): removes the user and, through the database's cascades, its agreements, sessions, looks, pieces, feedback and hand-overs, plus the sign-in links sent to its address. It ends every session, and the page clears this browser too.<br>**What is kept afterwards is one setting,** `ACCOUNT_DELETION_KEEP_CONSENT_DAYS`. It is 0 by default, which keeps nothing. Above 0, the agreement history is kept for that many days under a SHA-256 hash of the address, never the address itself (migration `…700_account-deletions.sql`), and expired rows are removed at the next deletion. **The legal text decides the number.**<br>Both are on Your data, under "Your account's data". New events `account_data_downloaded` and `account_deleted` |

### Checks

| Check | Result | Evidence |
|---|---|---|
| Unit tests over HTTP | pass | 3 new in `auth.test.ts` (19 in the file):<br>• the download holds the account's own data, no token, and not another account's<br>• deleting needs `confirm`, refuses another site, ends both sessions, and leaves no user, agreements, sessions, looks or links<br>• with the setting at 30 days, only the agreements are kept, under a hash, and purged after 30 days |
| In the browser | pass | `node e2e/signin-magic-link.mjs`, 37 of 37. New checks:<br>• Download my data saves `praxis-account-<date>.json` with the account, its look, both agreements and both sessions, and no token<br>• Delete my account signs out both devices and clears this browser<br>• the server keeps no user and no sign-in links |
| Migration | pass | runs locally. On staging it runs as the pre-deploy step at the next deploy |

## Phase 1: finishing staging (the parts that don't wait)

### What was done

| Commit | What it changes |
|---|---|
| `eefc160` | **The down-alert:** `.github/workflows/uptime.yml` checks staging every hour. Health must answer ok with the database, Redis and the ai service up, and the page must load. It tries three times a minute apart. A failed run emails whoever last changed the schedule. It uses about 720 Actions minutes a month.<br>**Backups:** `docs/deploy/railway.md` says how to turn on Railway's daily volume backups. That's a dashboard switch with no CLI command.<br>**The staging browser run** leaves out suite 7 (the preview sign-in), because staging signs people in for real, and defaults to the staging address |

### Still waiting

- **Railway's new config format** (`.railway/railway.ts`, `railway config migrate`) before 2026-12-01. The file covers the whole project, including the old service Tarek is keeping, so it waits for his OK.
- **Wait for CI:** confirmed at the first merge to `main` that changes code. Week 3 is that merge.
- **Daily backups:** a dashboard switch (by hand, below).

## Phase 5: the browser suites

### Locally, on the Week 3 code

| Check | Result | Evidence |
|---|---|---|
| Every browser scenario | 246 of 247 runs, 2423 of 2424 checks | `npm run e2e` on `eefc160`, 2026-11-15 18:14 UTC. The one failure was TRY5 on phone ("the camera problem is explained") |
| The try-on suite again | 2 of 4 runs failed, then fixed | `SUITE=4` four times: two runs failed TRY5 and TRY7 (camera refused, live preview), two passed. On the code before Week 3 (`c368905`, in a temporary worktree), it passed 3 of 3 |
| After the fix | 3 of 3 | Both checks waited a fixed 1.5 s after "Take a photo". They now wait for the answer (up to 8 s) and record how long it took: camera refused in 0.76–0.98 s, live preview in 0.22–0.85 s. The failures were runs where the machine took longer than 1.5 s, straight after the full suite. Week 3 changes nothing in the camera code. The extra request the top bar now makes for Find a piece is asked once per tab, so it can't be ruled out entirely as a source of load |
| The sign-in suite with the new account controls | 37 of 37 | `node e2e/signin-magic-link.mjs` |
| The catalogue suite with Find a piece | 11 of 11 | `node e2e/catalogue-in-app.mjs` |

### Against staging

Release PR #4 was approved and merged on 2026-11-16 at 09:02 UTC (`e407fd4`).

| Check | Result | Evidence |
|---|---|---|
| Wait for CI | pass | CI on `main` passed at 09:03, staging went live on `e407fd4` at 09:04. Railway waited for CI |
| The migration | pass | `1762200000700_account-deletions` ran at 09:04:34, as the pre-deploy step, before the new server started. `account_deletions` is empty (checked over `railway ssh`) |
| Health | pass | database, Redis and ai up; the page answers 200 |
| Find a piece | pass | "navy blazer": blazer understood, 12 pieces, Navy Wool Blazer and Navy blazer first, 75 ms. "white trainers": sneakers, white leather sneakers first, 78 ms |
| Account controls | pass | export and delete answer 401 without a session |
| Browser suites, first try | not a result | run 43836695953 said "success" with 0 of 0 runs. The unquoted default `1,2,3,…` reached the runner as `1234568910111315`, so nothing was selected. Fixed in `c6077ca`: the default is quoted, an unknown suite number stops the run, and a run that selects nothing fails |
| Browser suites | 153 of 204 runs, 1576 of 1667 checks | run 43838701498. Suites 1, 2, 3, 8 and 15 pass in full. Failures are in 4 (16 of 17), 5 (15 of 15), 10 (15 of 25), 11 (2), 6, 9 and 13 (1 each) |

**Why the browser suites fail on staging.** The scenarios that need a Premium customer make one in the browser (the preview sign-in, `premium: true` in `e2e/scenarios.mjs`). Staging signs people in for real, by email link, so it doesn't know that account. "The seeded account has Premium" fails, the account's requests get 401, and the clicks wait for Premium screens (try-on, Style DNA) that never open. That is the same reason suite 7 is already left out. Every failure in the detailed report is one of those three. A visitor who isn't signed in never gets a 401, and suites 1 to 3 pass. This is a limit of the tests against a real-sign-in site, not a fault found in staging. Those screens are covered by the full local run (246 of 247, then fixed).

**Also fixed on the way:** `ubuntu-latest` is now Ubuntu 26.04, and Playwright 1.56 has no Chromium for it. That is why the after-deploy smoke test failed on 2026-11-15. The smoke test and the staging run are pinned to `ubuntu-24.04` (`21fc753`).

**Open:** cover the Premium screens on staging. Either the staging run leaves out the scenarios that need the preview account and says how many, or staging gets a real test account with Premium, signed in by the run. The second needs a sign-in route for tests, so it waits for a decision.

## By hand

- Railway → staging → `Postgres` → Backups → turn on a daily schedule.
- Approve the release pull request, so Week 3 reaches `main` and staging.
- Tarek: OK the Railway config change before 1 Dec.
