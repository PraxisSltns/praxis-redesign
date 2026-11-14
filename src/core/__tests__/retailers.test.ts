/**
 * Retailer connectors (server/retailers): one contract that the Shopify and CSV connectors both meet,
 * the CSV reader's edge cases, and the import into Postgres (idempotent, removals kept, slots never
 * guessed). The database tests run when DATABASE_URL is set (CI, or `npm run dev:up` + migrations).
 */
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module
import { problemsWith } from "../../../server/retailers/connector.mjs";
// @ts-expect-error plain JavaScript module
import { createCsvConnector, itemsFromRows, parseCsv } from "../../../server/retailers/csv.mjs";
// @ts-expect-error plain JavaScript module
import { createShopifyConnector } from "../../../server/retailers/shopify.mjs";
// @ts-expect-error plain JavaScript module
import { connectorsFor, fixtureStoreFetcher } from "../../../server/retailers/cli.mjs";
// @ts-expect-error plain JavaScript module
import { importRetailer, placeItem, retailerIdFor } from "../../../server/retailers/import.mjs";

const SAMPLE = new URL("../../../server/retailers/fixtures/sample.csv", import.meta.url).pathname;
const FIELDS = ["externalId", "title", "brand", "description", "images", "price", "currency", "productUrl", "productType", "tags", "variants"].sort();
const VARIANT_FIELDS = ["externalId", "size", "colour", "sku", "price", "currency", "available", "stockQuantity"].sort();

type Item = { externalId: string; title: string; productType: string | null; tags: string[]; variants: { externalId: string; available: boolean; colour: string | null; size: string | null; stockQuantity: number | null }[]; images: string[] };
type Connector = { id: string; kind: string; source: string; rejected?: unknown[]; name(): Promise<string>; items(): Promise<Item[]> };

async function connectors(): Promise<[string, Connector][]> {
  return [
    ["shopify", createShopifyConnector({ store: "test-tailors.praxis-test.example", fetcher: await fixtureStoreFetcher() })],
    ["csv", createCsvConnector({ path: SAMPLE, id: "csv:sample" })],
  ];
}

describe("the connector contract, met by both connectors", async () => {
  for (const [kind, connector] of await connectors()) {
    describe(kind, () => {
      it("returns items that meet the contract, with exactly its fields", async () => {
        const items = await connector.items();
        expect(items.length).toBeGreaterThan(5);
        for (const item of items) {
          expect(problemsWith(item), `${item.externalId} ${item.title}`).toEqual([]);
          expect(Object.keys(item).sort()).toEqual(FIELDS);
          for (const v of item.variants) expect(Object.keys(v).sort()).toEqual(VARIANT_FIELDS);
        }
      });

      it("has a stable id, a kind, a source and a name", async () => {
        expect(connector.id).toMatch(/^(shopify|csv):/);
        expect(connector.kind).toBe(kind);
        expect(connector.source).toBeTruthy();
        expect(await connector.name()).toBeTruthy();
      });

      it("keeps ids stable between reads", async () => {
        const a = (await connector.items()).map((i) => [i.externalId, i.variants.map((v) => v.externalId)]);
        const b = (await connector.items()).map((i) => [i.externalId, i.variants.map((v) => v.externalId)]);
        expect(b).toEqual(a);
      });
    });
  }
});

describe("a CSV store's id", () => {
  it("comes from --store, not the file name, so a retailer's next file updates the same store", async () => {
    const [nov] = await connectorsFor({ csv: "exports/catalogue-nov.csv", store: "harbour-and-hide" });
    const [dec] = await connectorsFor({ csv: "/elsewhere/catalogue-dec.csv", store: "harbour-and-hide" });
    expect(nov.id).toBe("csv:harbour-and-hide");
    expect(retailerIdFor(dec.id)).toBe(retailerIdFor(nov.id));
  });
  it("keeps two retailers apart even when their files have the same name", async () => {
    const [a] = await connectorsFor({ csv: "a/products.csv", store: "store-a" });
    const [b] = await connectorsFor({ csv: "b/products.csv", store: "store-b" });
    expect(retailerIdFor(a.id)).not.toBe(retailerIdFor(b.id));
  });
  it("is required, and must be lower-case letters, digits and dashes", async () => {
    await expect(connectorsFor({ csv: "products.csv" })).rejects.toThrow(/--store/);
    for (const bad of ["Harbour", "harbour hide", "harbour--hide", "-x", "x".repeat(61)]) await expect(connectorsFor({ csv: "p.csv", store: bad })).rejects.toThrow(/--store must be/);
  });
  it("leaves the fixture stores where they were", async () => {
    const ids = (await connectorsFor({ fixtures: true })).map((c: { id: string }) => c.id);
    expect(ids).toEqual(["shopify:test-tailors.praxis-test.example", "csv:sample", "csv:library"]);
  });
});

