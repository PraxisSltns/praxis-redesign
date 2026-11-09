/**
 * A Shopify store as a retailer connector, from its public product list (/products.json, 250 a page).
 * Grown out of server/providers/shopify-feed.mjs, which now reads the list through readShopifyProducts.
 *
 * The public list gives ids, title, vendor, type, tags, description, photos and, per variant, its
 * options, price and whether it is available. It gives no currency (set per store, USD by default) and
 * no stock counts, so stockQuantity is always null. It is keyless and not an official API: for testing
 * and for stores that agreed; an affiliate or Storefront API feed replaces it for customers.
 */
import { plainText } from "./connector.mjs";

/** Stores are read over https; one on this machine (a stand-in for tests) over plain http. */
export const storeBase = (store) => `${/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(store) ? "http" : "https"}://${store}`;

/** The store's address without scheme or path: "https://www.x.com/collections" -> "www.x.com". */
export const storeAddress = (value) => String(value ?? "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

/** Every product on the store's public list, page by page, up to `pages` pages. Throws if the first page fails. */
export async function readShopifyProducts(store, { fetcher = fetch, signal, pages = 4 } = {}) {
  const products = [];
  for (let page = 1; page <= pages; page += 1) {
    const res = await fetcher(`${storeBase(store)}/products.json?limit=250&page=${page}`, { signal, headers: { Accept: "application/json", "User-Agent": "Praxis/1.0 (catalogue import)" } });
    if (!res.ok) {
      if (page === 1) throw Object.assign(new Error(`The store answered ${res.status}.`), { status: res.status });
      break;
    }
    const batch = (await res.json())?.products;
    if (!Array.isArray(batch) || !batch.length) break;
    products.push(...batch);
    if (batch.length < 250) break;
  }
  return products;
}

/** The store's own name from /meta.json, or null. */
export async function readShopifyName(store, { fetcher = fetch, signal } = {}) {
  try {
    const name = String((await (await fetcher(`${storeBase(store)}/meta.json`, { signal })).json())?.name ?? "").trim();
    return name || null;
  } catch {
    return null;
  }
}

const https = (src) => String(src ?? "").replace(/^\/\//, "https://");

/** One Shopify product in the normalised shape (server/retailers/connector.mjs). */
export function normaliseShopify(p, store, currency = "USD") {
  const optionIndex = (re) => (p.options ?? []).findIndex((o) => re.test(o?.name ?? ""));
  const sizeAt = optionIndex(/size/i);
  const colourAt = optionIndex(/colou?r/i);
  // With no option called Size, a single option is taken as the size (as the live feed does).
  const sizeKey = sizeAt >= 0 ? `option${sizeAt + 1}` : (p.options ?? []).length === 1 && colourAt < 0 ? "option1" : null;
  const colourKey = colourAt >= 0 ? `option${colourAt + 1}` : null;
  const variants = (p.variants ?? []).map((v) => {
    const size = sizeKey ? String(v[sizeKey] ?? "").trim() : "";
    const colour = colourKey ? String(v[colourKey] ?? "").trim() : "";
    const price = Number(v.price);
    return {
      externalId: String(v.id),
      size: size && size !== "Default Title" ? size : null,
      colour: colour || null,
      sku: v.sku ? String(v.sku) : null,
      price: Number.isFinite(price) && price >= 0 ? price : 0,
      currency,
      available: v.available === true,
      stockQuantity: null,
    };
  });
  const prices = variants.map((v) => v.price).filter((n) => n > 0);
  const tags = (Array.isArray(p.tags) ? p.tags : String(p.tags ?? "").split(",")).map((t) => String(t).trim()).filter(Boolean);
  return {
    externalId: String(p.id),
    title: String(p.title ?? "").trim(),
    brand: p.vendor ? String(p.vendor).trim() : null,
    description: plainText(p.body_html),
    images: (p.images ?? []).map((i) => https(i?.src)).filter((src) => src.startsWith("https://")),
    price: prices.length ? Math.min(...prices) : 0,
    currency,
    productUrl: `https://${store}/products/${encodeURIComponent(p.handle ?? p.id)}`,
    productType: p.product_type ? String(p.product_type).trim() : null,
    tags,
    variants,
  };
}

/** A connector for one store: createShopifyConnector({ store: "www.x.com" }). */
export function createShopifyConnector({ store, name = null, currency = "USD", fetcher = fetch, pages = 10 } = {}) {
  const address = storeAddress(store);
  if (!address) throw new Error("A Shopify connector needs the store's address.");
  return {
    id: `shopify:${address}`,
    kind: "shopify",
    source: address,
    async name() {
      return name ?? (await readShopifyName(address, { fetcher })) ?? address.replace(/^www\./, "");
    },
    async items({ signal } = {}) {
      const products = await readShopifyProducts(address, { fetcher, signal, pages });
      return products.filter((p) => p && p.id != null && (p.variants ?? []).length).map((p) => normaliseShopify(p, address, currency));
    },
  };
}
