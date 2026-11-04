/**
 * The one shape every retailer connector returns, whatever the source (a Shopify store, a CSV file, an
 * affiliate feed later). The import (server/retailers/import.mjs) only ever sees this shape.
 *
 * A connector is { id, kind, source, name(): Promise<string>, items(): Promise<NormalisedItem[]> }.
 *
 * @typedef {object} NormalisedVariant
 * @property {string} externalId      the retailer's own variant id
 * @property {string|null} size
 * @property {string|null} colour
 * @property {string|null} sku
 * @property {number} price           in `currency`, at least 0
 * @property {string} currency        ISO 4217, three capital letters
 * @property {boolean} available      in stock
 * @property {number|null} stockQuantity  null when the retailer only says in or out
 *
 * @typedef {object} NormalisedItem
 * @property {string} externalId      the retailer's own product id, stable between imports
 * @property {string} title
 * @property {string|null} brand
 * @property {string|null} description  plain text
 * @property {string[]} images        https addresses, the first is the main photo
 * @property {number} price           the lowest variant price
 * @property {string} currency
 * @property {string} productUrl      https address of the piece on the retailer's site
 * @property {string|null} productType  the retailer's own category, as given
 * @property {string[]} tags
 * @property {NormalisedVariant[]} variants  at least one
 */

const CURRENCY = /^[A-Z]{3}$/;
const isText = (v) => typeof v === "string" && v.trim().length > 0;
const isHttps = (v) => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};
const isPrice = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** What is wrong with an item, as a list of short reasons; empty when it meets the contract. */
export function problemsWith(item) {
  const out = [];
  if (!item || typeof item !== "object") return ["not an object"];
  if (!isText(item.externalId)) out.push("externalId missing");
  if (!isText(item.title)) out.push("title missing");
  if (item.brand !== null && !isText(item.brand)) out.push("brand must be text or null");
  if (item.description !== null && typeof item.description !== "string") out.push("description must be text or null");
  if (!Array.isArray(item.images) || !item.images.every(isHttps)) out.push("images must be https addresses");
  if (!isPrice(item.price)) out.push("price must be a number of at least 0");
  if (!CURRENCY.test(item.currency ?? "")) out.push("currency must be a three-letter code");
  if (!isHttps(item.productUrl)) out.push("productUrl must be an https address");
  if (item.productType !== null && !isText(item.productType)) out.push("productType must be text or null");
  if (!Array.isArray(item.tags) || !item.tags.every((t) => typeof t === "string")) out.push("tags must be a list of text");
  if (!Array.isArray(item.variants) || item.variants.length === 0) {
    out.push("at least one variant");
  } else {
    item.variants.forEach((v, i) => {
      if (!isText(v?.externalId)) out.push(`variant ${i}: externalId missing`);
      if (v?.size !== null && !isText(v?.size)) out.push(`variant ${i}: size must be text or null`);
      if (!isPrice(v?.price)) out.push(`variant ${i}: price must be a number of at least 0`);
      if (!CURRENCY.test(v?.currency ?? "")) out.push(`variant ${i}: currency must be a three-letter code`);
      if (typeof v?.available !== "boolean") out.push(`variant ${i}: available must be true or false`);
      if (v?.stockQuantity !== null && !(Number.isInteger(v?.stockQuantity) && v.stockQuantity >= 0)) out.push(`variant ${i}: stockQuantity must be a whole number or null`);
    });
    const ids = item.variants.map((v) => v?.externalId);
    if (new Set(ids).size !== ids.length) out.push("variant externalIds repeat");
  }
  return out;
}

/** Plain text from HTML, collapsed, at most 2000 characters. */
export function plainText(html) {
  const text = String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
  return text || null;
}
