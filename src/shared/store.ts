/**
 * Saved looks and saved Style DNA profiles, kept in this browser. Saving needs no account: each record
 * is owned by the anonymous id, and signing in moves this guest's records onto the account without
 * duplicates (src/core/account.ts). Each person sees only their own records: an account's stay hidden
 * from guests and other accounts, and a guest's are hidden once they sign out (the anonymous id
 * changes then).
 *
 * Every change re-reads storage first and writes in one go, so two tabs never overwrite each other,
 * and a change that cannot be written (storage full or blocked) is reported to the caller instead of
 * being lost silently. One unreadable look is skipped, not allowed to wipe the rest; unreadable data is
 * copied aside before anything is written over it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Look } from "./catalog";
import { migrateLooks, reconcileAccountLooks, visibleTo, type Owner, type PendingRemoval } from "../core/account";
import { anonymousId } from "../core/identity";
import { fromLegacy, isProfile, type LegacyDna, type StyleProfile } from "../core/styleProfile";

export interface SavedLook {
  id: string;
  savedAt: string;
  look: Look;
  occasionLabel: string;
  /** Earlier builds saved a stand-in try-on picture here; it is no longer saved or shown. */
  tryOnImage?: string;
  recommendationId?: string;
  requestId?: string;
  inputKey?: string;
  owner?: Owner;
  /** The same look for the same brief has the same key; used to keep one copy at sign-in. */
  dedupeKey: string;
  /** With a real account: the server is known to hold this look (src/core/account.ts reconcileAccountLooks). */
  synced?: boolean;
}

/** A Style DNA profile and who it belongs to. Never holds a photo. */
export interface OwnedProfile {
  profile: StyleProfile;
  owner?: Owner;
}

export const STORE_VERSION = 2;

interface LabState {
  version: number;
  looks: SavedLook[];
  /** Style DNA profiles (src/core/styleProfile.ts), one per person at most. */
  profiles: OwnedProfile[];
  /** Account looks removed here whose removal hasn't reached the server yet. */
  pendingRemovals?: PendingRemoval[];
}

const EMPTY: LabState = { version: STORE_VERSION, looks: [], profiles: [] };

const isPending = (p: unknown): p is PendingRemoval => !!p && typeof (p as PendingRemoval).userId === "string" && typeof (p as PendingRemoval).dedupeKey === "string";

function keyFor(concept: string): string {
  return `praxis_lab_${concept}`;
}

function legacyKey(look: Look, occasionLabel: string): string {
  const owned = look.pieces
    .filter((p) => p.owned)
    .map((p) => `${p.slot}:${p.name}`)
    .join("+");
  return `${look.id}|${occasionLabel}|${owned}`;
}

/** Brings looks saved by earlier builds up to date: role names, keys, and no stand-in try-on picture. */
function normalise(s: SavedLook): SavedLook {
  const role = (s.look.role as string) === "hero" ? "classic" : s.look.role;
  const { tryOnImage: _dropped, ...rest } = s;
  void _dropped;
  return { ...rest, look: { ...s.look, role }, dedupeKey: s.dedupeKey ?? legacyKey(s.look, s.occasionLabel) };
}

/**
 * A Style DNA saved by an earlier build had a fixed sample result and kept the portrait in this
 * browser's storage. It comes back as a profile whose colours are an estimate, and the portrait is
 * dropped (rewritten on the next save).
 */
function readDna(raw: unknown): StyleProfile | null {
  if (!raw || typeof raw !== "object") return null;
  if (isProfile(raw)) return raw;
  if ("createdAt" in raw) return fromLegacy(raw as LegacyDna);
  return null;
}

