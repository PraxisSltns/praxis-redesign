/**
 * POST /api/search: pieces like a few words or a photo, from the imported catalogue.
 *
 *   { "text": "navy wool blazer" }  or  { "image": "<base64 or data: URL>" }
 *   optional: "size": "40" (only pieces in stock in that size), "slot": "top", "limit": 1 to 50 (default 12)
 *
 * The query is embedded by the ai service (Marqo-FashionSigLIP, the same space as the products' cut-outs),
 * then pgvector ranks live, slotted, in-stock products by cosine distance on the HNSW index. Each item
 * carries its cut-out's address on this server (GET /api/cutouts/...), which streams it from the bucket.
 *
 * When the words name a kind of piece ("navy blazer", "brown leather belt", by the shared ontology) and no
 * slot is given, the search keeps to that kind's slot and puts the closest of that exact kind first; only if the slot has
 * too few pieces does it fill up with the nearest others. The answer says what it understood (query.kind).
 */
import { classify } from "../src/shared/ontology.mjs";
import { createAiService, toVector } from "./ai-service.mjs";
import { db } from "./db.mjs";
import { storage } from "./storage.mjs";

export const MAX_QUERY_IMAGE_BYTES = 8 * 1024 * 1024;
const SLOTS = ["top", "bottom", "shoes", "extras"];

/** Checks and normalises a search body. Returns { query } or { error }. */
export function readQuery(body) {
  if (!body || typeof body !== "object") return { error: "Send a JSON object." };
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 300) : "";
  let image = null;
  if (typeof body.image === "string" && body.image) {
    const b64 = body.image.replace(/^data:image\/[a-z+.-]+;base64,/i, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { error: "image must be base64." };
    image = Buffer.from(b64, "base64");
    if (image.length > MAX_QUERY_IMAGE_BYTES) return { error: "image is larger than 8 MB." };
  }
  if (!text === !image) return { error: "Send either text or image." };
  if (body.slot != null && !SLOTS.includes(body.slot)) return { error: `slot must be one of ${SLOTS.join(", ")}.` };
  if (body.size != null && (typeof body.size !== "string" || !body.size.trim() || body.size.length > 20)) return { error: "size must be text." };
  const limit = body.limit == null ? 12 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return { error: "limit must be a whole number from 1 to 50." };
  return { query: { text: text || null, image, slot: body.slot ?? null, size: body.size?.trim() ?? null, limit } };
}

