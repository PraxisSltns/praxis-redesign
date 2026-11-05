# Data schemas (deliverable D)

This document lists every record Praxis stores and the shape of each, read from the code. The app still keeps everything in the visitor's browser. The server's database tables exist (section 9, `server/db/migrations`), but no screen reads or writes them yet. In the browser, data lives in `localStorage` (kept on the device between visits) or `sessionStorage` (kept for the tab only and gone when the tab closes). The last section is a proposal for the tables a backend would need. None of those tables exist yet.

## Contents

1. Where the inventory comes from
2. Storage helpers and failure behaviour
3. Retention and pruning
4. Records kept on the device (`localStorage`)
5. Records kept in the tab (`sessionStorage`)
6. Shared types used inside the records
7. Migrations
8. Deleting everything
9. Proposed server schema (not built)

## 1. Where the inventory comes from

`STORES` in `src/core/data.ts:30` is the list of every key Praxis writes. The internal page lists it (`src/a/screens/Internal.tsx:146`), and it is the inventory for this document. Deletion does not read it: `deleteLocalData` removes keys by the `praxis_` prefix (section 8). Each entry has this shape (`src/core/data.ts:22`):

```ts
interface StoreInfo {
  key: string;
  where: "device" | "tab";   // device = localStorage, tab = sessionStorage
  holds: string;             // plain words, shown on /internal/analytics
  personal: "none" | "preferences" | "photo";
}
```

| Key | Storage | Personal | Written by | Section |
|---|---|---|---|---|
| `praxis_lab_a` | local | preferences | `src/shared/store.ts:78` | 4.1 |
| `praxis_lab_a_user` | local | preferences | `src/a/lib/user.ts:41` | 4.2 |
| `praxis_lab_a_accounts` | local | preferences | `src/core/identity.ts:66` | 4.3 |
| `praxis_lab_a_mode` | local | none | `src/a/lib/mode.ts:10` | 4.4 |
| `praxis_lab_a_viewer_hint` | local | none | `src/a/ui/LookViewer.tsx:27` | 4.5 |
| `praxis_anon` | local | none | `src/core/identity.ts:9` | 4.6 |
| `praxis_styling_history` | local | preferences | `src/core/service.ts:119` | 4.7 |
| `praxis_feedback` | local | preferences | `src/core/feedback.ts:11` | 4.8 |
| `praxis_events` | local | none | `src/core/analytics.ts:155` | 4.9 |
| `praxis_selections` | local | preferences | `src/core/data.ts:111` | 4.10 |
| `praxis_wardrobe` | local | preferences | `src/core/data.ts:132` | 4.11 |
| `praxis_image_consent` | local | none | `src/core/images.ts:161` | 4.12 |
| `praxis_sync_offer_dismissed` | local | none | `src/a/ui/Completion.tsx:17` | 4.13 |
| `praxis_lab_a_face` | session | photo | `src/a/lib/journeyContext.ts:49` | 5.1 |
| `praxis_dna_draft` | session | preferences | `src/a/lib/dnaDraft.ts:9` | 5.2 |
| `praxis_lab_a_removed` | session | preferences | `src/a/screens/Looks.tsx:20` | 5.3 |
| `praxis_lab_a_item` | session | photo | `src/a/lib/journeyContext.ts:50` | 5.4 |
| `praxis_visit` | session | none | `src/core/identity.ts:10` | 5.5 |
| `praxis_events_once` | session | none | `src/core/analytics.ts:185` | 5.6 |
| `praxis_sim` | session | none | `src/core/sim.ts:22` | 5.7 |

A search of `src` for `localStorage` and `sessionStorage` finds no other keys. `src/types/praxis.ts:226` declares a `LifestyleUsageData` type with the comment "stored in localStorage", but no code reads or writes it, so it is not a stored record.

## 2. Storage helpers and failure behaviour

Most core modules go through four helpers in `src/core/ids.ts`:

| Helper | Line | Behaviour |
|---|---|---|
| `local()` / `session()` | `src/core/ids.ts:44`, `:52` | Return the storage object, or `undefined` when there is no window or access throws. |
| `readJson<T>(storage, key)` | `src/core/ids.ts:23` | Parses JSON. Returns `null` when the key is missing, the JSON is broken or access throws. |
| `writeJson(storage, key, value)` | `src/core/ids.ts:33` | Writes JSON, or removes the key when `value` is `null`. Returns `false` when storage is missing, full or blocked. |
| `newId(prefix)` | `src/core/ids.ts:4` | `prefix_` plus a random UUID without dashes (falls back to time and `Math.random` when `crypto.randomUUID` is missing). |

The saved looks store (`src/shared/store.ts`), the user preview (`src/a/lib/user.ts`), the mode (`src/a/lib/mode.ts`), the viewer hint and the tab helpers `readSession` / `writeSession` (`src/a/lib/journeyContext.ts:55`, `:64`) call `localStorage` or `sessionStorage` directly with the same try and catch pattern. Every value is stored as JSON except `praxis_lab_a_mode`, `praxis_lab_a_viewer_hint` and `praxis_sim`, which are plain strings.

When a write fails, the app keeps working from memory for that visit. The two places where a failed write matters (sign in migration, section 7.3) check the return value and keep the old state.

## 3. Retention and pruning

`RETENTION` in `src/core/data.ts:12` is the single table of retention periods, in days. `null` means the record is kept until the customer deletes it.

```ts
export const RETENTION = {
  stylingHistory: 90,
  feedback: 365,
  events: 90,
  selections: 90,
  wardrobe: null,
  savedLooks: null,
  styleDna: null,
} as const;
```

`pruneExpired()` (`src/core/data.ts:66`) runs once when the journey provider mounts (`src/a/lib/journey.tsx:29`), before any screen reads the stores. It drops records older than their period, using one date field per store:

