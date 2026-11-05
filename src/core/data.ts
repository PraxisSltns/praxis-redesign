/**
 * What Praxis remembers in this browser between visits, and for how long. Each store has a key, a
 * kind (kept on the device, or only in this tab) and a retention period from RETENTION, so a future
 * data-retention policy changes one table. Photos are never in a device store: they stay in the tab
 * (see images.ts). deleteLocalData removes everything Praxis keeps here.
 */
import type { WardrobeItemRef } from "./contracts";
import type { Owner } from "./account";
import { local, readJson, session, writeJson } from "./ids";

/** Days each kind of record is kept before it is pruned. Null keeps it until the customer deletes it. */
export const RETENTION = {
  stylingHistory: 90,
  feedback: 365,
  events: 90,
  selections: 90,
  wardrobe: null,
  savedLooks: null,
  styleDna: null,
} as const;

export interface StoreInfo {
  key: string;
  where: "device" | "tab";
  holds: string;
  personal: "none" | "preferences" | "photo";
}

/** Every key Praxis writes, for the README, the internal page and deletion. */
export const STORES: readonly StoreInfo[] = [
  { key: "praxis_lab_a", where: "device", holds: "Saved looks and Style DNA profiles, each with its owner (version 2)", personal: "preferences" },
  { key: "praxis_lab_a_unreadable", where: "device", holds: "A copy of saved looks that could not be read, kept before they were written over", personal: "preferences" },
  { key: "praxis_lab_a_premium", where: "device", holds: "Which stand-in accounts have Premium", personal: "none" },
  { key: "praxis_lab_a_user", where: "device", holds: "The stand-in account", personal: "preferences" },
  { key: "praxis_lab_a_accounts", where: "device", holds: "Stand-in account ids by address", personal: "preferences" },
  { key: "praxis_lab_a_mode", where: "device", holds: "Light or dark", personal: "none" },
  { key: "praxis_lab_a_viewer_hint", where: "device", holds: "Whether the zoom hint was shown", personal: "none" },
  { key: "praxis_anon", where: "device", holds: "The anonymous visitor id", personal: "none" },
  { key: "praxis_styling_history", where: "device", holds: "Styling requests and their looks", personal: "preferences" },
  { key: "praxis_feedback", where: "device", holds: "More like this and Not for me", personal: "preferences" },
  { key: "praxis_events", where: "device", holds: "Analytics events", personal: "none" },
  { key: "praxis_selections", where: "device", holds: "Which look was chosen in each set", personal: "preferences" },
  { key: "praxis_wardrobe", where: "device", holds: "Pieces you own, by name and type (no photos)", personal: "preferences" },
  { key: "praxis_image_consent", where: "device", holds: "Which photo uses you agreed to", personal: "none" },
  { key: "praxis_sync_offer_dismissed", where: "device", holds: "Whether the sync offer was closed", personal: "none" },
  { key: "praxis_signin_pending", where: "device", holds: "A sign-in link waiting to be opened: where to come back to (removed when it's used)", personal: "none" },
  { key: "praxis_lab_a_face", where: "tab", holds: "Your Style DNA photo", personal: "photo" },
  { key: "praxis_dna_draft", where: "tab", holds: "A Style DNA not saved yet (no photo)", personal: "preferences" },
  { key: "praxis_lab_a_removed", where: "tab", holds: "A look just removed, for Undo", personal: "preferences" },
  { key: "praxis_lab_a_item", where: "tab", holds: "The piece you own, with its photo", personal: "photo" },
  { key: "praxis_wardrobe_photos", where: "tab", holds: "Photos of pieces in your wardrobe", personal: "photo" },
  { key: "praxis_tryon_photo", where: "tab", holds: "Your See it on me photo", personal: "photo" },
  { key: "praxis_tryon_request", where: "tab", holds: "The last try-on request and its answer (no photo)", personal: "none" },
  { key: "praxis_visit", where: "tab", holds: "Whether this visit was counted", personal: "none" },
  { key: "praxis_events_once", where: "tab", holds: "Events already counted this visit", personal: "none" },
  { key: "praxis_sim", where: "tab", holds: "Test mode", personal: "none" },
  { key: "praxis_errors_sent", where: "tab", holds: "Which errors this tab already reported (names only)", personal: "none" },
];

