/**
 * Store pieces for a look from the imported catalogue (Postgres, filled by npm run retailers:import and
 * npm run catalogue:process). Answers product_matching: for each part of a look, up to four live,
 * in-stock pieces of the same kind (or a close stand-in), each with its cut-out.
 *
 * How a part is matched:
 * 1. Its words (colour, material, name) are embedded by the ai service, in the same space as the pieces'
 *    vectors, and pgvector returns the nearest pieces in the part's slot (server/search.mjs nearest).
 * 2. The same kind rules as the Shopify feed apply (server/providers/shopify-feed.mjs score): the same
 *    layer, and the same subcategory or a close stand-in (src/shared/ontology.mjs STANDS_IN_FOR).
 * 3. Among those, the exact kind counts most, then closeness of meaning, colour and formality.
 * The page's composer makes the final choice (src/core/catalogue/compose.ts).
 *
 * Each piece's picture is its cut-out on this server (/api/cutouts/...), so the page shows the garment
 * alone on a clear background.
 *
 * AI_PROVIDER_PRODUCT_MATCHING=catalogue  switches it on (needs DATABASE_URL and AI_SERVICE_URL).
 * CATALOGUE_MATCHING_FOR  "test" (default): only a browser that opened the site with ?stock=live uses it.
 *                         "everyone": every visitor. A retailer has to agree before customers see its pieces.
 *
 * Nothing about the customer is sent anywhere: only the look's own words are embedded, on our ai service.
 */
import { classify, colourOf, fitOf, materialOf, STANDS_IN_FOR } from "../../src/shared/ontology.mjs";
import { createAiService } from "../ai-service.mjs";
import { db } from "../db.mjs";
import { cutoutPath, nearest } from "../search.mjs";

export const id = "catalogue";
export const billable = false;
export const SERVICES = ["product_matching"];
export const version = "pgvector-1";
export const testOnly = () => (process.env.CATALOGUE_MATCHING_FOR ?? "test").trim() !== "everyone";

/** Candidates returned per part, as the Shopify feed. */
export const PER_PART = 4;
/** Nearest pieces read per part before the kind rules narrow them. */
const READ_PER_PART = 24;

/** The words a part is searched by: its colour and material when known, then its name. */
export function queryFor(garment) {
  const name = String(garment?.name ?? "").trim();
  // "Charcoal blazer" already says grey: a colour is added only when the name doesn't name one of its family.
  const colour = garment?.colour && colourOf(name) !== garment.colour ? garment.colour : "";
  const material = garment?.material && !name.toLowerCase().includes(String(garment.material).toLowerCase()) ? garment.material : "";
  return [colour, material, name].filter(Boolean).join(" ").slice(0, 200);
}

/**
 * How well a catalogue piece fits a part. -1: not a candidate (another slot or layer, or a kind that
 * doesn't stand in). Otherwise closeness of meaning (0 to 100) plus the kind, colour and formality.
 */
export function rank(garment, row) {
  if (row.slot !== garment.slot) return -1;
  if (garment.layer && (row.layer ?? null) !== garment.layer) return -1;
  let s = Math.max(0, Number(row.score) || 0) * 100;
  if (garment.subcategory) {
    if (row.subcategory === garment.subcategory) s += 20;
    else if ((STANDS_IN_FOR[garment.subcategory] ?? []).includes(row.subcategory)) s += 10;
    else return -1;
  }
  const wantColour = garment.colour ?? colourOf(garment.name ?? "");
  if (wantColour && row.colour === wantColour) s += 5;
  const formality = classify(row.title ?? "")?.formality;
  if (typeof garment.formality === "number" && typeof formality === "number") s -= 2 * Math.abs(formality - garment.formality);
  return s;
}

/** A catalogue piece in the page's store-product shape (src/core/catalogue/garment.ts fromStoreProduct). */
export function toProduct(row, at) {
  const kind = classify(row.title ?? "");
  const sizes = Array.isArray(row.sizes) ? row.sizes : [];
  const material = materialOf(row.title ?? "") ?? materialOf(row.description ?? "");
  const fit = fitOf(`${row.title ?? ""} ${row.description ?? ""}`);
  const url = row.product_url ?? undefined;
  return {
    productId: row.product_id,
    retailerId: row.retailer_id,
    retailerName: row.retailer,
    price: Number(row.price_amount) || 0,
    currency: row.currency === "USD" ? "USD" : row.currency,
    priceStatus: "live",
    availability: "in_stock",
    ...(sizes.length ? { availableSizes: sizes, sizeAvailability: Object.fromEntries(sizes.map((s) => [s, "in_stock"])) } : {}),
    ...(url ? { productUrl: url, purchase: { kind: "retailer_site", url } } : {}),
    imageUrl: cutoutPath(row.cutout_url),
    lastUpdatedAt: at,
    title: row.title,
    attributes: {
      slot: row.slot,
      ...(row.layer ? { layer: row.layer } : {}),
      subcategory: row.subcategory,
      ...(kind?.formality ? { formality: kind.formality } : {}),
      ...(row.colour ? { colour: row.colour } : {}),
      ...(material ? { material } : {}),
      ...(fit ? { fit } : {}),
      ...(row.brand ? { brand: String(row.brand).slice(0, 60) } : {}),
      styleAttributes: [],
    },
  };
}

export async function run(request, { signal, pool = db(), ai = createAiService(), find = nearest, now = () => new Date() } = {}) {
  void signal;
  if (!pool || !ai) return { status: "disabled", error: { code: "not_connected", message: "The catalogue needs DATABASE_URL and AI_SERVICE_URL.", retryable: false } };
  if (request?.service !== "product_matching") return { status: "disabled", error: { code: "not_connected", message: "The catalogue matches pieces only.", retryable: false } };
  const garments = Array.isArray(request.payload?.garments) ? request.payload.garments.slice(0, 24) : [];
  if (!garments.length) return { status: "failed", error: { code: "validation_error", message: "No pieces to match.", retryable: false } };
  const usable = garments.filter((g) => g && typeof g.garmentId !== "undefined" && ["top", "bottom", "shoes", "extras"].includes(g.slot) && queryFor(g));

  let vectors = [];
  try {
    if (usable.length) ({ vectors } = await ai.embedTexts(usable.map(queryFor)));
  } catch (e) {
    return { status: "failed", error: { code: "provider_error", message: "The ai service couldn't read the look just now.", retryable: e?.status !== 422 } };
  }
  const at = now().toISOString();
  const found = new Map();
  try {
    await Promise.all(
      usable.map(async (g, i) => {
        const rows = await find(pool, vectors[i], { slot: g.slot, limit: READ_PER_PART });
        const ranked = rows
          .map((row) => ({ row, s: rank(g, row) }))
          .filter((x) => x.s >= 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, PER_PART);
        found.set(String(g.garmentId), ranked.map(({ row }) => toProduct(row, at)));
      }),
    );
  } catch (e) {
    return { status: "failed", error: { code: "provider_error", message: String(e?.message ?? "The catalogue could not be read."), retryable: true } };
  }
  const matches = garments.map((g) => ({ garmentId: String(g?.garmentId), products: found.get(String(g?.garmentId)) ?? [] }));
  const hits = matches.filter((m) => m.products.length).length;
  return {
    status: hits === 0 ? "empty" : hits === matches.length ? "succeeded" : "partial",
    result: { matches },
    metadata: { source: "catalogue", parts: matches.length, matched: hits },
  };
}