describe("the contract check", () => {
  const good = { externalId: "1", title: "Shirt", brand: null, description: null, images: ["https://x.example/a.jpg"], price: 10, currency: "USD", productUrl: "https://x.example/p/1", productType: null, tags: [], variants: [{ externalId: "1a", size: "M", colour: null, sku: null, price: 10, currency: "USD", available: true, stockQuantity: null }] };

  it("accepts a good item and names what's wrong with a bad one", () => {
    expect(problemsWith(good)).toEqual([]);
    expect(problemsWith({ ...good, productUrl: "http://x.example/p/1" })).toContain("productUrl must be an https address");
    expect(problemsWith({ ...good, currency: "usd" })).toContain("currency must be a three-letter code");
    expect(problemsWith({ ...good, variants: [] })).toContain("at least one variant");
    expect(problemsWith({ ...good, variants: [good.variants[0], good.variants[0]] })).toContain("variant externalIds repeat");
    expect(problemsWith({ ...good, variants: [{ ...good.variants[0], stockQuantity: -1 }] })).toContain("variant 0: stockQuantity must be a whole number or null");
  });
});

describe("Shopify", () => {
  it("reads sizes, prices and stock from the store's list, with no stock counts", async () => {
    const items: Item[] = await createShopifyConnector({ store: "s.example", fetcher: await fixtureStoreFetcher() }).items();
    const boot = items.find((i: Item) => /Chelsea Boot/.test(i.title))!;
    expect(boot.variants.every((v) => !v.available)).toBe(true);
    const blazer = items.find((i: Item) => /Blazer/.test(i.title))!;
    expect(blazer.variants.map((v) => [v.size, v.available])).toEqual([["38", false], ["40", true], ["42", true]]);
    expect(blazer).toMatchObject({ price: 398, currency: "USD", brand: "Test Tailors", productUrl: "https://s.example/products/wool-blazer-in-charcoal" });
    expect(items.flatMap((i) => i.variants).every((v) => v.stockQuantity === null)).toBe(true);
  });

  it("fails loudly when the store can't be read", async () => {
    const down = async () => new Response("{}", { status: 503 });
    await expect(createShopifyConnector({ store: "s.example", fetcher: down }).items()).rejects.toThrow("The store answered 503.");
  });
});

describe("CSV", () => {
  it("reads quotes, commas and line breaks inside fields, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"\nthere']]);
  });

  it("groups rows into pieces, one variant per row, and rejects a bad row with its line", async () => {
    const c = createCsvConnector({ path: SAMPLE, id: "csv:sample" });
    const items: Item[] = await c.items();
    const oxford = items.find((i) => i.externalId === "OX-WHT")!;
    expect(oxford.variants.map((v) => [v.size, v.available])).toEqual([["S", true], ["M", true], ["L", false]]);
    expect(oxford.images).toHaveLength(2);
    expect(items.some((i) => i.externalId === "BAD-001")).toBe(false);
    expect(c.rejected).toEqual([{ line: 32, productId: "BAD-001", reasons: ["price is not a number of at least 0"] }]);
  });

  it("refuses a file without a required column", () => {
    expect(() => itemsFromRows([["product_id", "title", "price", "currency"]])).toThrow("The CSV has no product_url column.");
  });

  it("decides stock from 'available', else from the quantity", () => {
    const head = ["product_id", "title", "product_url", "price", "currency", "size", "available", "stock_quantity"];
    const row = (size: string, available: string, qty: string) => ["P", "Tee", "https://x.example/p", "20", "usd", size, available, qty];
    const { items, rejected } = itemsFromRows([head, row("S", "", "0"), row("M", "", "3"), row("L", "no", "5"), row("XL", "maybe", "")]);
    expect(items[0].variants.map((v: { size: string; available: boolean }) => [v.size, v.available])).toEqual([["S", false], ["M", true], ["L", false]]);
    expect(items[0].currency).toBe("USD");
    expect(rejected).toEqual([{ line: 5, productId: "P", reasons: ["available is not yes or no"] }]);
  });
});

describe("slots from the shared ontology", () => {
  const item = (title: string, productType: string | null = null, tags: string[] = []) => ({ title, productType, tags, variants: [{ colour: null }] });

  it("places pieces by name, then type, then tags", () => {
    expect(placeItem(item("Wool Blazer in Charcoal"))).toEqual({ slot: "top", layer: "outer", subcategory: "blazer", colour: "grey" });
    expect(placeItem(item("The Hudson", "Chinos"))).toMatchObject({ slot: "bottom", subcategory: "chinos" });
    expect(placeItem(item("The Hudson", null, ["loafer"]))).toMatchObject({ slot: "shoes", subcategory: "loafers" });
    expect(placeItem(item("Silk Knit Tie in Navy"))).toMatchObject({ slot: "extras", subcategory: "tie" });
  });

  it("never guesses: a piece the ontology doesn't know has no slot", () => {
    expect(placeItem(item("The Weekender", null, ["travel"]))).toBeNull();
  });
});

