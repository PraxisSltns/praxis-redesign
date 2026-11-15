/**
 * Where each store's catalogue stands, from the database (and the batch job's failures in Redis):
 *
 *   npm run retailers:report                 every store
 *   npm run retailers:report -- --store csv:harbour-and-hide    one store, by its connector id or ret_ id
 *   add --json for the same as JSON
 *
 * For each store: when it was last imported, its live pieces, how many are placed and in stock, how many
 * have a cut-out and a vector (and so can be styled and searched), how many are waiting for the batch job,
 * and which failed with the reason. Reads only.
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { closeDb, db } from "../db.mjs";
import { closeRedis, redisReady } from "../redis.mjs";
import { KEYS } from "../catalogue/process.mjs";
import { retailerIdFor } from "./import.mjs";

/** One row per store, with its counts. `retailerId` narrows it to one. */
export async function storeReport(pool, { retailerId = null, failures = new Map() } = {}) {
  const { rows } = await pool.query(
    `SELECT r.retailer_id, r.name, r.kind, r.source, r.last_imported_at,
            count(p.*) FILTER (WHERE p.removed_at IS NULL)                                   AS live,
            count(p.*) FILTER (WHERE p.removed_at IS NOT NULL)                               AS removed,
            count(p.*) FILTER (WHERE p.removed_at IS NULL AND p.slot IS NULL)                AS unplaced,
            count(p.*) FILTER (WHERE p.removed_at IS NULL AND p.slot IS NOT NULL AND jsonb_array_length(p.images) = 0) AS no_photo,
            count(p.*) FILTER (WHERE p.removed_at IS NULL AND p.slot IS NOT NULL AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.product_id AND v.available)) AS in_stock,
            count(p.*) FILTER (WHERE p.removed_at IS NULL AND p.slot IS NOT NULL AND p.cutout_url IS NOT NULL AND p.embedding IS NOT NULL) AS processed,
            count(p.*) FILTER (WHERE p.removed_at IS NULL AND p.slot IS NOT NULL AND p.cutout_url IS NOT NULL AND p.embedding IS NOT NULL
                               AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.product_id AND v.available)) AS shown,
            coalesce(array_agg(p.product_id) FILTER (WHERE p.removed_at IS NULL AND p.slot IS NOT NULL AND jsonb_array_length(p.images) > 0
                               AND (p.cutout_url IS NULL OR p.embedding IS NULL)), '{}') AS unprocessed
     FROM retailers r LEFT JOIN products p USING (retailer_id)
     WHERE $1::text IS NULL OR r.retailer_id = $1
     GROUP BY r.retailer_id ORDER BY r.name`,
    [retailerId],
  );
  return rows.map((r) => {
    const unprocessed = r.unprocessed ?? [];
    const failed = unprocessed.filter((id) => failures.has(id)).map((id) => ({ productId: id, reason: failures.get(id) }));
    return {
      retailerId: r.retailer_id,
      name: r.name,
      kind: r.kind,
      source: r.source,
      lastImportedAt: r.last_imported_at ? new Date(r.last_imported_at).toISOString() : null,
      live: Number(r.live),
      removed: Number(r.removed),
      unplaced: Number(r.unplaced),
      noPhoto: Number(r.no_photo),
      inStock: Number(r.in_stock),
      processed: Number(r.processed),
      shown: Number(r.shown),
      waiting: unprocessed.length - failed.length,
      failed,
    };
  });
}

const when = (iso) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "never");

/** The report as plain text. */
export function describeStores(stores) {
  if (!stores.length) return "No stores imported yet.";
  const lines = [];
  for (const s of stores) {
    lines.push(
      `${s.name} (${s.kind}, ${s.retailerId}), last imported ${when(s.lastImportedAt)}`,
      `  ${s.shown} of ${s.live} live pieces can be shown now (placed, in stock, with a cut-out and a vector)`,
      `  ${s.processed} processed, ${s.waiting} waiting for the batch job, ${s.failed.length} failed; ${s.inStock} placed and in stock`,
      `  ${s.unplaced} not recognised as clothing, ${s.noPhoto} without a photo, ${s.removed} left the feed (kept, hidden)`,
    );
    for (const f of s.failed.slice(0, 20)) lines.push(`  failed ${f.productId}: ${f.reason}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

async function main() {
  const { values } = parseArgs({ options: { store: { type: "string" }, json: { type: "boolean" } } });
  const pool = db();
  if (!pool) throw new Error("DATABASE_URL is not set (copy .env.example to .env, or set it).");
  const retailerId = values.store ? (values.store.startsWith("ret_") ? values.store : retailerIdFor(values.store)) : null;
  let failures = new Map();
  const redis = await redisReady().catch(() => null);
  if (redis) failures = new Map(Object.entries(await redis.hGetAll(KEYS.failed).catch(() => ({}))));
  const stores = await storeReport(pool, { retailerId, failures });
  console.log(values.json ? JSON.stringify(stores, null, 2) : describeStores(stores));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .catch((e) => {
      console.error(`The report couldn't be made: ${e?.message ?? e}`);
      process.exitCode = 1;
    })
    .finally(() => Promise.allSettled([closeDb(), closeRedis()]));
}