| Key | Period | Date field used |
|---|---|---|
| `praxis_styling_history` | 90 days | `response.createdAt` |
| `praxis_feedback` | 365 days | `createdAt` |
| `praxis_events` | 90 days | `timestamp` |
| `praxis_selections` | 90 days | `at` |

`pruneByAge` (`src/core/data.ts:56`) keeps a record whose date is missing or cannot be parsed. Besides age, several stores are also capped by count, newest kept:

| Key | Cap | Where |
|---|---|---|
| `praxis_styling_history` | 20 entries | `src/core/service.ts:121` |
| `praxis_feedback` | 300 records | `src/core/feedback.ts:12` |
| `praxis_events` | 1000 events | `src/core/analytics.ts:156` |
| `praxis_selections` | 100 records | `src/core/data.ts:112` |
| `praxis_wardrobe` | 50 entries | `src/core/data.ts:133` |
| `praxis_events_once` | 400 keys | `src/core/analytics.ts:203` |

Saved looks, the Style DNA and the wardrobe have no age limit (`RETENTION.savedLooks`, `RETENTION.styleDna`, `RETENTION.wardrobe` are `null`). The other device keys have no period and no cap. Tab keys end with the tab.

## 4. Records kept on the device (`localStorage`)

### 4.1 `praxis_lab_a`: saved looks and Style DNA

The key is built as `praxis_lab_${concept}` (`src/shared/store.ts:35`), and the app uses concept `"a"` (`src/a/lib/journey.tsx:25`). Retention: until deleted.

```ts
// src/shared/store.ts (version 2, written from 2026-10-12)
interface LabState {
  version: 2;
  looks: SavedLook[];
  profiles: { profile: StyleProfile; owner?: Owner }[];   // section 6.3; never holds a photo
}
// Version 1 was { looks, dna }. On read, a version 1 `dna` becomes one profile with no owner; the
// first signed-in person on the device takes it (or the guest keeps it until they sign in). One
// unreadable look is skipped; unreadable JSON is copied to praxis_lab_a_unreadable before any write.
// Every change re-reads storage first, so two tabs never overwrite each other. Visibility:
// visibleTo(owner, userId, anonymousSessionId) in src/core/account.ts.

// src/shared/store.ts:12
interface SavedLook {
  id: string;                 // `${look.id}_${Date.now()}`
  savedAt: string;            // ISO time
  look: Look;                 // view model, section 6.4
  occasionLabel: string;
  tryOnImage?: string;        // legacy only; dropped on read (section 7.1)
  recommendationId?: string;
  requestId?: string;
  inputKey?: string;
  owner?: Owner;              // section 6.1; absent on looks saved by early builds
  dedupeKey: string;          // `${look.id}|${inputKey}`, or the legacy key below
}
```

| Field | Notes |
|---|---|
| `id` | Unique per save. Saving the same look twice makes two entries until sign in de-duplicates them. |
| `dedupeKey` | With an `inputKey`: `${look.id}|${inputKey}` (`src/shared/store.ts:134`). Without one: `${look.id}|${occasionLabel}|${ownedPieces}` where owned pieces are `slot:name` joined by `+` (`legacyKey`, `src/shared/store.ts:39`). |
| `owner` | Set on save from the anonymous id and, when signed in, the user id. |
| `recommendationId`, `requestId`, `inputKey` | Tie the look back to the request history (4.7). |

Visibility: `visibleTo` (`src/core/account.ts:23`) shows a look when it has no `owner.userId` (a guest look on this device) or when `owner.userId` matches the signed in user. Looks of another account on the same browser stay stored but hidden.

### 4.2 `praxis_lab_a_user`: the stand-in account

The sign in and Premium previews keep this record. There is no identity provider and no payment; see `src/a/lib/user.ts:1`. Retention: until sign out (which removes the key) or deletion.

```ts
// src/a/lib/user.ts:8
interface LabUser {
  id: string;        // from userIdFor(email), section 4.3
  name: string;      // always "Bob" in the preview
  email: string;     // the address typed, or "bob@praxis.app"
  premium: boolean;  // set by the Premium preview; no charge is made
}
```

This record holds an email address in clear text. `currentUserId()` (`src/core/identity.ts:77`) reads `id` from it, or derives it from `email` when `id` is missing.

### 4.3 `praxis_lab_a_accounts`: stand-in account ids

A map from a lowercased, trimmed email address to a random user id, so the same address signing in again on this browser gets the same id (`userIdFor`, `src/core/identity.ts:66`). Retention: until deleted.

```ts
type Accounts = Record<string /* email, lowercased */, string /* "user_..." */>;
```

The id is random and reveals nothing about the address, but the key of the map is the address itself. A real account system replaces this whole store with its own user id.

### 4.4 `praxis_lab_a_mode`: light or dark

A plain string, `"light"` or `"dark"` (`src/a/lib/mode.ts:8`). Written on every mode change. A `?mode=` search parameter takes precedence over the stored value. Retention: until deleted.

### 4.5 `praxis_lab_a_viewer_hint`: zoom hint shown

The string `"1"` once a look has been opened large (`src/a/ui/LookViewer.tsx:90`). Its absence means the hint still shows. Retention: until deleted.

### 4.6 `praxis_anon`: the anonymous visitor

Made on first use, with no input from name, email or photo (`src/core/identity.ts:23`). Retention: until deleted.

```ts
// src/core/identity.ts:14
interface AnonRecord {
  id: string;           // "anon_..." from newId("anon")
  firstSeenAt: string;  // ISO time
  lastSeenAt: string;   // ISO time, updated once per tab visit
  visits: number;       // incremented once per tab visit
}
```

A stored record whose `id` does not start with `anon_` is ignored and replaced (`src/core/identity.ts:26`). `noteVisit` (`src/core/identity.ts:49`) uses `praxis_visit` (5.5) so a reload does not count twice.

### 4.7 `praxis_styling_history`: requests and their answers

