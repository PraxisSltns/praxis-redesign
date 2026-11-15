/**
 * The retailer onboarding kit (docs/retailers/README.md): the checker says what the import would do,
 * without writing, and the store report says where each store's catalogue stands.
 */
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module
import { checkItems, describeCheck } from "../../../server/retailers/check.mjs";
// @ts-expect-error plain JavaScript module
import { createCsvConnector } from "../../../server/retailers/csv.mjs";
// @ts-expect-error plain JavaScript module
import { importRetailer, retailerIdFor } from "../../../server/retailers/import.mjs";
// @ts-expect-error plain JavaScript module
import { describeStores, storeReport } from "../../../server/retailers/report.mjs";

const SAMPLE = new URL("../../../server/retailers/fixtures/sample.csv", import.meta.url).pathname;
const TEMPLATE = new URL("../../../docs/retailers/catalogue-template.csv", import.meta.url).pathname;

async function check(path: string) {
  const connector = createCsvConnector({ path });
  const items = await connector.items();
  return checkItems(items, connector.rejected);
}

describe("checking a catalogue before it is imported", () => {
  it("says what the import would do with the sample: the same pieces placed, left out and skipped", async () => {
    const r = await check(SAMPLE);
    expect(r).toMatchObject({ pieces: 21, sizes: 30, ready: 18, bySlot: { top: 9, bottom: 4, shoes: 3, extras: 3 } });
    expect(r.rejected).toEqual([{ line: 32, productId: "BAD-001", reasons: ["price is not a number of at least 0"] }]);
    expect(r.unmapped.map((u: { productId: string }) => u.productId)).toEqual(["WKD-OLV"]);
    expect(r.notGarments.map((u: { productId: string }) => u.productId)).toEqual(["GFT-100"]);
    expect(r.soldOut.map((u: { productId: string }) => u.productId)).toEqual(["POL-GRN"]);
  });

  it("finds nothing wrong with the template retailers are given", async () => {
    const r = await check(TEMPLATE);
    expect(r).toMatchObject({ pieces: 3, sizes: 5, ready: 3, rejected: [], unmapped: [], noPhoto: [], duplicates: [] });
  });

  it("lists a piece with no photo, a repeated id, and more than one currency", () => {
    const item = (id: string, over: Record<string, unknown> = {}) => ({
      externalId: id, title: "Navy Wool Blazer", brand: null, description: null, images: ["https://x.example/a.jpg"], price: 100, currency: "USD",
      productUrl: "https://x.example/p", productType: null, tags: [], variants: [{ externalId: `${id}-1`, size: "M", colour: null, sku: null, price: 100, currency: "USD", available: true, stockQuantity: null }], ...over,
    });
    const r = checkItems([item("A"), item("A"), item("B", { images: [] }), item("C", { currency: "EUR", variants: [{ externalId: "C-1", size: null, colour: null, sku: null, price: 90, currency: "EUR", available: true, stockQuantity: null }] })]);
    expect(r.duplicates.map((d: { productId: string }) => d.productId)).toEqual(["A"]);
    expect(r.noPhoto.map((d: { productId: string }) => d.productId)).toEqual(["B"]);
    expect(r.currencies).toEqual(["EUR", "USD"]);
    expect(r.ready).toBe(2);
    const text = describeCheck("Test", r);
    expect(text).toContain("No photo: can't be shown until it has one (1):");
    expect(text).toContain("More than one currency (EUR, USD)");
    expect(text).toContain("Ready: 2 of 3 pieces");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("the store report", async () => {
  // @ts-expect-error plain JavaScript module
  const { closeDb, db } = await import("../../../server/db.mjs");
  const pool = db();
  const id = `csv:kit-${Date.now()}`;
  const retailerId = retailerIdFor(id);

  afterAll(async () => {
    await pool.query("DELETE FROM retailers WHERE retailer_id = $1", [retailerId]);
    await closeDb();
  });

  it("says how much of a freshly imported store can be shown, what is waiting, and what failed and why", async () => {
    const text = readFileSync(SAMPLE, "utf8");
    await importRetailer(pool, createCsvConnector({ path: "kit.csv", id, read: async () => text }));
    const { rows } = await pool.query("SELECT product_id FROM products WHERE retailer_id = $1 AND external_id = 'OX-WHT'", [retailerId]);
    const failures = new Map([[rows[0].product_id, "the photo was not found (/ox-wht-1.jpg)"]]);
    const [store] = await storeReport(pool, { retailerId, failures });
    expect(store).toMatchObject({ retailerId, live: 21, removed: 0, unplaced: 2, noPhoto: 0, inStock: 18, processed: 0, shown: 0, waiting: 18 });
    expect(store.failed).toEqual([{ productId: rows[0].product_id, reason: "the photo was not found (/ox-wht-1.jpg)" }]);
    expect(describeStores([store])).toContain("0 of 21 live pieces can be shown now");
  });
});
