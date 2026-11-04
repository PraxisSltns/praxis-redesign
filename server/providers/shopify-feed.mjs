/**
 * Real pieces for testing, from one menswear store's public Shopify product list (/products.json, read
 * page by page, up to 1000 pieces): names, prices, photos and stock by size. Answers product_matching:
 * for each part of a look, up to four of the store's pieces of the same kind (or a close stand-in),
 * filed by the shared ontology (src/shared/ontology.mjs) with formality, colour, material and fit.
 * The page's composer picks one or keeps the Praxis reference (src/core/catalogue/compose.ts).
 *
 * What this list gives: product and variant ids, title, type, vendor, tags, description, photos, each
 * variant's price and whether it is available. What it doesn't: stock quantities (only in or out per
 * variant), compare-at currency (prices are the store's own currency, assumed USD for a US store).
 *
 * Free and keyless, but not an official API: it is for private testing. Before customers see a
 * store's pieces, the store has to agree (or an affiliate feed takes over).
 *
 * RETAIL_SHOPIFY_STORE  the store's address, for example www.taylorstitch.com. Unset: off.
 * RETAIL_SHOPIFY_NAME   the name shown on its pieces (default: the store's own name).
 * RETAIL_SHOPIFY_FOR    "test" (default): only a browser that opened the site with ?stock=live uses it.
 *                       "everyone": every visitor.
 *
 * Nothing about the customer is sent to the store: the list is read whole and matched here.
 */
import { classify, colourOf, fitOf, materialOf, STANDS_IN_FOR } from "../../src/shared/ontology.mjs";
import { readShopifyName, readShopifyProducts } from "../retailers/shopify.mjs";

export const id = "shopify-feed";
export const billable = false;
export const SERVICES = ["product_matching"];

const STORE = () => (process.env.RETAIL_SHOPIFY_STORE ?? "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
export const version = STORE() || "off";
/** Whether only test browsers use it (see liveServices in server/ai.mjs). */
export const testOnly = () => (process.env.RETAIL_SHOPIFY_FOR ?? "test").trim() !== "everyone";

const PAGES = 4;
const KEEP_MS = 30 * 60 * 1000;

/** Candidates returned per part; the page's composer makes the final choice (src/core/catalogue/compose.ts). */
const PER_PART = 4;

/** What a store piece is, by the shared ontology (src/shared/ontology.mjs). Null for anything Praxis doesn't style. */
function kindOf(product) {
  const tags = Array.isArray(product.tags) ? product.tags : String(product.tags ?? "").split(",");
  // The name says best what a piece is; the store's type next; its tags only when both are silent.
  return classify(String(product.title ?? ""), product.product_type ?? "") ?? classify(tags.join(" "));
}

/** The slot alone. */
export function slotOf(product) {
  return kindOf(product)?.slot ?? null;
}

const plain = (html) => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").slice(0, 2000);

/** The colour named on a variant option called Color or Colour. */
function optionColour(p) {
  const i = (p.options ?? []).findIndex((o) => /colou?r/i.test(o?.name ?? ""));
  if (i < 0) return undefined;
  const value = (p.variants ?? []).map((v) => v[`option${i + 1}`]).find(Boolean);
  return value ? colourOf(String(value)) : undefined;
}

/** How the store's piece reads in the ontology: kind, formality, colour, material, fit, brand and its own tags. */
export function attributesOf(p) {
  const kind = kindOf(p);
  if (!kind) return null;
  const tags = (Array.isArray(p.tags) ? p.tags : String(p.tags ?? "").split(",")).map((t) => String(t).trim()).filter((t) => t && t.length <= 30 && !/[:_]/.test(t));
  const body = plain(p.body_html);
  const variant = (p.variants ?? []).find((v) => v.available) ?? (p.variants ?? [])[0];
  const colour = colourOf(p.title ?? "") ?? optionColour(p) ?? colourOf(tags.join(" "));
  const material = materialOf(`${p.title ?? ""} ${tags.join(" ")}`) ?? materialOf(body);
  const fit = fitOf(`${p.title ?? ""} ${tags.join(" ")} ${body}`);
  return {
    ...kind,
    ...(colour ? { colour } : {}),
    ...(material ? { material } : {}),
    ...(fit ? { fit } : {}),
    ...(p.vendor ? { brand: String(p.vendor).slice(0, 60) } : {}),
    styleAttributes: tags.slice(0, 8),
    ...(variant?.id ? { variantId: String(variant.id) } : {}),
  };
}

const words = (text) => new Set(String(text).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2));

