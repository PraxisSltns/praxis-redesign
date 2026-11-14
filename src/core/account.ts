/**
 * Moving what a guest saved onto their account when they sign in. Pure functions, so the rules are
 * testable on their own: a guest's looks and feedback take the account's id, the same look saved
 * twice is kept once (the newest), and anything that belongs to another account on this device is
 * left alone. The caller writes the result in one go and keeps the old state if that fails.
 */
import type { OutfitFeedback } from "./contracts";

export interface Owner {
  anonymousSessionId: string;
  userId?: string;
}

export interface OwnedLook {
  id: string;
  savedAt: string;
  owner?: Owner;
  /** Identifies the look for de-duplication: the outfit, the brief it answered and any owned piece. */
  dedupeKey: string;
  /** With a real account: the server is known to hold this look (it came from there, or saving it there worked). */
  synced?: boolean;
}

/** A look removed on this device whose removal hasn't reached the account yet. */
export interface PendingRemoval {
  userId: string;
  dedupeKey: string;
}

export interface Reconciled<T> {
  looks: T[];
  /** On the account but not here: now here. */
  added: number;
  /** Here, known to the account, and gone from it: removed on another device, so removed here. */
  dropped: number;
  /** The account's looks here that never reached it: to save there. */
  toSave: T[];
  /** Removals still to send. */
  toRemove: string[];
}

/**
 * Brings this device's copy of an account's looks in line with the account's (a real sign-in). The
 * account is the record, except for what this device knows the account hasn't heard yet: a look saved
 * here that didn't reach it is kept and sent again, and a look removed here stays removed until the
 * removal reaches it. `complete` is false when the account's list may be cut short; then nothing is
 * dropped. Other people's records on this device are left alone.
 */
export function reconcileAccountLooks<T extends OwnedLook>(
  local: readonly T[],
  pending: readonly PendingRemoval[],
  userId: string,
  incoming: readonly T[],
  { complete = true, anonymousSessionId }: { complete?: boolean; anonymousSessionId: string },
): Reconciled<T> {
  const removing = new Set(pending.filter((p) => p.userId === userId).map((p) => p.dedupeKey));
  const onAccount = new Map(incoming.filter((l) => l && typeof l.dedupeKey === "string" && !removing.has(l.dedupeKey)).map((l) => [l.dedupeKey, l]));
  const mine = (l: T) => l.owner?.userId === userId;
  let dropped = 0;
  const toSave: T[] = [];
  const have = new Set<string>();
  const kept: T[] = [];
  for (const l of local) {
    if (!mine(l)) {
      kept.push(l);
      continue;
    }
    if (onAccount.has(l.dedupeKey)) {
      have.add(l.dedupeKey);
      kept.push(l.synced ? l : { ...l, synced: true });
    } else if (l.synced && complete) {
      dropped += 1;
    } else {
      kept.push(l);
      if (!l.synced) toSave.push(l);
    }
  }
  const fresh = [...onAccount.values()].filter((l) => !have.has(l.dedupeKey)).map((l) => ({ ...l, synced: true, owner: { anonymousSessionId: l.owner?.anonymousSessionId ?? anonymousSessionId, userId } }));
  return {
    looks: [...kept, ...fresh].sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
    added: fresh.length,
    dropped,
    toSave,
    toRemove: [...removing],
  };
}

/**
 * Whether a saved record shows for this person. An account's records show only to that account. A
 * guest's records show only to the same guest (the same anonymous id), so after someone signs out the
 * next person on this device starts clean. A record from an early build with no owner at all shows to
 * whoever is here, and is claimed by the first account to sign in.
 */
export function visibleTo(record: { owner?: Owner }, userId: string | undefined, anonymousSessionId?: string): boolean {
  const owner = record.owner;
  if (!owner) return true;
  if (owner.userId) return owner.userId === userId;
  if (userId) return false;
  return anonymousSessionId === undefined || !owner.anonymousSessionId || owner.anonymousSessionId === anonymousSessionId;
}

/** Whether a guest record belongs to this guest, so signing in may move it onto the account. */
function claimable(owner: Owner | undefined, anonymousSessionId: string): boolean {
  if (owner?.userId) return false;
  return !owner?.anonymousSessionId || owner.anonymousSessionId === anonymousSessionId;
}

export interface LookMigration<T> {
  looks: T[];
  /** Guest looks now on the account. */
  moved: number;
  /** Copies dropped because the account already had the same look. */
  duplicates: number;
}

export function migrateLooks<T extends OwnedLook>(looks: readonly T[], userId: string, anonymousSessionId: string): LookMigration<T> {
  let moved = 0;
  const claimed = looks.map((l) => {
    if (!claimable(l.owner, anonymousSessionId)) return l;
    moved += 1;
    return { ...l, owner: { anonymousSessionId: l.owner?.anonymousSessionId ?? anonymousSessionId, userId } };
  });
  // Newest first, so the first of each key is the one kept.
  const ordered = [...claimed].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const seen = new Set<string>();
  const keep = new Set<string>();
  let duplicates = 0;
  for (const l of ordered) {
    if (l.owner?.userId !== userId) {
      keep.add(l.id);
      continue;
    }
    if (seen.has(l.dedupeKey)) {
      duplicates += 1;
      continue;
    }
    seen.add(l.dedupeKey);
    keep.add(l.id);
  }
  return { looks: ordered.filter((l) => keep.has(l.id)), moved, duplicates };
}

export interface FeedbackMigration {
  records: OutfitFeedback[];
  moved: number;
}

/** Gives this browser's guest feedback the account's id, dropping exact repeats. */
export function migrateFeedback(records: readonly OutfitFeedback[], userId: string, anonymousSessionId: string): FeedbackMigration {
  let moved = 0;
  const seen = new Set<string>();
  const out: OutfitFeedback[] = [];
  for (const r of records) {
    const mine = !r.userId && r.anonymousSessionId === anonymousSessionId;
    const next = mine ? { ...r, userId } : r;
    if (mine) moved += 1;
    const key = [next.userId ?? next.anonymousSessionId, next.recommendationId, next.outfitId, next.feedback, next.reason ?? "", next.garmentId ?? ""].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return { records: out, moved };
}
