/**
 * Keeping an account's records on this device in line with the server's, for records the page changes in
 * many places (wardrobe pieces, feedback). A three-way merge: this device remembers each record's version
 * as of the last sync (the base), so comparing the base with what is here now and what the server has now
 * tells apart a record added, changed or removed here from one added, changed or removed on another
 * device. Pure, so the rules are testable on their own.
 *
 * Only what reached the server goes into the base: a send that fails is found again on the next sync
 * (still new here, still changed here, or still to remove), so nothing is lost and nothing comes back.
 */

/** id -> version (the time it was last changed) as of the last sync. */
export type SyncBase = Record<string, string>;

export interface Merge<T> {
  /** The account's records for this device, newest first. */
  records: T[];
  /** Changed or new here: to send. */
  push: T[];
  /** Removed here: to remove from the server. */
  remove: string[];
  /** The base if every send works; see baseAfterSends for when some don't. */
  base: SyncBase;
  /** Counts, for the record. */
  added: number;
  dropped: number;
}

export function mergeThreeWay<T>(local: readonly T[], server: readonly T[], base: SyncBase, key: (r: T) => string, version: (r: T) => string): Merge<T> {
  const here = new Map(local.map((r) => [key(r), r]));
  const there = new Map(server.map((r) => [key(r), r]));
  const ids = new Set([...here.keys(), ...there.keys(), ...Object.keys(base)]);
  const records: T[] = [];
  const push: T[] = [];
  const remove: string[] = [];
  const next: SyncBase = {};
  let added = 0;
  let dropped = 0;
  for (const id of ids) {
    const l = here.get(id);
    const s = there.get(id);
    const b = base[id];
    if (l && s) {
      const lv = version(l);
      const sv = version(s);
      // Changed here since the last sync, or changed on both devices and here is the newer.
      const mineWins = lv !== sv && (b === sv || (b !== lv && lv > sv));
      records.push(mineWins || lv === sv ? l : s);
      if (mineWins) push.push(l);
      next[id] = mineWins || lv === sv ? lv : sv;
    } else if (l) {
      if (b !== undefined) dropped += 1; // It was on the account and is gone: removed on another device.
      else {
        records.push(l);
        push.push(l);
        next[id] = version(l);
      }
    } else if (s) {
      if (b !== undefined) {
        remove.push(id); // It was here and is gone: removed on this device.
        next[id] = b;
      } else {
        records.push(s);
        next[id] = version(s);
        added += 1;
      }
    }
  }
  records.sort((a, z) => version(z).localeCompare(version(a)));
  return { records, push, remove, base: next, added, dropped };
}

/**
 * The base to keep once the sends are done: it records only what the server now holds. A new record
 * whose send failed is left out (so it is sent again); a changed one goes back to the server's version
 * (so it is sent again); a removal that worked leaves the base, and one that failed stays (so it is
 * removed again).
 */
export function baseAfterSends(merged: SyncBase, previous: SyncBase, outcome: { pushed: readonly { id: string; ok: boolean }[]; removed: readonly { id: string; ok: boolean }[] }): SyncBase {
  const out: SyncBase = { ...merged };
  for (const { id, ok } of outcome.pushed) {
    if (ok) continue;
    if (previous[id] === undefined) delete out[id];
    else out[id] = previous[id];
  }
  for (const { id, ok } of outcome.removed) if (ok) delete out[id];
  return out;
}