const DAY = 86_400_000;

/** Drops records older than their retention period. Returns how many went. */
export function pruneByAge<T>(records: readonly T[], days: number | null, dateOf: (r: T) => string | undefined, now = new Date()): T[] {
  if (days === null) return [...records];
  const cutoff = now.getTime() - days * DAY;
  return records.filter((r) => {
    const t = Date.parse(dateOf(r) ?? "");
    return Number.isNaN(t) || t >= cutoff;
  });
}

/** Applies RETENTION to the stores that hold dated records. Run once at start. */
export function pruneExpired(storage: () => Storage | undefined = local, now = new Date()): void {
  const s = storage();
  const prune = <T>(key: string, days: number | null, dateOf: (r: T) => string | undefined) => {
    const records = readJson<T[]>(s, key);
    if (!Array.isArray(records)) return;
    const kept = pruneByAge(records, days, dateOf, now);
    if (kept.length !== records.length) writeJson(s, key, kept);
  };
  prune<{ response?: { createdAt?: string } }>("praxis_styling_history", RETENTION.stylingHistory, (r) => r.response?.createdAt);
  prune<{ createdAt?: string }>("praxis_feedback", RETENTION.feedback, (r) => r.createdAt);
  prune<{ timestamp?: string }>("praxis_events", RETENTION.events, (r) => r.timestamp);
  prune<{ at?: string }>("praxis_selections", RETENTION.selections, (r) => r.at);
}

/** Removes everything Praxis keeps in this browser, on the device and in the tab. */
export function deleteLocalData(storages: Array<() => Storage | undefined> = [local, session]): number {
  let removed = 0;
  for (const get of storages) {
    const s = get();
    if (!s) continue;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k && k.startsWith("praxis_")) keys.push(k);
    }
    for (const k of keys) {
      try {
        s.removeItem(k);
        removed += 1;
      } catch {
        // A key that cannot be removed stays; the rest still go.
      }
    }
  }
  return removed;
}

/* ------------------------------------------------------------ selections */

export interface SelectionRecord {
  recommendationId: string;
  outfitId: string;
  at: string;
}

const SELECTIONS_KEY = "praxis_selections";
const SELECTIONS_LIMIT = 100;

/** Which look the customer had in front in each set of looks; the newest per set is kept. */
export function recordSelection(recommendationId: string, outfitId: string, storage: () => Storage | undefined = local, now = new Date()): void {
  const s = storage();
  const rest = (readJson<SelectionRecord[]>(s, SELECTIONS_KEY) ?? []).filter((r) => r.recommendationId !== recommendationId);
  writeJson(s, SELECTIONS_KEY, [{ recommendationId, outfitId, at: now.toISOString() }, ...rest].slice(0, SELECTIONS_LIMIT));
}

export function lastSelection(recommendationId: string, storage: () => Storage | undefined = local): string | null {
  return (readJson<SelectionRecord[]>(storage(), SELECTIONS_KEY) ?? []).find((r) => r.recommendationId === recommendationId)?.outfitId ?? null;
}

/* -------------------------------------------------------------- wardrobe */

export interface WardrobeEntry extends WardrobeItemRef {
  addedAt: string;
  updatedAt?: string;
  owner: Owner;
}

const WARDROBE_KEY = "praxis_wardrobe";
const WARDROBE_LIMIT = 50;

export function wardrobeEntries(storage: () => Storage | undefined = local): WardrobeEntry[] {
  return readJson<WardrobeEntry[]>(storage(), WARDROBE_KEY) ?? [];
}