Each call to the styling service records the request and the validated response, newest first, one entry per `requestId` (`src/core/service.ts:131`). A cancelled request is not recorded (`src/core/service.ts:71`). Retention: 90 days by `response.createdAt`, and at most 20 entries.

```ts
// src/core/service.ts:105
interface HistoryEntry {
  request: StylingRequest;    // src/core/contracts.ts:54
  response: StylingResponse;  // src/core/contracts.ts:209
}
```

`StylingRequest` (abridged, see `src/core/contracts.ts:54` for comments):

```ts
interface StylingRequest {
  requestId: string;                    // "req_..."
  inputKey: string;                     // occasion|venue|time|vibe|spend|wardrobeIds|profileRef
  contractVersion: string;              // "1.0"
  journey: "style_a_moment";
  anonymousSessionId: string;
  userId?: string;
  occasion: "DINNER" | "WORK" | "DATE" | "WEDDING" | "PARTY";
  venue: { type: string; label: string; context?: string };
  timeOfDay: "SUNRISE" | "DAY" | "SUNSET" | "NIGHT";
  preferredVibe: "SAFE" | "SHARP" | "RELAXED";
  budget: { band: "SENSIBLE" | "ELEVATED" | "OPEN"; minimum?: number; maximum?: number; currency: "USD" };
  styleProfileId?: string;              // `${profileId}_v${version}`
  styleProfile?: StyleProfileSummary;   // values with their basis, no photo
  wardrobeItems: WardrobeItemRef[];     // name and type only, no photo
  preferences?: PreferenceSnapshot;     // from feedback; not part of inputKey
  location?: { country?: string; city?: string };
  generatedAt: string;
}
```

`StylingResponse` (abridged, see `src/core/contracts.ts:209`):

```ts
interface StylingResponse {
  recommendationId: string;
  requestId: string;
  inputKey: string;
  contractVersion: string;
  adapter: { id: string; version: string };
  mode: "demonstration" | "personalized";
  status: "completed" | "partial" | "empty" | "failed";
  outfits: OutfitRecommendation[];      // rank, role, title, rationale, explanation, garments, visualization, pricing
  fallback?: { code: string; message: string };
  error?: { code: string; message: string; retryable: boolean };
  createdAt: string;
}
```

Garments inside an outfit are either `retail` (with a `ProductRef`: price, price status, availability, sizes, purchase route) or `wardrobe` (with a `wardrobeItemId`), see `src/core/contracts.ts:131` to `:147`. The full request and response contracts are documented with the API contracts; this document only notes that the whole pair is stored as is.

### 4.8 `praxis_feedback`: More like this and Not for me

One record per tap, newest first (`src/core/feedback.ts:59`). Optional fields are deleted rather than stored as empty. "Undo" removes the record by `eventId` (`src/core/feedback.ts:70`). Retention: 365 days by `createdAt`, and at most 300 records.

```ts
// src/core/contracts.ts:230
interface OutfitFeedback {
  eventId: string;                  // "fb_..."
  anonymousSessionId: string;
  userId?: string;
  recommendationId: string;
  requestId: string;
  outfitId: string;
  garmentId?: string;               // when a piece was named
  feedback: "more_like_this" | "not_for_me";
  reason?: "too_formal" | "too_casual" | "wrong_colours" | "wrong_fit" | "too_expensive";
  adapter: { id: string; version: string };
  createdAt: string;
}
```

These records are summarised into a `PreferenceSnapshot` (`src/core/contracts.ts:35`) by `preferenceSnapshot` (`src/core/feedback.ts:87`) and sent with each request. The snapshot is computed, not stored.

### 4.9 `praxis_events`: analytics events

The only analytics sink today is this local store (`createLocalSink`, `src/core/analytics.ts:159`). New events are appended and the oldest dropped past 1000. Retention: 90 days by `timestamp`, and at most 1000 events.

```ts
// src/core/analytics.ts:101
interface PraxisAnalyticsEvent {
  eventId: string;                       // "evt_..."
  eventName: EventName;                  // a key of EVENTS, src/core/analytics.ts:36
  timestamp: string;
  anonymousSessionId: string;
  userId?: string;
  journey?: "style_a_moment" | "style_dna";
  recommendationId?: string;             // lifted out of properties
  outfitId?: string;                     // lifted out of properties
  properties: Record<string, string | number | boolean>;
  applicationVersion: string;            // APP_VERSION, src/core/config.ts:9
  testMode?: string;                     // the test mode scenario, when on
}
```

`track()` refuses events and properties not in the dictionary and any string that contains `@`, starts with `data:` or `blob:`, contains `base64` or is longer than 160 characters (`unsafe`, `src/core/analytics.ts:124`), so no photo or address reaches this store. The event dictionary itself is deliverable E.

### 4.10 `praxis_selections`: the look chosen in each set

The newest choice per recommendation, newest first (`recordSelection`, `src/core/data.ts:115`), written from the results screen (`src/a/screens/moment/Results.tsx:100`). Retention: 90 days by `at`, and at most 100 records.

```ts
// src/core/data.ts:105
interface SelectionRecord {
  recommendationId: string;
  outfitId: string;
  at: string;   // ISO time
}
```

### 4.11 `praxis_wardrobe`: pieces the customer owns

Written when a piece is added on the "you" step (`src/a/screens/moment/You.tsx:68`), newest first, one entry per `wardrobeItemId`. The photo is never written here. Retention: until deleted, at most 50 entries.

```ts
// src/core/data.ts:127, extending WardrobeItemRef from src/core/contracts.ts:26
interface WardrobeEntry {
  wardrobeItemId: string;            // `wardrobe_${slot}_${hash}`
  slot: "top" | "bottom" | "shoes" | "extras";
  label: string;                     // what the customer called it
  source: "sample" | "upload";
  addedAt: string;
  owner: Owner;                      // section 6.1
}
```

