import { describe, expect, it } from "vitest";
import { reconcileAccountLooks, type OwnedLook } from "../account";

const ME = "user_me";
const anon = "anon_here";
const look = (key: string, extra: Partial<OwnedLook> = {}, savedAt = "2026-11-10T10:00:00.000Z"): OwnedLook => ({
  id: `${key}_1`,
  savedAt,
  dedupeKey: key,
  owner: { anonymousSessionId: anon, userId: ME },
  ...extra,
});
const keys = (ls: readonly OwnedLook[]) => ls.map((l) => l.dedupeKey).sort();
const sync = (local: OwnedLook[], incoming: OwnedLook[], pending: { userId: string; dedupeKey: string }[] = [], complete = true) =>
  reconcileAccountLooks(local, pending, ME, incoming, { complete, anonymousSessionId: anon });

describe("keeping a device's account looks in line with the account", () => {
  it("brings in a look saved on another device, marked as on the account", () => {
    const r = sync([], [look("a")]);
    expect(r.added).toBe(1);
    expect(r.looks[0]).toMatchObject({ dedupeKey: "a", synced: true, owner: { userId: ME } });
  });

  it("drops a look the account had and no longer has: it was removed on another device", () => {
    const r = sync([look("a", { synced: true }), look("b", { synced: true })], [look("b")]);
    expect(keys(r.looks)).toEqual(["b"]);
    expect(r.dropped).toBe(1);
  });

  it("keeps a look saved here that never reached the account, and asks for it to be sent", () => {
    const r = sync([look("new")], []);
    expect(keys(r.looks)).toEqual(["new"]);
    expect(r.dropped).toBe(0);
    expect(keys(r.toSave)).toEqual(["new"]);
  });

  it("marks a look as on the account once the account has it", () => {
    const r = sync([look("a")], [look("a")]);
    expect(r.looks[0].synced).toBe(true);
    expect(r.toSave).toEqual([]);
    expect(r.added).toBe(0);
  });

  it("doesn't bring back a look removed here whose removal hasn't reached the account, and asks for it again", () => {
    const r = sync([], [look("gone"), look("kept")], [{ userId: ME, dedupeKey: "gone" }]);
    expect(keys(r.looks)).toEqual(["kept"]);
    expect(r.toRemove).toEqual(["gone"]);
  });

  it("drops nothing when the account's list may be cut short", () => {
    const r = sync([look("a", { synced: true })], [look("b")], [], false);
    expect(keys(r.looks)).toEqual(["a", "b"]);
    expect(r.dropped).toBe(0);
  });

  it("leaves another account's looks and a guest's looks on this device alone", () => {
    const theirs = look("t", { synced: true, owner: { anonymousSessionId: "anon_x", userId: "user_other" } });
    const guest = look("g", { owner: { anonymousSessionId: "anon_y" } });
    const r = sync([theirs, guest], []);
    expect(keys(r.looks)).toEqual(["g", "t"]);
    expect(r.toSave).toEqual([]);
    expect(r.dropped).toBe(0);
  });

  it("ignores another account's pending removals", () => {
    const r = sync([], [look("a")], [{ userId: "user_other", dedupeKey: "a" }]);
    expect(keys(r.looks)).toEqual(["a"]);
    expect(r.toRemove).toEqual([]);
  });

  it("orders the result newest first", () => {
    const r = sync([look("old", { synced: true }, "2026-11-01T00:00:00.000Z")], [look("old"), look("new", {}, "2026-11-09T00:00:00.000Z")]);
    expect(r.looks.map((l) => l.dedupeKey)).toEqual(["new", "old"]);
  });
});