describe.skipIf(!process.env.DATABASE_URL)("the import into Postgres", async () => {
  // @ts-expect-error plain JavaScript module
  const { closeDb, db } = await import("../../../server/db.mjs");
  const pool = db();
  const id = `csv:test-${Date.now()}`;
  const rows = (await import("node:fs")).readFileSync(SAMPLE, "utf8");
  const connector = (text: string) => createCsvConnector({ path: "test.csv", id, read: async () => text });
  const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

  afterAll(async () => {
    await pool.query("DELETE FROM retailers WHERE retailer_id = $1", [retailerIdFor(id)]);
    await closeDb();
  });

  it("imports the sample, slots every in-stock garment it can, and lists the rest", async () => {
    const report = await importRetailer(pool, connector(rows));
    expect(report).toMatchObject({ items: 21, variants: 30, created: 21, updated: 0, removed: 0, inStockGarments: 19, slottedInStock: 18, slottedPercent: 94.7 });
    expect(report.bySlot).toEqual({ top: 9, bottom: 4, shoes: 3, extras: 3 });
    expect(report.unmapped.map((u: { externalId: string }) => u.externalId)).toEqual(["WKD-OLV"]);
    expect(report.notGarments.map((u: { externalId: string }) => u.externalId)).toEqual(["GFT-100"]);
    expect(report.rejected).toEqual([{ line: 32, productId: "BAD-001", reasons: ["price is not a number of at least 0"] }]);
    const [weekender] = await q("SELECT slot FROM products WHERE retailer_id = $1 AND external_id = 'WKD-OLV'", [report.retailerId]);
    expect(weekender.slot).toBeNull();
  });

  it("changes nothing when the same feed is imported again", async () => {
    const before = await q("SELECT product_id, updated_at FROM products WHERE retailer_id = $1 ORDER BY 1", [retailerIdFor(id)]);
    const report = await importRetailer(pool, connector(rows));
    expect(report).toMatchObject({ created: 0, updated: 0, removed: 0, restored: 0, variantsMadeUnavailable: 0 });
    expect(await q("SELECT product_id, updated_at FROM products WHERE retailer_id = $1 ORDER BY 1", [retailerIdFor(id)])).toEqual(before);
  });

  it("keeps a piece that leaves the feed, marked removed with its sizes unavailable, and restores it when it returns", async () => {
    const withoutBlazer = rows.split("\n").filter((l: string) => !l.startsWith("BLZ-NVY,")).join("\n");
    const gone = await importRetailer(pool, connector(withoutBlazer));
    expect(gone).toMatchObject({ removed: 1, variantsMadeUnavailable: 3 });
    const [blazer] = await q("SELECT p.removed_at, bool_or(v.available) AS any_in FROM products p JOIN product_variants v USING (product_id) WHERE p.retailer_id = $1 AND p.external_id = 'BLZ-NVY' GROUP BY 1", [retailerIdFor(id)]);
    expect(blazer.removed_at).not.toBeNull();
    expect(blazer.any_in).toBe(false);

    const back = await importRetailer(pool, connector(rows));
    expect(back).toMatchObject({ restored: 1, removed: 0 });
    const [again] = await q("SELECT p.removed_at, bool_or(v.available) AS any_in FROM products p JOIN product_variants v USING (product_id) WHERE p.retailer_id = $1 AND p.external_id = 'BLZ-NVY' GROUP BY 1", [retailerIdFor(id)]);
    expect(again).toEqual({ removed_at: null, any_in: true });
  });

  it("makes a size unavailable when it leaves a piece, and forgets the cut-out when the photos change", async () => {
    const productId = (await q("SELECT product_id FROM products WHERE retailer_id = $1 AND external_id = 'OX-WHT'", [retailerIdFor(id)]))[0].product_id;
    await pool.query("UPDATE products SET cutout_url = 'cutouts/x.png' WHERE product_id = $1", [productId]);
    const changed = rows
      .split("\n")
      .filter((l: string) => !l.includes("OX-WHT-S,"))
      .map((l: string) => (l.startsWith("OX-WHT,") ? l.replace("https://cdn.praxis-test.example/ox-wht-1.jpg|", "https://cdn.praxis-test.example/ox-wht-9.jpg|") : l))
      .join("\n");
    const report = await importRetailer(pool, connector(changed));
    expect(report.variantsMadeUnavailable).toBe(1);
    const [p] = await q("SELECT cutout_url FROM products WHERE product_id = $1", [productId]);
    expect(p.cutout_url).toBeNull();
  });

  it("leaves the database as it was when an import fails part way", async () => {
    const before = await q("SELECT count(*)::int AS n FROM product_variants v JOIN products p USING (product_id) WHERE p.retailer_id = $1", [retailerIdFor(id)]);
    const failing = { ...connector(rows), items: async () => [...(await connector(rows).items()), { externalId: "X", title: "X", brand: null, description: null, images: [], price: 1e15, currency: "USD", productUrl: "https://x.example", productType: null, tags: [], variants: [{ externalId: "x", size: null, colour: null, sku: null, price: 1e15, currency: "USD", available: true, stockQuantity: null }] }] };
    await expect(importRetailer(pool, failing)).rejects.toThrow();
    expect(await q("SELECT count(*)::int AS n FROM product_variants v JOIN products p USING (product_id) WHERE p.retailer_id = $1", [retailerIdFor(id)])).toEqual(before);
  });
});