`wardrobeItemId` comes from `wardrobeRef` (`src/core/request.ts:32`): a short FNV-1a hash of `source|label|content`, where `content` is a hash of the photo data URL for an upload. The hash identifies the piece without storing the photo.

### 4.12 `praxis_image_consent`: photo notices agreed to

One record per image category, replaced when consent is given again (`grantConsent`, `src/core/images.ts:170`). Retention: until withdrawn or deleted.

```ts
// src/core/images.ts:155
interface ConsentRecord {
  category: "face_colour" | "body_fit" | "wardrobe_garment" | "try_on";
  version: string;     // IMAGE_POLICIES[category].consentVersion, e.g. "face-2026-10-11"
  grantedAt: string;
}
```

`consentFor` (`src/core/images.ts:163`) treats a record whose `version` differs from the current policy as no consent, so changed wording asks again. `withdrawConsent` (`src/core/images.ts:178`) removes the record and deletes the photos of that category; the key is removed when no records remain. Withdrawal is not itself recorded in this store, and no event records it. The only caller is "Delete everything" (`src/a/screens/YourData.tsx:48`); the `photo_deleted` event is tracked only when a single photo is deleted (`src/a/screens/YourData.tsx:39`, `:43`, and the Style DNA photo step).

### 4.13 `praxis_sync_offer_dismissed`: sync offer closed

JSON `true` once a guest closes the offer to sign in and sync (`src/a/ui/Completion.tsx:37`). Retention: until deleted.

## 5. Records kept in the tab (`sessionStorage`)

### 5.1 `praxis_lab_a_face`: the Style DNA photo

A JSON string holding a JPEG data URL, at most 900 pixels on the long edge (`shrinkImage`, `src/a/lib/image.ts:14`). Written whenever the face image in the journey changes (`src/a/lib/journey.tsx:63`). Deleted by `deleteImages("face_colour")` (`src/core/images.ts:195`), by withdrawing consent, by "Delete everything", or when the tab closes. It is never written to `localStorage`, to the Style DNA, to saved looks or to analytics.

### 5.2 `praxis_dna_draft`: Style DNA not saved yet

A `StyleProfile` (section 6.3) while it is being built or changed (`src/a/lib/dnaDraft.ts:16`). Read back only if it passes `isProfile`. No photo. Gone with the tab.

### 5.3 `praxis_lab_a_removed`: undo after removing a look

The `SavedLook` just removed (section 4.1), kept so Undo works after a reload (`src/a/screens/Looks.tsx:30`). Cleared after 6 seconds or when the screen unmounts.

### 5.4 `praxis_lab_a_item`: the piece the customer owns

```ts
// src/a/lib/journeyContext.ts:41
interface OwnedItem {
  slot: "top" | "bottom" | "shoes" | "extras";
  name: string;
  image: string | null;   // JPEG data URL, at most 900 px long edge, or null
}
```

`deleteImages("wardrobe_garment")` sets `image` to `null` and keeps the name (`src/core/images.ts:199`). The matching `praxis_wardrobe` entry (4.11) is unaffected because it never had the photo.

### 5.5 `praxis_visit`: visit counted

JSON `true` once `noteVisit` has counted this tab's visit (`src/core/identity.ts:52`).

### 5.6 `praxis_events_once`: once-per-visit events

An array of `"${eventName}:${onceKey}"` strings, so an event marked `once` is recorded a single time per tab (`src/core/analytics.ts:200`). Capped at the newest 400.

### 5.7 `praxis_sim`: test mode

A plain string, one of the keys of `SIM_SCENARIOS` (`src/core/sim.ts:9`): `fast`, `slow`, `timeout`, `failure`, `partial`, `empty`, `invalid_image`, `unavailable_products`. Any other value reads as off. Set only from `/internal/analytics`.

## 6. Shared types used inside the records

### 6.1 Owner

```ts
// src/core/account.ts:9
interface Owner {
  anonymousSessionId: string;
  userId?: string;   // present once the record belongs to an account
}
```

Used by saved looks and wardrobe entries. Feedback carries the same two fields at the top level instead.

### 6.2 Attribute layers

```ts
// src/core/styleProfile.ts:15
interface Attribute<T> {
  inferred?:  { value: T; source: "sample" | "model"; adapter: string; at: string };
  confirmed?: { value: T; at: string };
  corrected?: { value: T; at: string };
}
```

The value in use is `corrected`, else `confirmed`, else `inferred` (`valueOf`, `src/core/styleProfile.ts:41`). A new analysis replaces only `inferred` (`applyAnalysis`, `src/core/styleProfile.ts:78`).

### 6.3 StyleProfile

```ts
// src/core/styleProfile.ts:21
interface StyleProfile {
  profileId: string;           // "dna_..."
  version: number;             // +1 on every change (bump, src/core/styleProfile.ts:52)
  createdAt: string;
  updatedAt: string;
  photo: "own" | "sample" | "none";   // which photo the estimate came from; never the photo
  undertone: Attribute<"cool" | "warm" | "neutral">;
  contrast:  Attribute<"high" | "medium" | "low">;
  fit:       Attribute<"SLIM" | "REGULAR" | "RELAXED">;
  week:      Attribute<"OFFICE" | "SOCIAL" | "CASUAL" | "MIXED">;
  tastes: string[];            // inspiration preset ids
}
```

Requests name the profile as `${profileId}_v${version}` (`profileRef`, `src/core/styleProfile.ts:135`) and send `summarize(p)` (`src/core/styleProfile.ts:139`), which keeps only the value and its basis per attribute.

### 6.4 Look (saved view model)

A saved look stores the screen's view model, not the raw `OutfitRecommendation`. Fields from `src/shared/catalog.ts:106` and `:129`:

