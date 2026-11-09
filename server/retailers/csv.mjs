/**
 * A retailer's catalogue from a CSV file, one row per variant (one size of one piece). The columns are
 * documented in docs/CATALOGUE.md ("CSV catalogue files"). Rows of the same product_id make one piece;
 * its product columns are read from its first row. A row that breaks the spec is left out and listed in
 * `rejected` with its line number and reasons, never guessed at.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { plainText } from "./connector.mjs";

export const REQUIRED_COLUMNS = ["product_id", "title", "product_url", "price", "currency"];
export const OPTIONAL_COLUMNS = ["brand", "description", "image_urls", "product_type", "tags", "variant_id", "size", "colour", "sku", "available", "stock_quantity"];

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and line breaks; CRLF or LF; a BOM is dropped. */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

const YES = new Set(["true", "yes", "y", "1", "in_stock", "in stock"]);
const NO = new Set(["false", "no", "n", "0", "out_of_stock", "out of stock", "sold out"]);
const list = (v, sep) => String(v ?? "").split(sep).map((s) => s.trim()).filter(Boolean);
const httpsOnly = (v) => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

/** Turns parsed rows into normalised items and a list of rejected rows. */
export function itemsFromRows(rows) {
  const [header = [], ...body] = rows;
  const columns = header.map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length) throw new Error(`The CSV has no ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}.`);
  const byProduct = new Map();
  const rejected = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    const r = Object.fromEntries(columns.map((c, j) => [c, (cells[j] ?? "").trim()]));
    const why = [];
    for (const c of REQUIRED_COLUMNS) if (!r[c]) why.push(`${c} is empty`);
    const price = Number(r.price);
    if (r.price && !(Number.isFinite(price) && price >= 0)) why.push("price is not a number of at least 0");
    if (r.currency && !/^[A-Za-z]{3}$/.test(r.currency)) why.push("currency is not a three-letter code");
    if (r.product_url && !httpsOnly(r.product_url)) why.push("product_url is not an https address");
    const stock = r.stock_quantity === "" || r.stock_quantity === undefined ? null : Number(r.stock_quantity);
    if (stock !== null && !(Number.isInteger(stock) && stock >= 0)) why.push("stock_quantity is not a whole number");
    const flag = (r.available ?? "").toLowerCase();
    if (flag && !YES.has(flag) && !NO.has(flag)) why.push("available is not yes or no");
    const badImages = list(r.image_urls, /[|\s]+/).filter((u) => !httpsOnly(u));
    if (badImages.length) why.push("an image_urls entry is not an https address");
    if (why.length) return rejected.push({ line, productId: r.product_id || null, reasons: why });

    const available = flag ? YES.has(flag) : stock === null ? true : stock > 0;
    const variant = {
      externalId: r.variant_id || `${r.product_id}:${r.size || "one-size"}`,
      size: r.size || null,
      colour: r.colour || null,
      sku: r.sku || null,
      price,
      currency: r.currency.toUpperCase(),
      available,
      stockQuantity: stock,
    };
    const item = byProduct.get(r.product_id);
    if (item) {
      if (item.variants.some((v) => v.externalId === variant.externalId)) return rejected.push({ line, productId: r.product_id, reasons: ["variant repeats an earlier row"] });
      item.variants.push(variant);
      return;
    }
    byProduct.set(r.product_id, {
      externalId: r.product_id,
      title: r.title,
      brand: r.brand || null,
      description: plainText(r.description),
      images: list(r.image_urls, /[|\s]+/),
      price,
      currency: r.currency.toUpperCase(),
      productUrl: r.product_url,
      productType: r.product_type || null,
      tags: list(r.tags, "|"),
      variants: [variant],
    });
  });
  const items = [...byProduct.values()].map((item) => ({ ...item, price: Math.min(...item.variants.map((v) => v.price)) }));
  return { items, rejected };
}

/** A connector for one CSV file: createCsvConnector({ path, name, id }). `rejected` fills once items() has run. */
export function createCsvConnector({ path, name = null, id = null, read = (p) => readFile(p, "utf8") } = {}) {
  if (!path) throw new Error("A CSV connector needs the file's path.");
  const connector = {
    id: id ?? `csv:${basename(path)}`,
    kind: "csv",
    source: path,
    rejected: [],
    async name() {
      return name ?? basename(path).replace(/\.csv$/i, "");
    },
    async items() {
      const { items, rejected } = itemsFromRows(parseCsv(await read(path)));
      connector.rejected = rejected;
      return items;
    },
  };
  return connector;
}
