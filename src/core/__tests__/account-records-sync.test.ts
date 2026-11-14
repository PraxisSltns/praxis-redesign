import { describe, expect, it } from "vitest";
import { baseAfterSends, mergeThreeWay, type SyncBase } from "../accountSync";

interface Piece {
  id: string;
  v: string;
  label?: string;
}
const p = (id: string, v: string, label = id): Piece => ({ id, v, label });
const merge = (local: Piece[], server: Piece[], base: SyncBase) => mergeThreeWay(local, server, base, (r) => r.id, (r) => r.v);
const ids = (rs: Piece[]) => rs.map((r) => r.id).sort();

const T1 = "2026-11-11T09:00:00.000Z";
const T2 = "2026-11-11T10:00:00.000Z";
const T3 = "2026-11-11T11:00:00.000Z";

describe("the three-way sync of an account's records", () => {
  it("sends a record added here, and brings in one added elsewhere", () => {
    const m = merge([p("here", T1)], [p("there", T2)], {});
    expect(ids(m.records)).toEqual(["here", "there"]);
    expect(ids(m.push)).toEqual(["here"]);
    expect(m.added).toBe(1);
    expect(m.base).toEqual({ here: T1, there: T2 });
  });

  it("removes from the server what was removed here, and drops here what was removed elsewhere", () => {
    const base = { gonehere: T1, gonethere: T1 };
    const m = merge([p("gonethere", T1)], [p("gonehere", T1)], base);
    expect(m.records).toEqual([]);
    expect(m.remove).toEqual(["gonehere"]);
    expect(m.dropped).toBe(1);
    expect(m.push).toEqual([]);
  });

  it("sends a change made here, and takes a change made elsewhere", () => {
    const base = { a: T1, b: T1 };
    const m = merge([p("a", T2, "edited here"), p("b", T1)], [p("a", T1), p("b", T2, "edited there")], base);
    expect(m.records.find((r) => r.id === "a")?.label).toBe("edited here");
    expect(m.records.find((r) => r.id === "b")?.label).toBe("edited there");
    expect(ids(m.push)).toEqual(["a"]);
    expect(m.base).toEqual({ a: T2, b: T2 });
  });

  it("when both changed it, keeps the newer", () => {
    expect(merge([p("a", T3, "here")], [p("a", T2, "there")], { a: T1 }).records[0].label).toBe("here");
    expect(merge([p("a", T2, "here")], [p("a", T3, "there")], { a: T1 }).records[0].label).toBe("there");
  });

  it("leaves alone what both sides already agree on", () => {
    const m = merge([p("a", T1)], [p("a", T1)], { a: T1 });
    expect(m.push).toEqual([]);
    expect(m.remove).toEqual([]);
    expect(m.records).toHaveLength(1);
  });

  it("after a failed send, sends it again next time: nothing is lost and nothing comes back", () => {
    // A new piece whose send failed is still new on the next run.
    const first = merge([p("new", T1)], [], {});
    const afterFail = baseAfterSends(first.base, {}, { pushed: [{ id: "new", ok: false }], removed: [] });
    expect(afterFail).toEqual({});
    expect(ids(merge([p("new", T1)], [], afterFail).push)).toEqual(["new"]);

    // A change whose send failed is still a change.
    const changed = merge([p("a", T2)], [p("a", T1)], { a: T1 });
    const keptOld = baseAfterSends(changed.base, { a: T1 }, { pushed: [{ id: "a", ok: false }], removed: [] });
    expect(keptOld).toEqual({ a: T1 });
    expect(ids(merge([p("a", T2)], [p("a", T1)], keptOld).push)).toEqual(["a"]);

    // A removal that failed is tried again; one that worked leaves the base.
    const removing = merge([], [p("x", T1), p("y", T1)], { x: T1, y: T1 });
    const after = baseAfterSends(removing.base, { x: T1, y: T1 }, { pushed: [], removed: [{ id: "x", ok: true }, { id: "y", ok: false }] });
    expect(after).toEqual({ y: T1 });
    expect(merge([], [p("y", T1)], after).remove).toEqual(["y"]);
  });

  it("orders the records newest first", () => {
    expect(merge([p("old", T1), p("new", T3)], [p("mid", T2)], {}).records.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });
});