```ts
interface Look {
  id: string;
  occasion: OccasionId;
  role: "classic" | "sharper" | "relaxed";
  title: string;
  image: string;             // path of a catalogue photo, not a personal photo
  why: string;
  pieces: Piece[];
  total: number;
  rank?: number;
  summary?: string;
  factors?: RecommendationFactor[];
  priceStatus?: PriceStatus;
  imageFidelity?: "exact" | "representative";
}

interface Piece {
  id: string;                // garmentId
  slot: "top" | "bottom" | "shoes" | "extras";
  name: string;
  vendor: string;            // retailer name, or "Your wardrobe"
  price: number;
  owned?: boolean;
  priceStatus?: PriceStatus;
  availability?: Availability;
  sizes?: string[];
  sizeAvailability?: Record<string, Availability>;
  category?: string;
  retailerId?: string;
  purchase?: PurchaseRoute;
  deliveryEstimate?: string;
}
```

Prices and stock in a saved look are a snapshot from when it was saved.

## 7. Migrations

There is no schema version field on any store. Migrations are done by shape detection when a record is read.

### 7.1 Saved looks from earlier builds

`normalise` (`src/shared/store.ts:48`) runs on every read of `praxis_lab_a`:

| Old shape | New shape |
|---|---|
| `look.role === "hero"` | `"classic"` |
| `tryOnImage` present (a stand-in try-on picture) | field dropped |
| `dedupeKey` missing | built with `legacyKey(look, occasionLabel)` |
| `owner` missing | left missing; the look counts as a guest look on this device and is claimed at sign in |

### 7.2 Legacy Style DNA

Earlier builds stored a `LegacyDna` under `dna`, with a fixed sample colour result and the portrait as a data URL:

```ts
// src/core/styleProfile.ts:192
interface LegacyDna {
  createdAt: string;
  tones?: { undertone?: Undertone; contrast?: Contrast };
  fit: Fit | null;
  lifestyle: Week | null;
  presetIds?: string[];
  portrait?: string;   // data URL in early builds
}
```

`readDna` (`src/shared/store.ts:60`) keeps a value that passes `isProfile`, and sends anything else with a `createdAt` through `fromLegacy` (`src/core/styleProfile.ts:201`):

| Legacy field | Profile field |
|---|---|
| `createdAt` | `createdAt`, `updatedAt`, and every `at` |
| (new) | `profileId` from `newId("dna")`, `version: 1` |
| `portrait` starting with `data:` | `photo: "own"`, otherwise `"sample"`; the portrait itself is not carried over |
| `tones.undertone`, `tones.contrast` | `inferred` with `source: "sample"`, `adapter: "legacy-sample"` (an estimate, not a confirmed value) |
| `fit` | `fit.confirmed` |
| `lifestyle` | `week.confirmed` |
| `presetIds` | `tastes` |

On first mount, `useLabStore` checks the raw string for `"portrait"` or `"tones"` and, if found, rewrites the store once with the migrated state (`src/shared/store.ts:103`), so the old portrait leaves `localStorage`. The profile id made during the first read is the one written.

### 7.3 Guest to account at sign in

`signIn` in `src/a/lib/journey.tsx:37` runs three migrations in order. The rules are pure functions in `src/core/account.ts` and `src/core/data.ts`.

| Step | Function | What moves | De-duplication | On write failure |
|---|---|---|---|---|
| 1. Looks | `migrateLooks` (`src/core/account.ts:36`), written by `migrateToAccount` (`src/shared/store.ts:161`) | Every look with no `owner.userId`, whatever its anonymous id. A look with no owner takes the current anonymous id. | Among the account's looks, the newest per `dedupeKey` is kept. | Nothing changes, `account_migration_failed { part: "looks" }` is tracked and the later steps do not run. |
| 2. Feedback | `migrateFeedback` (`src/core/account.ts:69`), written by `feedbackStore.replaceAll` | Records with no `userId` and this browser's `anonymousSessionId`. | Exact repeats of owner, recommendation, outfit, feedback, reason and garment are dropped. | `account_migration_failed { part: "feedback" }`; the count of moved feedback is reported as 0. |
| 3. Wardrobe | `migrateWardrobe` (`src/core/data.ts:156`), written by `writeWardrobe` | Entries with no `owner.userId` and this browser's anonymous id. | None (entries are already unique by `wardrobeItemId`). | Not checked. |

Records that already belong to another account are never changed. An `account_migrated` event records the counts. Looks are sorted newest first by `savedAt` as part of step 1.

### 7.4 Stand-in user record

`read()` in `src/a/lib/user.ts:27` accepts a record from earlier builds that used `plus` instead of `premium`, and one without `id` (the id is then derived from the email).

## 8. Deleting everything

"Delete everything" on `/data` (`src/a/screens/YourData.tsx:47`) withdraws photo consent for `face_colour` and `wardrobe_garment` (which deletes those photos), then calls `deleteLocalData()` (`src/core/data.ts:81`). That removes every key starting with `praxis_` from both `localStorage` and `sessionStorage`, including any key not in `STORES`. The identity cache is reset, so the next event (`local_data_deleted`) is recorded under a new anonymous id.

Single photos can be deleted on their own (`deletePhoto`, `src/a/screens/YourData.tsx:35`). Saved looks can be removed one by one, and a feedback record can be taken back with Undo (4.8). There is no other per-record delete for feedback, and none for selections, history, wardrobe entries or events, other than "Delete everything" and the internal page's clear button for events (`forgetWardrobeItem`, `src/core/data.ts:151`, exists but no screen calls it).

## 9. Server schema