/** A store piece in Praxis's ProductRef shape. Sizes come from the variant option named Size, else the first option. */
export function toProduct(p, store, name, at) {
  const sizeIndex = Math.max(0, (p.options ?? []).findIndex((o) => /size/i.test(o?.name ?? "")));
  const key = `option${sizeIndex + 1}`;
  const sizeAvailability = {};
  for (const v of p.variants ?? []) {
    const size = String(v[key] ?? v.title ?? "").trim();
    if (!size || size === "Default Title") continue;
    sizeAvailability[size] = v.available ? "in_stock" : sizeAvailability[size] === "in_stock" ? "in_stock" : "out_of_stock";
  }
  const sizes = Object.keys(sizeAvailability);
  const anyIn = (p.variants ?? []).some((v) => v.available);
  const prices = (p.variants ?? []).map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0);
  const url = `https://${store}/products/${encodeURIComponent(p.handle)}`;
  return {
    productId: `shopify_${store}_${p.id}`,
    retailerId: store,
    retailerName: name,
    category: p.product_type || undefined,
    price: prices.length ? Math.min(...prices) : 0,
    currency: "USD",
    priceStatus: "live",
    availability: anyIn ? "in_stock" : "out_of_stock",
    ...(sizes.length ? { availableSizes: sizes, sizeAvailability } : {}),
    productUrl: url,
    ...(p.images?.[0]?.src ? { imageUrl: String(p.images[0].src).replace(/^\/\//, "https://") } : {}),
    // The store's own photos, so the page can show the piece worn (see modelPhoto in src/core/ai/stock.ts).
    photos: (p.images ?? []).slice(0, 6).filter((i) => i?.src).map((i) => ({ src: String(i.src).replace(/^\/\//, "https://"), alt: String(i.alt ?? "").slice(0, 120), width: Number(i.width) || undefined, height: Number(i.height) || undefined })),
    lastUpdatedAt: at,
    purchase: { kind: "retailer_site", url },
    title: p.title,
    attributes: attributesOf(p),
  };
}

/**
 * How close a store piece is to a part of a look, to shortlist candidates. The same kind and layer are
 * required (or a close stand-in when the part names its kind); then colour, formality, words and stock.
 * -1: not a candidate. The page's composer decides whether the best is good enough.
 */
export function score(garment, product, attrs) {
  if (!attrs || attrs.slot !== garment.slot) return -1;
  if (garment.layer && (attrs.layer ?? null) !== garment.layer) return -1;
  let s = 0;
  if (garment.subcategory) {
    if (attrs.subcategory === garment.subcategory) s += 20;
    else if ((STANDS_IN_FOR[garment.subcategory] ?? []).includes(attrs.subcategory)) s += 10;
    else return -1;
  }
  const wantColour = garment.colour ?? colourOf(garment.name);
  if (wantColour && attrs.colour === wantColour) s += 5;
  if (typeof garment.formality === "number") s -= 2 * Math.abs(attrs.formality - garment.formality);
  const have = words(`${product.title} ${product.product_type ?? ""}`);
  for (const x of words(garment.name)) if (have.has(x) || have.has(x.replace(/s$/, ""))) s += 3;
  // A sold out piece can't be bought, so stock outweighs a colour match.
  if ((product.variants ?? []).some((v) => v.available)) s += 6;
  return s;
}

let catalogue = null;
export function resetCatalogue() {
  catalogue = null;
}

async function readCatalogue(store, fetcher, signal) {
  if (catalogue && catalogue.store === store && Date.now() - catalogue.at < KEEP_MS) return catalogue;
  // The list is read the same way as the catalogue import's (server/retailers/shopify.mjs).
  const products = await readShopifyProducts(store, { fetcher, signal, pages: PAGES });
  const name = (process.env.RETAIL_SHOPIFY_NAME ?? "").trim() || (await readShopifyName(store, { fetcher, signal })) || "";
  const usable = products.map((p) => ({ p, attrs: attributesOf(p) })).filter((x) => x.attrs && x.p.handle);
  catalogue = { store, name: name || store.replace(/^www\./, ""), at: Date.now(), checkedAt: new Date().toISOString(), items: usable };
  return catalogue;
}

export async function run(request, { signal, fetcher = fetch } = {}) {
  const store = STORE();
  if (!store) return { status: "disabled", error: { code: "not_connected", message: "No store is set on the server.", retryable: false } };
  if (request?.service !== "product_matching") return { status: "disabled", error: { code: "not_connected", message: "The store feed matches pieces only.", retryable: false } };
  const garments = Array.isArray(request.payload?.garments) ? request.payload.garments.slice(0, 24) : [];
  if (!garments.length) return { status: "failed", error: { code: "validation_error", message: "No pieces to match.", retryable: false } };
  let cat;
  try {
    cat = await readCatalogue(store, fetcher, signal);
  } catch (e) {
    return { status: "failed", error: { code: "provider_error", message: String(e?.message ?? "The store could not be read."), retryable: !(e?.status >= 400 && e?.status < 500) } };
  }
  const matches = garments.map((g) => {
    const ranked = cat.items
      .map(({ p, attrs }) => ({ p, s: score(g, p, attrs) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, PER_PART);
    return { garmentId: String(g.garmentId), products: ranked.map(({ p }) => toProduct(p, store, cat.name, cat.checkedAt)) };
  });
  const found = matches.filter((m) => m.products.length).length;
  return {
    status: found === 0 ? "empty" : found === matches.length ? "succeeded" : "partial",
    result: { matches },
    metadata: { store, catalogue: cat.items.length },
  };
}