/** The nearest live, slotted, in-stock products to a vector, with their in-stock sizes. */
export async function nearest(pool, vector, { slot = null, size = null, limit = 12, retailerId = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Keep scanning the HNSW index until enough rows pass the filters (pgvector 0.8), instead of stopping at ef_search.
    await client.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
    const { rows } = await client.query(
      `SELECT p.product_id, p.title, p.brand, p.slot, p.layer, p.subcategory, p.colour, p.price_amount, p.currency,
              p.product_url, p.images->>0 AS image, p.cutout_url, r.name AS retailer, p.retailer_id, p.description,
              1 - (p.embedding <=> $1::vector) AS score,
              (SELECT array_agg(v.size ORDER BY v.size) FROM product_variants v WHERE v.product_id = p.product_id AND v.available AND v.size IS NOT NULL) AS sizes
       FROM products p JOIN retailers r USING (retailer_id)
       WHERE p.embedding IS NOT NULL AND p.cutout_url IS NOT NULL AND p.removed_at IS NULL AND p.slot IS NOT NULL
         AND ($2::text IS NULL OR p.slot = $2)
         AND ($5::text IS NULL OR p.retailer_id = $5)
         AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.product_id AND v.available AND ($3::text IS NULL OR v.size = $3))
       ORDER BY p.embedding <=> $1::vector
       LIMIT $4`,
      [toVector(vector), slot, size, limit, retailerId],
    );
    await client.query("COMMIT");
    return rows;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * The nearest pieces in the kind's slot: the closest of that exact kind first, then the rest by closeness
 * (so "navy blazer" can show a navy suit jacket before a charcoal blazer). Filled up from other slots only
 * when the slot runs out.
 */
export async function withinKind(pool, vector, kind, query) {
  const inSlot = await nearest(pool, vector, { ...query, slot: kind.slot });
  const best = inSlot.find((r) => r.subcategory === kind.subcategory);
  const ordered = best ? [best, ...inSlot.filter((r) => r !== best)] : inSlot;
  if (ordered.length >= query.limit) return ordered.slice(0, query.limit);
  const seen = new Set(ordered.map((r) => r.product_id));
  const others = (await nearest(pool, vector, { ...query, slot: null, limit: query.limit + ordered.length })).filter((r) => !seen.has(r.product_id));
  return [...ordered, ...others].slice(0, query.limit);
}

export const cutoutPath = (key) => `/api/cutouts/${key.replace(/^cutouts\//, "")}`;

export function toItem(r) {
  return {
    productId: r.product_id,
    title: r.title,
    brand: r.brand,
    retailer: r.retailer,
    slot: r.slot,
    ...(r.layer ? { layer: r.layer } : {}),
    subcategory: r.subcategory,
    colour: r.colour,
    price: r.price_amount === null ? null : Number(r.price_amount),
    currency: r.currency,
    productUrl: r.product_url,
    image: r.image,
    cutoutUrl: cutoutPath(r.cutout_url),
    sizes: r.sizes ?? [],
    score: Math.round(Number(r.score) * 1000) / 1000,
  };
}

/**
 * Runs a search. Throws { status, message } for the route to answer. `retailerId` narrows it to one
 * retailer: for tests and operators, not part of the HTTP body.
 */
export async function search(body, { pool = db(), ai = createAiService(), retailerId = null } = {}) {
  const started = Date.now();
  const { query, error } = readQuery(body);
  if (error) throw { status: 400, message: error };
  if (!pool || !ai) throw { status: 503, message: "Search isn't set up on this server." };
  const embedStarted = Date.now();
  let vectors;
  try {
    ({ vectors } = query.text ? await ai.embedTexts([query.text]) : await ai.embedImages([query.image]));
  } catch (e) {
    throw { status: e?.status === 422 ? 422 : 502, message: e?.status === 422 ? "The image couldn't be read." : "The search couldn't be run just now." };
  }
  const embedMs = Date.now() - embedStarted;
  const searchStarted = Date.now();
  const kind = query.text && !query.slot ? classify(query.text) : null;
  const rows = kind ? await withinKind(pool, vectors[0], kind, { ...query, retailerId }) : await nearest(pool, vectors[0], { ...query, retailerId });
  return {
    query: { ...(query.text ? { text: query.text } : { image: true }), slot: query.slot, size: query.size, limit: query.limit, ...(kind ? { kind: { slot: kind.slot, subcategory: kind.subcategory } } : {}) },
    items: rows.map(toItem),
    ms: { embed: embedMs, search: Date.now() - searchStarted, total: Date.now() - started },
  };
}

/** POST /api/search */
export async function handleSearch(req, res, readBody) {
  const reply = (status, payload) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(payload));
  };
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return reply(415, { error: "Send JSON." });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return reply(e?.code === "too_large" ? 413 : 400, { error: "The request could not be read." });
  }
  try {
    return reply(200, await search(body));
  } catch (e) {
    if (e?.status) return reply(e.status, { error: e.message });
    console.error(JSON.stringify({ type: "search_error", at: new Date().toISOString(), name: e?.name ?? "Error", code: e?.code ?? null }));
    return reply(500, { error: "The search couldn't be run just now." });
  }
}

const CUTOUT_PATH = /^\/api\/cutouts\/(prod_[0-9a-f]{24})\/([0-9a-f]{16})\.png$/;

/** GET /api/cutouts/<product>/<hash>.png: a cut-out, streamed from the private bucket. */
export async function handleCutout(req, res, pathname, bucket = storage()) {
  const m = CUTOUT_PATH.exec(pathname);
  if (!m || !bucket) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  try {
    const obj = await bucket.get(`cutouts/${m[1]}/${m[2]}.png`);
    if (!obj) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable", ...(obj.length ? { "Content-Length": obj.length } : {}) });
    if (req.method === "HEAD") return res.end();
    obj.body.pipe(res);
  } catch {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end();
  }
}

export const isCutoutPath = (pathname) => pathname.startsWith("/api/cutouts/");