> **Built (Week 1, 2026-11):** `users`, `consents`, `wardrobe_items`, `saved_looks` and `feedback` (9.2), the catalogue tables `retailers`, `products` and `product_variants` (9.5), and the sign-in tables `sign_in_links`, `sessions` and `account_claims` (9.6). They live in Postgres 16 with pgvector, are created by the SQL migrations in `server/db/migrations` (`npm run db:migrate`), and CI applies, rolls back and re-applies them on every push. No screen uses them yet. **Still proposals:** `anonymous_sessions`, `style_profiles`, `styling_requests`, `recommendations`, `selections`, `image_assets` and `analytics_events`.
>
> Where the built tables differ from the proposal below, the migration is right:
>
> - Every id is a text primary key in the app's `prefix_...` format.
> - Enums are `text` columns with `CHECK` constraints, not Postgres enum types.
> - `users.email` is unique regardless of case, and `users` gains `updated_at`.
> - `wardrobe_items` is keyed by `wardrobe_item_id` alone (ids are random). It also allows `source = 'described'` and adds `colour` and `updated_at`, as `WardrobeEntry` does today. It has no `image_asset_id` yet.
> - `consents.category` is free text, so the account consents of sign-up can join the image categories.
> - `saved_looks.request_id` and `recommendation_id` have no foreign key, because the styling history stays in the browser for now.

### 9.1 Where it would plug in

The code already has the seams a backend would use. Each is an interface or a single function today:

| Concern | Interface or function in code | Today |
|---|---|---|
| Recommendations and request history | `RecommendationAdapter` (`src/core/service.ts:15`), `RequestHistory` (`src/core/service.ts:110`) | Mock adapter, history in `praxis_styling_history` |
| Feedback | `FeedbackStore` (`src/core/feedback.ts:36`) | `praxis_feedback` |
| Analytics | `AnalyticsSink` (`src/core/analytics.ts:116`), added with `addSink` | Local sink, `praxis_events` |
| Product data | `RetailerAdapter` (`src/core/retail.ts:24`) | `createMockRetailer` |
| Image analysis and generated images | `ColourAnalysisAdapter` and the other adapters in `src/core/vision.ts`, `GeneratedImage` (`src/core/vision.ts:47`) | Mocks, nothing stored |
| Identity | `userIdFor`, `currentUserId` (`src/core/identity.ts`) | Random id per address in this browser |
| Saved looks, Style DNA, wardrobe, selections, consent | Direct storage calls in `src/shared/store.ts`, `src/core/data.ts`, `src/core/images.ts` | No interface yet; a backend would need one added |

### 9.2 Tables

Types are written generically: `id` is a text primary key in the app's existing `prefix_...` format, `time` is a timestamp with time zone, `json` is a JSON document column.

#### users

From `LabUser` (4.2) and the account map (4.3).

| Column | Type | From |
|---|---|---|
| `user_id` | id, primary key | `LabUser.id` |
| `email` | text, unique | `LabUser.email` (the identity provider would own this) |
| `display_name` | text | `LabUser.name` |
| `premium` | boolean | `LabUser.premium` (a real entitlement would come from the payment provider and be checked server side) |
| `created_at` | time | new |

`praxis_lab_a_accounts` has no server equivalent: the identity provider's user id replaces it.

#### anonymous_sessions

From `AnonRecord` (4.6).

| Column | Type | From |
|---|---|---|
| `anonymous_session_id` | id, primary key | `id` |
| `first_seen_at` | time | `firstSeenAt` |
| `last_seen_at` | time | `lastSeenAt` |
| `visits` | integer | `visits` |
| `user_id` | id, nullable, references `users` | set at sign in (7.3) |

#### style_profiles and style_profile_attributes

From `StyleProfile` (6.3) and `Attribute<T>` (6.2). The three layers stay separate columns so a new estimate never overwrites a correction.

`style_profiles`

| Column | Type | From |
|---|---|---|
| `profile_id` | id, primary key | `profileId` |
| `owner_user_id` | id, nullable | owner (the browser keeps one profile per store, not per owner) |
| `owner_anonymous_session_id` | id | owner |
| `version` | integer | `version` |
| `photo_basis` | enum `own`, `sample`, `none` | `photo` |
| `tastes` | text array | `tastes` |
| `created_at`, `updated_at` | time | `createdAt`, `updatedAt` |

`style_profile_attributes` (one row per profile and attribute)

| Column | Type | From |
|---|---|---|
| `profile_id` | id, references `style_profiles` | |
| `attribute` | enum `undertone`, `contrast`, `fit`, `week` | field name |
| `inferred_value` | text, nullable | `inferred.value` |
| `inferred_source` | enum `sample`, `model`, nullable | `inferred.source` |
| `inferred_adapter` | text, nullable | `inferred.adapter` |
| `inferred_at` | time, nullable | `inferred.at` |
| `confirmed_value`, `confirmed_at` | text, time, nullable | `confirmed` |
| `corrected_value`, `corrected_at` | text, time, nullable | `corrected` |

Primary key: (`profile_id`, `attribute`). Requests reference a profile as `profile_id` plus `version`, so keeping past versions (or a history table keyed by version) would be needed for a request to point at the exact profile it used. Retention: until deleted (`RETENTION.styleDna`).

#### saved_looks

From `SavedLook` (4.1).

| Column | Type | From |
|---|---|---|
| `saved_look_id` | id, primary key | `id` |
| `owner_user_id` | id, nullable | `owner.userId` |
| `owner_anonymous_session_id` | id | `owner.anonymousSessionId` |
| `recommendation_id` | id, nullable, references `recommendations` | `recommendationId` |
| `request_id` | id, nullable, references `styling_requests` | `requestId` |
| `outfit_id` | text | `look.id` |
| `input_key` | text, nullable | `inputKey` |
| `occasion_label` | text | `occasionLabel` |
| `look_snapshot` | json | `look` (prices and stock as they were when saved) |
| `dedupe_key` | text | `dedupeKey` |
| `saved_at` | time | `savedAt` |

Unique (`owner_user_id`, `dedupe_key`) where `owner_user_id` is set, matching the sign in rule in 7.3. Retention: until deleted (`RETENTION.savedLooks`).

#### styling_requests

From `StylingRequest` (4.7).

