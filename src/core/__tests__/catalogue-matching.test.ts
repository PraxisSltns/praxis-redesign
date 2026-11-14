import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module
import { PER_PART, queryFor, rank, run, testOnly, toProduct } from "../../../server/providers/catalogue.mjs";
import { fromStoreProduct } from "../catalogue/garment";

const row = (over: Record<string, unknown> = {}) => ({
  product_id: "prod_0790d28ed34392a2e7fdda39",
  retailer_id: "ret_dee440e99efc9759",
  retailer: "Harbour & Hide",
  title: "Charcoal wool blazer",
  brand: "Harbour & Hide",
  description: "Slim fit, half-lined.",
  slot: "top",
  layer: "outer",
  subcategory: "blazer",
  colour: "grey",
  price_amount: "320.00",
  currency: "USD",
  product_url: "https://shop.example/products/blazer",
  image: "https://cdn.example/blazer.jpg",
  cutout_url: "cutouts/prod_0790d28ed34392a2e7fdda39/c7818ae2002c0fe4.png",
  sizes: ["40", "42"],
  score: 0.12,
  ...over,
});
const blazer = { garmentId: "o1_top", slot: "top", layer: "outer", name: "Charcoal blazer", subcategory: "blazer", colour: "grey", formality: 4 };

describe("matching a look's parts to the imported catalogue", () => {
  it("searches by the part's colour, material and name, without repeating a word the name has", () => {
    expect(queryFor({ name: "Fine knit", colour: "navy", material: "merino" })).toBe("navy merino Fine knit");
    expect(queryFor({ name: "Navy fine knit", colour: "navy" })).toBe("Navy fine knit");
    expect(queryFor({ name: "Charcoal blazer", colour: "grey" })).toBe("Charcoal blazer");
    expect(queryFor({ name: "" })).toBe("");
  });

  it("keeps only the same slot and layer, and the same kind or a close stand-in", () => {
    expect(rank(blazer, row())).toBeGreaterThan(0);
    expect(rank(blazer, row({ slot: "bottom" }))).toBe(-1);
    expect(rank(blazer, row({ layer: "base" }))).toBe(-1);
    expect(rank(blazer, row({ subcategory: "jeans" }))).toBe(-1);
    const shoes = { garmentId: "o1_shoes", slot: "shoes", name: "Black oxfords", subcategory: "dress-shoes", colour: "black", formality: 5 };
    const exact = rank(shoes, row({ slot: "shoes", layer: null, subcategory: "dress-shoes", title: "Black leather oxfords", colour: "black" }));
    const standIn = rank(shoes, row({ slot: "shoes", layer: null, subcategory: "loafers", title: "Black loafers", colour: "black" }));
    expect(standIn).toBeGreaterThan(0);
    expect(exact).toBeGreaterThan(standIn);
  });

  it("ranks the right colour and closer meaning higher", () => {
    expect(rank(blazer, row({ colour: "grey" }))).toBeGreaterThan(rank(blazer, row({ colour: "navy", title: "Navy blazer" })));
    expect(rank(blazer, row({ score: 0.2 }))).toBeGreaterThan(rank(blazer, row({ score: 0.1 })));
  });

  it("gives each piece its cut-out as its picture, and the page accepts it", () => {
    const p = toProduct(row(), "2026-11-11T10:00:00.000Z");
    expect(p).toMatchObject({ productId: "prod_0790d28ed34392a2e7fdda39", retailerName: "Harbour & Hide", price: 320, priceStatus: "live", availability: "in_stock", availableSizes: ["40", "42"] });
    expect(p.imageUrl).toBe("/api/cutouts/prod_0790d28ed34392a2e7fdda39/c7818ae2002c0fe4.png");
    const g = fromStoreProduct(p);
    expect(g).toMatchObject({ slot: "top", layer: "outer", subcategory: "blazer", colour: "grey", formality: 4, material: "wool", fit: "slim" });
    expect(g?.product?.imageUrl).toBe("/api/cutouts/prod_0790d28ed34392a2e7fdda39/c7818ae2002c0fe4.png");
    // Anything else that isn't https is still refused.
    expect(fromStoreProduct({ ...p, imageUrl: "/api/cutouts/../../etc/passwd" })?.product?.imageUrl).toBeUndefined();
    expect(fromStoreProduct({ ...p, imageUrl: "http://cdn.example/x.png" })?.product?.imageUrl).toBeUndefined();
  });

  it("answers each part with up to four candidates, best first, from one embedding call", async () => {
    const calls: string[][] = [];
    const ai = { embedTexts: async (texts: string[]) => (calls.push(texts), { vectors: texts.map(() => [1]) }) };
    const find = async (_pool: unknown, _v: unknown, { slot }: { slot: string }) =>
      slot === "top"
        ? [row({ title: "Navy blazer", colour: "navy", score: 0.3 }), row({ score: 0.1 }), row({ subcategory: "jeans" }), row(), row(), row()]
        : [];
    const out = await run({ service: "product_matching", payload: { garments: [blazer, { garmentId: "o1_bottom", slot: "bottom", name: "Grey trousers", subcategory: "trousers" }] } }, { pool: {}, ai, find });
    expect(calls).toEqual([["Charcoal blazer", "Grey trousers"]]);
    expect(out.status).toBe("partial");
    const [top, bottom] = out.result.matches;
    expect(top.garmentId).toBe("o1_top");
    expect(top.products).toHaveLength(PER_PART);
    expect(top.products.every((p: { attributes: { subcategory: string } }) => p.attributes.subcategory === "blazer")).toBe(true);
    expect(bottom).toEqual({ garmentId: "o1_bottom", products: [] });
  });

  it("says what's missing instead of failing quietly", async () => {
    expect((await run({ service: "product_matching", payload: { garments: [blazer] } }, { pool: null, ai: null })).status).toBe("disabled");
    expect((await run({ service: "styling_recommendation", payload: {} }, { pool: {}, ai: {} })).status).toBe("disabled");
    expect((await run({ service: "product_matching", payload: { garments: [] } }, { pool: {}, ai: {} })).status).toBe("failed");
    const down = { embedTexts: async () => Promise.reject(Object.assign(new Error("503"), { status: 503 })) };
    expect(await run({ service: "product_matching", payload: { garments: [blazer] } }, { pool: {}, ai: down })).toMatchObject({ status: "failed", error: { code: "provider_error", retryable: true } });
  });

  it("is for test browsers unless CATALOGUE_MATCHING_FOR=everyone", () => {
    const before = process.env.CATALOGUE_MATCHING_FOR;
    delete process.env.CATALOGUE_MATCHING_FOR;
    expect(testOnly()).toBe(true);
    process.env.CATALOGUE_MATCHING_FOR = "everyone";
    expect(testOnly()).toBe(false);
    if (before === undefined) delete process.env.CATALOGUE_MATCHING_FOR;
    else process.env.CATALOGUE_MATCHING_FOR = before;
  });
});
