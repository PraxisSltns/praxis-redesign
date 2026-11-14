/**
 * Keeps a real account's wardrobe pieces and feedback on the server and on every device it signs in on
 * (AUTH_MODE "magic-link"). Each run reads both kinds from the server, merges them with this device's by
 * the three-way rules (src/core/accountSync.ts), writes the result here and sends what changed here.
 * Runs on each page load and each change of screen, one run at a time.
 *
 * Only the account's own records take part: a guest's records, or another account's on this device,
 * are left as they are (a guest's become the account's at sign-in, src/core/account.ts, and are sent
 * by the next run). Photos of pieces never leave the tab.
 */
import { accountFeedback, accountWardrobe, putAccountFeedback, putAccountWardrobe, removeAccountFeedback, removeAccountWardrobe } from "./accountApi";
import { baseAfterSends, mergeThreeWay, type SyncBase } from "./accountSync";
import type { OutfitFeedback } from "./contracts";
import { wardrobeEntries, writeWardrobe, type WardrobeEntry } from "./data";
import { feedbackStore } from "./feedback";
import { local, readJson, writeJson } from "./ids";

const BASE_KEY = "praxis_account_sync";
/** Fired on window when a run changed what this device holds, so open screens read it again. */
export const RECORDS_SYNCED = "praxis:records-synced";

type Kind = "wardrobe" | "feedback";
type Bases = Record<string, Partial<Record<Kind, SyncBase>>>;

const readBase = (userId: string, kind: Kind): SyncBase => readJson<Bases>(local(), BASE_KEY)?.[userId]?.[kind] ?? {};
function writeBase(userId: string, kind: Kind, base: SyncBase) {
  const all = readJson<Bases>(local(), BASE_KEY) ?? {};
  writeJson(local(), BASE_KEY, { ...all, [userId]: { ...all[userId], [kind]: base } });
}

interface Adapter<T> {
  kind: Kind;
  read(): T[];
  write(all: T[]): boolean;
  mine(r: T, userId: string): boolean;
  key(r: T): string;
  version(r: T): string;
  own(r: T, userId: string, anonymousSessionId: string): T;
  fetch(): Promise<{ ok: true; list: T[] } | { ok: false; status: number }>;
  put(anonymousSessionId: string, r: T): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}

const wardrobe: Adapter<WardrobeEntry> = {
  kind: "wardrobe",
  read: () => wardrobeEntries(),
  write: (all) => writeWardrobe(all),
  mine: (r, userId) => r.owner?.userId === userId,
  key: (r) => r.wardrobeItemId,
  version: (r) => r.updatedAt ?? r.addedAt,
  own: (r, userId, anon) => ({ ...r, owner: { anonymousSessionId: r.owner?.anonymousSessionId ?? anon, userId } }),
  fetch: async () => {
    const r = await accountWardrobe();
    return r.ok ? { ok: true, list: r.items } : { ok: false, status: r.status };
  },
  put: async (anon, r) => (await putAccountWardrobe(anon, r)).ok,
  remove: async (id) => (await removeAccountWardrobe(id)).ok,
};

const feedback: Adapter<OutfitFeedback> = {
  kind: "feedback",
  read: () => feedbackStore.all(),
  write: (all) => feedbackStore.replaceAll(all),
  mine: (r, userId) => r.userId === userId,
  key: (r) => r.eventId,
  version: (r) => r.createdAt,
  own: (r, userId) => ({ ...r, userId }),
  fetch: async () => {
    const r = await accountFeedback();
    return r.ok ? { ok: true, list: r.records } : { ok: false, status: r.status };
  },
  put: async (anon, r) => (await putAccountFeedback(anon, r)).ok,
  remove: async (id) => (await removeAccountFeedback(id)).ok,
};

/** One kind, once. "signed_out" when the server says the session has ended. */
async function syncKind<T>(a: Adapter<T>, userId: string, anonymousSessionId: string): Promise<"ok" | "failed" | "signed_out"> {
  const remote = await a.fetch();
  if (!remote.ok) return remote.status === 401 ? "signed_out" : "failed";
  const before = a.read();
  const snapshot = JSON.stringify(before);
  const mine = before.filter((r) => a.mine(r, userId));
  const others = before.filter((r) => !a.mine(r, userId));
  const base = readBase(userId, a.kind);
  const m = mergeThreeWay(mine, remote.list.map((r) => a.own(r, userId, anonymousSessionId)), base, a.key, a.version);
  // Something changed here while the server answered: leave it for the next run rather than overwrite it.
  if (JSON.stringify(a.read()) !== snapshot) return "ok";
  const changedHere = m.added > 0 || m.dropped > 0 || m.records.length !== mine.length || m.records.some((r, i) => r !== mine[i]);
  if (changedHere && !a.write([...others, ...m.records].sort((x, y) => a.version(y).localeCompare(a.version(x))))) return "failed";
  const pushed = await Promise.all(m.push.map(async (r) => ({ id: a.key(r), ok: await a.put(anonymousSessionId, r) })));
  const removed = await Promise.all(m.remove.map(async (id) => ({ id, ok: await a.remove(id) })));
  writeBase(userId, a.kind, baseAfterSends(m.base, base, { pushed, removed }));
  if (changedHere && typeof window !== "undefined") window.dispatchEvent(new Event(RECORDS_SYNCED));
  return pushed.every((p) => p.ok) && removed.every((r) => r.ok) ? "ok" : "failed";
}

let running: Promise<"ok" | "failed" | "signed_out"> | null = null;
let again = false;

/** Syncs the account's wardrobe and feedback; a call during a run makes one more run after it. */
export function syncAccountRecords(userId: string, anonymousSessionId: string): Promise<"ok" | "failed" | "signed_out"> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let result: "ok" | "failed" | "signed_out" = "ok";
    do {
      again = false;
      const out = await Promise.all([syncKind(wardrobe, userId, anonymousSessionId), syncKind(feedback, userId, anonymousSessionId)]);
      result = out.includes("signed_out") ? "signed_out" : out.includes("failed") ? "failed" : "ok";
    } while (again && result !== "signed_out");
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}