| Column | Type | From |
|---|---|---|
| `request_id` | id, primary key | `requestId` |
| `input_key` | text, indexed | `inputKey` |
| `contract_version` | text | `contractVersion` |
| `journey` | text | `journey` |
| `anonymous_session_id` | id | `anonymousSessionId` |
| `user_id` | id, nullable | `userId` |
| `occasion`, `time_of_day`, `preferred_vibe` | enums | same names |
| `venue` | json | `venue` |
| `budget_band`, `budget_min`, `budget_max`, `currency` | enum, numbers, text | `budget` |
| `style_profile_ref` | text, nullable | `styleProfileId` |
| `style_profile_summary` | json, nullable | `styleProfile` |
| `wardrobe_item_ids` | text array | `wardrobeItems[].wardrobeItemId` |
| `preferences` | json, nullable | `preferences` |
| `location` | json, nullable | `location` |
| `generated_at` | time | `generatedAt` |

Retention: 90 days (`RETENTION.stylingHistory`).

#### recommendations and recommendation_outfits

From `StylingResponse` and `OutfitRecommendation` (4.7).

`recommendations`

| Column | Type | From |
|---|---|---|
| `recommendation_id` | id, primary key | `recommendationId` |
| `request_id` | id, references `styling_requests` | `requestId` |
| `input_key` | text | `inputKey` |
| `contract_version` | text | `contractVersion` |
| `adapter_id`, `adapter_version` | text | `adapter` |
| `mode` | enum `demonstration`, `personalized` | `mode` |
| `status` | enum `completed`, `partial`, `empty`, `failed` | `status` |
| `fallback` | json, nullable | `fallback` |
| `error_code`, `error_message`, `error_retryable` | nullable | `error` |
| `created_at` | time | `createdAt` |

`recommendation_outfits`

| Column | Type | From |
|---|---|---|
| `recommendation_id` | id, references `recommendations` | |
| `outfit_id` | text | `outfitId` |
| `rank` | integer | `rank` |
| `role` | enum `classic`, `sharper`, `relaxed` | `role` |
| `title`, `rationale` | text | same names |
| `explanation` | json | `explanation` |
| `garments` | json | `garments` (retail garments carry a `ProductRef`; wardrobe garments carry a `wardrobeItemId`) |
| `visualization` | json | `visualization` |
| `pricing_total`, `pricing_currency`, `pricing_status` | number, text, enum | `pricing` |

Primary key: (`recommendation_id`, `outfit_id`). Retention: 90 days, same as requests. A live product catalogue would be its own set of tables owned by the retailer integration and is out of scope here.

#### feedback

From `OutfitFeedback` (4.8).

| Column | Type | From |
|---|---|---|
| `feedback_id` | id, primary key | `eventId` |
| `anonymous_session_id` | id | `anonymousSessionId` |
| `user_id` | id, nullable | `userId` |
| `recommendation_id` | id | `recommendationId` |
| `request_id` | id | `requestId` |
| `outfit_id` | text | `outfitId` |
| `garment_id` | text, nullable | `garmentId` |
| `feedback` | enum `more_like_this`, `not_for_me` | `feedback` |
| `reason` | enum, nullable | `reason` |
| `adapter_id`, `adapter_version` | text | `adapter` |
| `created_at` | time | `createdAt` |

Undo is a delete by `feedback_id`. Retention: 365 days (`RETENTION.feedback`).

#### selections

From `SelectionRecord` (4.10).

| Column | Type | From |
|---|---|---|
| `recommendation_id` | id | `recommendationId` |
| `owner_user_id` / `owner_anonymous_session_id` | id | not stored today (the browser store has one owner); a server needs it |
| `outfit_id` | text | `outfitId` |
| `selected_at` | time | `at` |

Primary key: (`recommendation_id`, owner), newest wins as today. Retention: 90 days (`RETENTION.selections`).

#### wardrobe_items

From `WardrobeEntry` (4.11).

| Column | Type | From |
|---|---|---|
| `wardrobe_item_id` | id | `wardrobeItemId` |
| `owner_user_id` | id, nullable | `owner.userId` |
| `owner_anonymous_session_id` | id | `owner.anonymousSessionId` |
| `slot` | enum `top`, `bottom`, `shoes`, `extras` | `slot` |
| `label` | text | `label` |
| `source` | enum `sample`, `upload` | `source` |
| `image_asset_id` | id, nullable, references `image_assets` | not stored today (photos stay in the tab) |
| `added_at` | time | `addedAt` |

Primary key: (owner, `wardrobe_item_id`). Retention: until deleted (`RETENTION.wardrobe`).

#### image_assets

There is no stored image record today. Personal photos live only in the tab (5.1, 5.4) and no generated images are produced. This table combines the policy fields in `ImagePolicy` (`src/core/images.ts:18`) with `GeneratedImage` (`src/core/vision.ts:47`) for when images are processed on a server.

| Column | Type | From |
|---|---|---|
| `image_id` | id, primary key | `GeneratedImage.imageId` |
| `owner_user_id` / `owner_anonymous_session_id` | id | owner |
| `category` | enum `face_colour`, `body_fit`, `wardrobe_garment`, `try_on`, `styled_visualization` | `ImageCategory`, `GeneratedImage.kind` |
| `outfit_id` | text, nullable | `GeneratedImage.outfitId` |
| `source_garment_ids` | text array, nullable | `GeneratedImage.sourceGarmentIds` |
| `provider`, `model_version` | text, nullable | `GeneratedImage.provider`, `modelVersion` |
| `status` | enum `ready`, `pending`, `failed`, `disabled` | `GeneratedImage.status` |
| `width`, `height` | integer, nullable | same names |
| `storage_ref` | text | `GeneratedImage.storageRef` |
| `consent_version` | text, nullable | `ImagePolicy.consentVersion` at upload |
| `created_at` | time | `createdAt` |
| `delete_after` | time, nullable | `GeneratedImage.retention.deleteAfter`, or `created_at` plus `ImagePolicy.retention.maxDays` |
| `deletable` | boolean | `GeneratedImage.retention.deletable` |