/** Remembers a piece by name and type. Its photo is never written here. */
export function rememberWardrobeItem(ref: WardrobeItemRef, owner: Owner, storage: () => Storage | undefined = local, now = new Date()): WardrobeEntry {
  const entry: WardrobeEntry = { wardrobeItemId: ref.wardrobeItemId, slot: ref.slot, label: ref.label, source: ref.source, addedAt: now.toISOString(), owner };
  if (ref.colour) entry.colour = ref.colour;
  const rest = wardrobeEntries(storage).filter((e) => e.wardrobeItemId !== ref.wardrobeItemId);
  writeJson(storage(), WARDROBE_KEY, [entry, ...rest].slice(0, WARDROBE_LIMIT));
  return entry;
}

export function writeWardrobe(entries: readonly WardrobeEntry[], storage: () => Storage | undefined = local): boolean {
  return writeJson(storage(), WARDROBE_KEY, entries);
}

export function forgetWardrobeItem(id: string, storage: () => Storage | undefined = local, tab: () => Storage | undefined = session): boolean {
  setWardrobePhoto(id, null, tab);
  return writeJson(storage(), WARDROBE_KEY, wardrobeEntries(storage).filter((e) => e.wardrobeItemId !== id));
}

export type WardrobeEdit = Partial<Pick<WardrobeEntry, "label" | "slot" | "colour">>;

/** Changes a piece's name, type or colour. Its id stays, so it stays the same piece. */
export function updateWardrobeItem(id: string, edit: WardrobeEdit, storage: () => Storage | undefined = local, now = new Date()): WardrobeEntry | null {
  const entries = wardrobeEntries(storage);
  const at = entries.findIndex((e) => e.wardrobeItemId === id);
  if (at < 0) return null;
  const next: WardrobeEntry = { ...entries[at], updatedAt: now.toISOString() };
  if (edit.label !== undefined) next.label = edit.label.trim().slice(0, 60) || entries[at].label;
  if (edit.slot !== undefined) next.slot = edit.slot;
  if (edit.colour !== undefined) {
    const colour = edit.colour.trim().slice(0, 30);
    if (colour) next.colour = colour;
    else delete next.colour;
  }
  const out = [...entries];
  out[at] = next;
  return writeJson(storage(), WARDROBE_KEY, out) ? next : null;
}

/* ------------------------------------------------- wardrobe photos (tab) */

const WARDROBE_PHOTOS_KEY = "praxis_wardrobe_photos";
/** Photos are large; the tab keeps the most recent few. */
const WARDROBE_PHOTOS_LIMIT = 8;

/** A piece's photo, if it was added in this tab. Photos never reach the device store. */
export function wardrobePhoto(id: string, tab: () => Storage | undefined = session): string | null {
  return readJson<Record<string, string>>(tab(), WARDROBE_PHOTOS_KEY)?.[id] ?? null;
}

export function setWardrobePhoto(id: string, image: string | null, tab: () => Storage | undefined = session): boolean {
  const all = { ...(readJson<Record<string, string>>(tab(), WARDROBE_PHOTOS_KEY) ?? {}) };
  delete all[id];
  const ids = Object.keys(all);
  if (image) {
    for (const old of ids.slice(0, Math.max(0, ids.length - WARDROBE_PHOTOS_LIMIT + 1))) delete all[old];
    all[id] = image;
  }
  return writeJson(tab(), WARDROBE_PHOTOS_KEY, all);
}

/** At sign-in, this browser's guest pieces join the account. */
export function migrateWardrobe(entries: readonly WardrobeEntry[], userId: string, anonymousSessionId: string): { entries: WardrobeEntry[]; moved: number } {
  let moved = 0;
  const out = entries.map((e) => {
    if (e.owner.userId || e.owner.anonymousSessionId !== anonymousSessionId) return e;
    moved += 1;
    return { ...e, owner: { anonymousSessionId, userId } };
  });
  return { entries: out, moved };
}