/** Where unreadable saved data is copied before anything is written over it. */
export function backupKeyFor(concept: string): string {
  return `${keyFor(concept)}_unreadable`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Reads what is saved, or null when storage cannot be used at all. */
export function readState(concept: string): LabState | null {
  const s = storage();
  if (!s) return null;
  let raw: string | null;
  try {
    raw = s.getItem(keyFor(concept));
  } catch {
    return null;
  }
  if (!raw) return EMPTY;
  let parsed: { looks?: unknown; dna?: unknown; profiles?: unknown; pendingRemovals?: unknown };
  try {
    parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
  } catch {
    // Kept aside once, so a later save does not destroy what someone might still recover.
    try {
      if (!s.getItem(backupKeyFor(concept))) s.setItem(backupKeyFor(concept), raw);
    } catch {
      // Nowhere to keep it; the next save still works.
    }
    return EMPTY;
  }
  const looks: SavedLook[] = [];
  for (const l of Array.isArray(parsed.looks) ? parsed.looks : []) {
    try {
      if (l && typeof l === "object" && (l as SavedLook).look && Array.isArray((l as SavedLook).look.pieces)) looks.push(normalise(l as SavedLook));
    } catch {
      // One bad look is skipped; the others stay.
    }
  }
  const profiles: OwnedProfile[] = [];
  if (Array.isArray(parsed.profiles)) {
    for (const p of parsed.profiles as OwnedProfile[]) {
      const profile = readDna(p?.profile);
      if (profile) profiles.push({ profile, owner: p.owner });
    }
  } else {
    // Version 1 kept one profile with no owner; whoever is here when it is read keeps it.
    const profile = readDna(parsed.dna);
    if (profile) profiles.push({ profile });
  }
  const pendingRemovals = Array.isArray(parsed.pendingRemovals) ? parsed.pendingRemovals.filter(isPending) : [];
  return { version: STORE_VERSION, looks, profiles, ...(pendingRemovals.length ? { pendingRemovals } : {}) };
}

function write(concept: string, state: LabState): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(keyFor(concept), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export interface SaveMeta {
  owner: Owner;
  recommendationId?: string;
  requestId?: string;
  inputKey?: string;
}

export interface SaveResult {
  ok: boolean;
  entry: SavedLook;
  /** True when this person had already saved the same look for the same brief. */
  existing: boolean;
}

/** The profile this person sees: their account's, or this guest's. */
function profileFor(profiles: readonly OwnedProfile[], userId: string | undefined, anon: string): OwnedProfile | null {
  return profiles.find((p) => p.owner && visibleTo(p, userId, anon)) ?? profiles.find((p) => !p.owner) ?? null;
}

export function useLabStore(concept: string, userId?: string) {
  // Read on the first render, so nothing (a styling request, the gate's steps) ever sees an empty store
  // before the saved Style DNA arrives.
  const [state, setState] = useState<LabState>(() => readState(concept) ?? EMPTY);
  /** The latest state, for when storage cannot be used at all and memory is all there is. */
  const latest = useRef(state);
  latest.current = state;
  const first = useRef(state);

  /* An older save still holding a portrait or the old shape is rewritten once, without the photo, with
     the profile already migrated on the first render (so its id is the one in use). */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(keyFor(concept));
      if (raw && (/"portrait"|"tones"/.test(raw) || !/"version":2/.test(raw))) write(concept, first.current);
    } catch {
      // Storage unavailable; nothing to rewrite.
    }
  }, [concept]);

  /* Records from early builds have no owner. A person already signed in on this device takes them, as
     signing in would have done; a guest keeps them until they sign in. */
  useEffect(() => {
    if (!userId) return;
    const current = readState(concept);
    if (!current) return;
    const anon = anonymousId();
    const looseLooks = current.looks.some((l) => !l.owner);
    const looseProfile = current.profiles.some((p) => !p.owner);
    if (!looseLooks && !looseProfile) return;
    const looks = looseLooks ? migrateLooks(current.looks, userId, anon).looks : current.looks;
    // Claimed ones go last, so a profile the account already has stays the one in use.
    const profiles = [...current.profiles.filter((p) => p.owner), ...current.profiles.filter((p) => !p.owner).map((p) => ({ ...p, owner: { anonymousSessionId: anon, userId } }))];
    const next = { ...current, looks, profiles };
    if (write(concept, next)) setState(next);
  }, [concept, userId]);

  /* Another tab saved or removed something: show it here too. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== keyFor(concept)) return;
      const next = readState(concept);
      if (next) setState(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [concept]);

  /** Applies a change to what is saved now (not to what this tab last saw). False when it could not be kept. */
  const update = useCallback(
    (fn: (prev: LabState) => LabState): boolean => {
      const current = readState(concept);
      const next = fn(current ?? latest.current);
      const ok = write(concept, next);
      // With no storage at all, the change still holds for this visit.
      if (ok || current === null) {
        latest.current = next;
        setState(next);
      }
      return ok;
    },
    [concept],
  );

  const saveLook = useCallback(
    (look: Look, occasionLabel: string, meta: SaveMeta): SaveResult => {
      const dedupeKey = meta.inputKey ? `${look.id}|${meta.inputKey}` : legacyKey(look, occasionLabel);
      const now = readState(concept) ?? latest.current;
      const already = now.looks.find((l) => l.dedupeKey === dedupeKey && visibleTo(l, meta.owner.userId, meta.owner.anonymousSessionId));
      if (already) {
        // Another tab may have saved it; show what is saved.
        if (now !== latest.current) setState(now);
        return { ok: true, entry: already, existing: true };
      }
      const entry: SavedLook = {
        id: `${look.id}_${Date.now()}`,
        savedAt: new Date().toISOString(),
        look,
        occasionLabel,
        recommendationId: meta.recommendationId,
        requestId: meta.requestId,
        inputKey: meta.inputKey,
        owner: meta.owner,
        dedupeKey,
      };
      const ok = update((prev) => ({ ...prev, looks: [entry, ...prev.looks.filter((l) => l.id !== entry.id)] }));
      return { ok, entry, existing: false };
    },
    [concept, update],
  );

  const removeLook = useCallback(
    (id: string) => update((prev) => ({ ...prev, looks: prev.looks.filter((l) => l.id !== id) })),
    [update],
  );

  /** Puts a removed look back where it was, newest first. The server's copy is gone, so it isn't synced. */
  const restoreLook = useCallback(
    (entry: SavedLook) =>
      update((prev) => ({
        ...prev,
        looks: [...prev.looks.filter((l) => l.id !== entry.id), { ...entry, synced: false }].sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
      })),
    [update],
  );

  /**
   * Moves this guest's looks and Style DNA onto the account in one write. If the write fails, nothing
   * changes and the guest keeps everything. The guest's Style DNA moves only when the account has
   * none, so an account's own profile is never replaced.
   */
  const migrateToAccount = useCallback(
    (accountId: string, anonymousSessionId: string) => {
      const current = readState(concept) ?? latest.current;
      const result = migrateLooks(current.looks, accountId, anonymousSessionId);
      const accountHas = current.profiles.some((p) => p.owner?.userId === accountId);
      let profileMoved = false;
      const profiles = current.profiles.map((p) => {
        const guests = !p.owner?.userId && (!p.owner?.anonymousSessionId || p.owner.anonymousSessionId === anonymousSessionId);
        if (!guests || accountHas || profileMoved) return p;
        profileMoved = true;
        return { ...p, owner: { anonymousSessionId: p.owner?.anonymousSessionId ?? anonymousSessionId, userId: accountId } };
      });
      const next = { ...current, looks: result.looks, profiles };
      const ok = write(concept, next);
      if (ok) {
        latest.current = next;
        setState(next);
      }
      return { ok, moved: result.moved, duplicates: result.duplicates, profileMoved };
    },
    [concept],
  );

  /**
   * Brings this browser's copy of the account's looks in line with the server's (a real sign-in): looks
   * saved on another device arrive, looks removed on another device go, and what this browser hasn't
   * sent yet is returned for the caller to send (src/core/account.ts reconcileAccountLooks).
   */
  const syncAccountLooks = useCallback(
    (accountId: string, incoming: SavedLook[], complete: boolean) => {
      let result: { added: number; dropped: number; toSave: SavedLook[]; toRemove: string[] } = { added: 0, dropped: 0, toSave: [], toRemove: [] };
      const ok = update((prev) => {
        const r = reconcileAccountLooks(prev.looks, prev.pendingRemovals ?? [], accountId, incoming, { complete, anonymousSessionId: anonymousId() });
        result = r;
        return { ...prev, looks: r.looks };
      });
      return { ok, ...result };
    },
    [update],
  );

  /** Notes that the server now holds this look. */
  const markSynced = useCallback(
    (accountId: string, dedupeKey: string) =>
      update((prev) => ({ ...prev, looks: prev.looks.map((l) => (l.owner?.userId === accountId && l.dedupeKey === dedupeKey && !l.synced ? { ...l, synced: true } : l)) })),
    [update],
  );

  /** Keeps (or forgets) a removal the server hasn't heard about yet, so the look doesn't come back. */
  const notePendingRemoval = useCallback(
    (accountId: string, dedupeKey: string, pending: boolean) =>
      update((prev) => {
        const rest = (prev.pendingRemovals ?? []).filter((p) => !(p.userId === accountId && p.dedupeKey === dedupeKey));
        const next = pending ? [...rest, { userId: accountId, dedupeKey }] : rest;
        const { pendingRemovals: _old, ...base } = prev;
        void _old;
        return next.length ? { ...base, pendingRemovals: next } : base;
      }),
    [update],
  );

  const saveDna = useCallback(
    (profile: StyleProfile) => {
      const anon = anonymousId();
      return update((prev) => {
        const mine = profileFor(prev.profiles, userId, anon);
        const rest = prev.profiles.filter((p) => p !== mine);
        return { ...prev, profiles: [{ profile, owner: { anonymousSessionId: anon, userId } }, ...rest] };
      });
    },
    [update, userId],
  );

  const clearDna = useCallback(() => {
    const anon = anonymousId();
    return update((prev) => {
      const mine = profileFor(prev.profiles, userId, anon);
      return { ...prev, profiles: prev.profiles.filter((p) => p !== mine) };
    });
  }, [update, userId]);

  const reset = useCallback(() => update(() => EMPTY), [update]);

  // Read again when the person changes: signing out starts a new anonymous id.
  const anon = useMemo(() => anonymousId(), [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const looks = useMemo(() => state.looks.filter((l) => visibleTo(l, userId, anon)), [state.looks, userId, anon]);
  const dna = useMemo(() => profileFor(state.profiles, userId, anon)?.profile ?? null, [state.profiles, userId, anon]);

  return { looks, dna, saveLook, removeLook, restoreLook, migrateToAccount, syncAccountLooks, markSynced, notePendingRemoval, saveDna, clearDna, reset };
}