A scheduled job would delete rows and stored files past `delete_after`. Withdrawing consent for a category would delete that owner's assets of that category, as `withdrawConsent` does in the browser. Derived attributes (an undertone estimate) live in `style_profile_attributes`, not here, so deleting a photo does not need to touch the profile, matching `applyAnalysis`.

#### consents

From `ConsentRecord` (4.12). The browser keeps only the latest grant per category; a server should keep the history.

| Column | Type | From |
|---|---|---|
| `consent_id` | id, primary key | new |
| `owner_user_id` / `owner_anonymous_session_id` | id | owner |
| `category` | enum, as `ImageCategory` | `category` |
| `version` | text | `version` |
| `granted_at` | time | `grantedAt` |
| `withdrawn_at` | time, nullable | new (the browser removes the record instead) |

The current consent is the newest row for the owner and category whose `version` equals the policy's `consentVersion` and whose `withdrawn_at` is empty, the same rule as `consentFor`.

#### analytics_events

From `PraxisAnalyticsEvent` (4.9). In code this would be fed by a new `AnalyticsSink`.

| Column | Type | From |
|---|---|---|
| `event_id` | id, primary key | `eventId` |
| `event_name` | text | `eventName` |
| `timestamp` | time | `timestamp` |
| `anonymous_session_id` | id | `anonymousSessionId` |
| `user_id` | id, nullable | `userId` |
| `journey` | enum, nullable | `journey` |
| `recommendation_id`, `outfit_id` | text, nullable | same names |
| `properties` | json | `properties` |
| `application_version` | text | `applicationVersion` |
| `test_mode` | text, nullable | `testMode` (rows with a value are excluded from measures) |

Retention: 90 days (`RETENTION.events`).

### 9.5 The product catalogue (built)

Filled by retailer imports (`server/retailers`, Week 1 phase 3). Migration `1762200000300_retailers-products-variants.sql`.

`retailers`: `retailer_id` (primary key), `name`, `kind` (`shopify` or `csv`), `source` (store address or file), `currency`, `created_at`, `last_imported_at`.

`products`: one retailer's piece. Unique on (`retailer_id`, `external_id`), so an import updates a piece in place.

| Column | Type | Notes |
|---|---|---|
| `product_id` | id, primary key | |
| `retailer_id` | id, references `retailers`, cascade | |
| `external_id` | text | the retailer's own id |
| `title`, `brand`, `description`, `product_url` | text | |
| `images` | json array | the retailer's photos |
| `slot`, `layer`, `subcategory` | text | from the shared ontology (`src/shared/ontology.mjs`); `slot` is `top`, `bottom`, `shoes` or `extras` (a jacket is `top` with `layer = 'outer'`); null when the piece doesn't map, and such a piece is never styled |
| `colour` | text | colour family |
| `price_amount`, `currency` | numeric(12,2), char(3) | the lowest variant price |
| `cutout_url` | text, nullable | the cut-out PNG in the bucket (Week 1 phase 4) |
| `embedding` | vector(768), nullable | normalised image embedding; HNSW index with `vector_cosine_ops` |
| `first_seen_at`, `last_seen_at`, `updated_at` | time | |
| `removed_at` | time, nullable | set when the piece leaves the feed; it is never deleted |

`product_variants`: size, price and stock. Unique on (`product_id`, `external_id`).

| Column | Type | Notes |
|---|---|---|
| `variant_id` | id, primary key | |
| `product_id` | id, references `products`, cascade | |
| `external_id`, `size`, `colour`, `sku` | text | |
| `price_amount`, `currency` | numeric(12,2), char(3) | |
| `available` | boolean | in stock |
| `stock_quantity` | integer, nullable | null when the retailer only says in or out (Shopify's public list) |
| `updated_at` | time | |

A partial index on (`product_id`, `size`) where `available` serves "in stock in my size".

### 9.6 Sign-in, sessions and the hand-over (built)

Migration `1762200000500_sign-in-and-sessions.sql`, used by `server/auth` when the page is built with `VITE_AUTH=magic-link`.

- `sign_in_links`: one row per emailed link. Holds `token_hash` (the sha256 of the token; the token itself is only in the email), the lowercased `email`, the `anonymous_session_id` the link was asked for from, the `consents` agreed on the form, `expires_at` (15 minutes) and `used_at` (set by the first use).
- `sessions`: one per sign-in. Holds `session_hash` (the sha256 of the cookie's token), `user_id`, `expires_at` (30 days), `last_seen_at` and `revoked_at` (sign out).
- `account_claims`: one per (`user_id`, `anonymous_session_id`): the guest-to-account hand-over, done once, with `looks_moved` and `looks_duplicate`. A guest id can only be claimed by the account whose link was asked for from it.

The browser keeps `praxis_signin_pending` (where to come back to after the emailed link) until the link is used.

At sign-up, `consents` gets one row per account consent agreed on the form (`terms`, `privacy`, at the versions in `src/shared/consents.mjs`), with `granted_at`. A returning sign-in adds a row only for a version the account doesn't already hold. Withdrawing sets `withdrawn_at` (not built in the page yet).

### 9.3 Not carried to a server

These stores are device or tab conveniences and have no table in the proposal: `praxis_lab_a_mode`, `praxis_lab_a_viewer_hint`, `praxis_sync_offer_dismissed`, `praxis_dna_draft`, `praxis_lab_a_removed`, `praxis_visit`, `praxis_events_once`, `praxis_sim`, and `praxis_lab_a_accounts` (replaced by the identity provider).

### 9.4 Moving browser data to a server

If a backend is added, the existing guest to account rules (7.3) would apply when uploading this browser's stores for the first time: claim records with no `userId` that belong to this anonymous id, keep the newest look per `dedupe_key`, drop exact feedback repeats, and leave other accounts' records alone. Photos in the tab would not be uploaded without a new consent under a policy whose `processing` and `retention` say they leave the device.
