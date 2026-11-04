/**
 * Ten searches against the real models and the library fixture catalogue (server/retailers/fixtures/
 * library.csv, after `npm run db:seed` and `npm run catalogue:process`). Each must put a piece of the
 * right kind first and only pieces of the right slot in its top three, in stock, in under a second.
 *
 * Runs when SEARCH_QUALITY=1 with DATABASE_URL and AI_SERVICE_URL pointing at a service with the models
 * loaded; CI has no models, so it skips there. Timings are printed for the report.
 */
import { afterAll, describe, expect, it } from "vitest";

const QUERIES: [string, string, string[]][] = [
  ["white leather sneakers", "shoes", ["sneakers"]],
  ["navy blazer", "top", ["blazer", "suit-jacket"]],
  ["brown leather loafers", "shoes", ["loafers"]],
  ["dark indigo jeans", "bottom", ["jeans"]],
  ["black chelsea boots", "shoes", ["chelsea-boots", "boots"]],
  ["charcoal tailored trousers", "bottom", ["trousers", "suit-trousers"]],
  ["light blue bomber jacket", "top", ["jacket", "overshirt"]],
  ["white button-down shirt", "top", ["shirt", "dress-shirt"]],
  ["black leather oxford shoes", "shoes", ["dress-shoes"]],
  ["brown leather belt", "extras", ["belt"]],
];

describe.skipIf(!(process.env.SEARCH_QUALITY === "1" && process.env.DATABASE_URL && process.env.AI_SERVICE_URL))("search quality on the library catalogue", async () => {
  // @ts-expect-error plain JavaScript module
  const { closeDb, db } = await import("../../../server/db.mjs");
  // @ts-expect-error plain JavaScript module
  const { search } = await import("../../../server/search.mjs");
  // @ts-expect-error plain JavaScript module
  const { retailerIdFor } = await import("../../../server/retailers/import.mjs");
  const pool = db();
  const retailerId = retailerIdFor("csv:library");
  const timings: string[] = [];

  afterAll(async () => {
    console.log(["search timings (embed + search = total):", ...timings].join("\n  "));
    await closeDb();
  });

  it("has the library catalogue's vectors", async () => {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM products WHERE retailer_id = $1 AND embedding IS NOT NULL", [retailerId]);
    expect(rows[0].n).toBeGreaterThanOrEqual(40);
  });

  // Warm the text model once, as a running service is, so the timings are a search's, not a start-up's.
  it("warms up", async () => {
    await search({ text: "warm up", limit: 1 }, { retailerId });
  });

  for (const [text, slot, kinds] of QUERIES) {
    it(`"${text}" finds ${kinds.join(" or ")} first`, async () => {
      const out = await search({ text, limit: 3 }, { retailerId });
      timings.push(`${text}: ${out.ms.embed} + ${out.ms.search} = ${out.ms.total} ms -> ${out.items.map((i: { title: string; score: number }) => `${i.title} (${i.score})`).join(", ")}`);
      expect(out.items).toHaveLength(3);
      expect(kinds).toContain(out.items[0].subcategory);
      expect(out.items.map((i: { slot: string }) => i.slot)).toEqual([slot, slot, slot]);
      expect(out.items.every((i: { sizes: string[]; cutoutUrl: string }) => i.cutoutUrl && i.sizes.length > 0)).toBe(true);
      expect(out.ms.total).toBeLessThan(1000);
    });
  }
});
