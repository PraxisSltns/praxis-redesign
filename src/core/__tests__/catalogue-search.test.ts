import { afterEach, describe, expect, it } from "vitest";
import { priceText, readFoundPiece, searchAvailable, searchCatalogue, SearchError } from "../catalogueSearch";
import { resetLiveServices } from "../ai/words";
// @ts-expect-error plain JavaScript module
import { withinKind } from "../../../server/search.mjs";

const CUTOUT = "/api/cutouts/prod_0123456789abcdef01234567/0123456789abcdef.png";
const item = (over: Record<string, unknown> = {}) => ({
  productId: "prod_0123456789abcdef01234567",
  title: "Navy Wool Blazer",
  brand: "Test Tailors",
  retailer: "Test Tailors",
  slot: "top",
  subcategory: "blazer",
  colour: "navy",
  price: 240,
  currency: "USD",
  productUrl: "https://shop.example/products/navy-wool-blazer",
  cutoutUrl: CUTOUT,
  sizes: ["38", "40", "42"],
  score: 0.31,
  ...over,
});
const reply = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as typeof fetch;

afterEach(() => resetLiveServices());

describe("a piece found by search", () => {
  it("keeps what the screen shows, and only an https store link", () => {
    const p = readFoundPiece(item());
    expect(p).toMatchObject({ title: "Navy Wool Blazer", retailer: "Test Tailors", slot: "top", price: 240, cutoutUrl: CUTOUT, productUrl: "https://shop.example/products/navy-wool-blazer", sizes: ["38", "40", "42"] });
    expect(readFoundPiece(item({ productUrl: "http://shop.example/x" }))?.productUrl).toBeUndefined();
    expect(readFoundPiece(item({ productUrl: "javascript:alert(1)" }))?.productUrl).toBeUndefined();
  });

  it("drops a piece that can't be shown: no title, an unknown slot, or a picture that isn't a cut-out on this server", () => {
    expect(readFoundPiece(item({ title: "" }))).toBeNull();
    expect(readFoundPiece(item({ slot: "hat" }))).toBeNull();
    expect(readFoundPiece(item({ cutoutUrl: "https://elsewhere.example/a.png" }))).toBeNull();
    expect(readFoundPiece(null)).toBeNull();
  });

  it("says the price in dollars, or another currency by its code, and nothing without one", () => {
    expect(priceText({ price: 98, currency: "USD" })).toBe("$98");
    expect(priceText({ price: 89.5, currency: "USD" })).toBe("$89.50");
    expect(priceText({ price: 120, currency: "GBP" })).toBe("120 GBP");
    expect(priceText({ price: null })).toBe("");
  });
});

describe("running a search", () => {
  it("sends the words, and reads the pieces and the kind it understood", async () => {
    let sent: unknown;
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ query: { text: "navy blazer", kind: { slot: "top", subcategory: "blazer" } }, items: [item(), item({ title: "" })], ms: { total: 54 } }), { status: 200 });
    }) as typeof fetch;
    const answer = await searchCatalogue({ text: "  navy blazer  " }, { fetcher });
    expect(sent).toEqual({ text: "navy blazer", limit: 24 });
    expect(answer.pieces).toHaveLength(1);
    expect(answer.understood).toBe("blazer");
    expect(answer.ms).toBe(54);
  });

  it("puts a kind with a hyphen in words", async () => {
    const answer = await searchCatalogue({ text: "boots" }, { fetcher: reply(200, { query: { kind: { subcategory: "chelsea-boots" } }, items: [] }) });
    expect(answer.understood).toBe("chelsea boots");
  });

  it("says why it failed: an unreadable photo, no search on this server, or any other error", async () => {
    await expect(searchCatalogue({ image: "data:image/jpeg;base64,AAAA" }, { fetcher: reply(422, {}) })).rejects.toMatchObject({ code: "bad_image" });
    await expect(searchCatalogue({ text: "x" }, { fetcher: reply(503, {}) })).rejects.toMatchObject({ code: "unavailable" });
    await expect(searchCatalogue({ text: "x" }, { fetcher: reply(500, {}) })).rejects.toBeInstanceOf(SearchError);
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(searchCatalogue({ text: "x" }, { fetcher: down })).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("who may search", () => {
  const live = (entries: unknown[]) => reply(200, { live: entries });
  const catalogue = { service: "product_matching", provider: "catalogue", version: "pgvector-1", billable: false };

  it("everyone, once the catalogue is open to customers", async () => {
    expect(await searchAvailable(live([catalogue]), () => false)).toBe("everyone");
  });

  it("while it's for testing, only a tab that asked for the test stores", async () => {
    expect(await searchAvailable(live([{ ...catalogue, testOnly: true }]), () => true)).toBe("test");
    resetLiveServices();
    expect(await searchAvailable(live([{ ...catalogue, testOnly: true }]), () => false)).toBeNull();
  });

  it("nobody without the catalogue, or when the matching costs money", async () => {
    expect(await searchAvailable(live([]), () => true)).toBeNull();
    resetLiveServices();
    expect(await searchAvailable(live([{ ...catalogue, billable: true }]), () => true)).toBeNull();
  });
});

describe("the order within a kind the words name", () => {
  // A pool whose search answers these rows, closest first, as nearest() would.
  const pool = (rows: Record<string, unknown>[]) => ({
    connect: async () => ({
      query: async (sql: string) => (sql.trim().startsWith("SELECT") ? { rows } : { rows: [] }),
      release() {},
    }),
  });
  const row = (id: string, subcategory: string, colour: string) => ({ product_id: id, subcategory, colour, slot: "top" });

  it("puts that kind in that colour first, closest first, then the rest by closeness", async () => {
    const rows = [row("stone", "blazer", "beige"), row("jacket", "suit-jacket", "navy"), row("navy1", "blazer", "navy"), row("navy2", "blazer", "navy")];
    const out = await withinKind(pool(rows), [0], { slot: "top", subcategory: "blazer" }, { text: "navy blazer", limit: 4 });
    expect(out.map((r: { product_id: string }) => r.product_id)).toEqual(["navy1", "navy2", "stone", "jacket"]);
  });

  it("without a colour, or with none of that colour, brings only the closest of the kind forward", async () => {
    const rows = [row("jacket", "suit-jacket", "navy"), row("stone", "blazer", "beige"), row("grey", "blazer", "grey")];
    const plain = await withinKind(pool(rows), [0], { slot: "top", subcategory: "blazer" }, { text: "blazer", limit: 3 });
    expect(plain.map((r: { product_id: string }) => r.product_id)).toEqual(["stone", "jacket", "grey"]);
    const red = await withinKind(pool(rows), [0], { slot: "top", subcategory: "blazer" }, { text: "red blazer", limit: 3 });
    expect(red.map((r: { product_id: string }) => r.product_id)).toEqual(["stone", "jacket", "grey"]);
  });
});
