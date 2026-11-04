/**
 * The catalogue's batch job: for each product photo with no cut-out or no vector, cut the garment out
 * once (ai service, BiRefNet), keep the PNG in the bucket, embed it (Marqo-FashionSigLIP) and save the
 * 768-number vector on the product. Run by `npm run catalogue:process`; never on a request's path.
 *
 * Redis holds the queue, so the job can stop at any point and carry on:
 * - catalogue:queue       product ids waiting (a list)
 * - catalogue:queued      the same ids as a set, so nothing is queued twice
 * - catalogue:processing  ids a worker has taken; on start, a worker puts these back (resumable)
 * - catalogue:attempts    tries per id; a failure is retried up to MAX_ATTEMPTS, then:
 * - catalogue:failed      id -> the last reason, for the report (cleared when it later succeeds)
 *
 * Idempotent: a product that already has both is skipped; a cut-out already in the bucket is reused;
 * the bucket key comes from the product and its photo's address, so the same photo maps to the same key.
 * One worker at a time (the ai service runs one inference at a time anyway).
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { toVector } from "../ai-service.mjs";

export const KEYS = { queue: "catalogue:queue", queued: "catalogue:queued", processing: "catalogue:processing", attempts: "catalogue:attempts", failed: "catalogue:failed" };
export const MAX_ATTEMPTS = 3;

/** The bucket key for a product's cut-out: one per product and photo. */
export const cutoutKey = (productId, imageUrl) => `cutouts/${productId}/${createHash("sha256").update(imageUrl).digest("hex").slice(0, 16)}.png`;

/**
 * Fetches a product photo. FIXTURE_IMAGES maps a test host to a local folder
 * ("cdn.praxis-test.example=server/retailers/fixtures/images"), so fixtures need no network.
 */
export function createImageFetcher(env = process.env, fetcher = fetch) {
  const fixtures = new Map(
    (env.FIXTURE_IMAGES ?? "")
      .split(",")
      .map((pair) => pair.split("="))
      .filter(([host, dir]) => host && dir)
      .map(([host, dir]) => [host.trim(), dir.trim()]),
  );
  return async (url) => {
    const u = new URL(url);
    if (fixtures.has(u.host)) {
      try {
        return { bytes: await readFile(join(fixtures.get(u.host), decodeURIComponent(u.pathname))), contentType: "image/jpeg" };
      } catch {
        throw Object.assign(new Error(`the photo was not found (${u.pathname})`), { retryable: false });
      }
    }
    const res = await fetcher(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "Praxis/1.0 (catalogue images)" } });
    if (!res.ok) throw Object.assign(new Error(`the photo answered ${res.status}`), { retryable: res.status >= 500 || res.status === 429 });
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) throw Object.assign(new Error(`the photo is ${type || "not an image"}`), { retryable: false });
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: type };
  };
}

/** Queues every live, slotted product with a photo that still lacks a cut-out or a vector (one retailer's, if given). Returns how many were added. */
export async function enqueuePending(pool, redis, { retailerId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT product_id FROM products
     WHERE removed_at IS NULL AND slot IS NOT NULL AND jsonb_array_length(images) > 0
       AND (cutout_url IS NULL OR embedding IS NULL)
       AND ($1::text IS NULL OR retailer_id = $1)
     ORDER BY product_id`,
    [retailerId],
  );
  let added = 0;
  for (const { product_id: id } of rows) {
    if (await redis.sAdd(KEYS.queued, id)) {
      await redis.rPush(KEYS.queue, id);
      added += 1;
    }
  }
  return added;
}

/** Puts back anything a stopped worker had taken, so it runs again. Returns how many. */
export async function recover(redis) {
  let n = 0;
  while (await redis.lMove(KEYS.processing, KEYS.queue, "RIGHT", "LEFT")) n += 1;
  return n;
}

/** Does one product: cut-out (unless done), then vector (unless done). Throws with .retryable on failure. */
export async function processProduct(id, { pool, storage, ai, fetchImage }) {
  const { rows } = await pool.query("SELECT product_id, images, cutout_url, embedding IS NOT NULL AS embedded FROM products WHERE product_id = $1", [id]);
  const p = rows[0];
  if (!p) return { id, skipped: "gone" };
  if (p.cutout_url && p.embedded) return { id, skipped: "done" };
  const imageUrl = p.images[0];
  const key = cutoutKey(id, imageUrl);
  const timing = {};
  let png = null;
  if (p.cutout_url !== key) {
    png = await storage.getBytes(key);
    if (!png) {
      const photo = await fetchImage(imageUrl);
      const made = await ai.cutout(photo.bytes, photo.contentType);
      png = made.png;
      timing.cutoutMs = made.ms;
      await storage.put(key, png, "image/png");
    }
    await pool.query("UPDATE products SET cutout_url = $2 WHERE product_id = $1", [id, key]);
  }
  if (!p.embedded || p.cutout_url !== key) {
    png ??= await storage.getBytes(key);
    if (!png) throw Object.assign(new Error("the cut-out is missing from the bucket"), { retryable: true });
    const started = Date.now();
    const { vectors } = await ai.embedImages([png]);
    timing.embedMs = Date.now() - started;
    await pool.query("UPDATE products SET embedding = $2::vector WHERE product_id = $1", [id, toVector(vectors[0])]);
  }
  return { id, ...timing };
}

/**
 * Takes jobs until the queue is empty (or `limit` are done) and returns a report. Retries a failure up
 * to MAX_ATTEMPTS (unless it can't succeed, like a missing photo), then lists it as failed.
 */
export async function runWorker({ pool, redis, storage, ai, fetchImage, maxAttempts = MAX_ATTEMPTS, limit = Infinity, log = () => {} }) {
  const report = { recovered: await recover(redis), done: 0, skipped: 0, retried: 0, failed: [], cutoutMs: [], embedMs: [] };
  while (report.done + report.skipped + report.failed.length < limit) {
    const id = await redis.lMove(KEYS.queue, KEYS.processing, "LEFT", "RIGHT");
    if (!id) break;
    try {
      const out = await processProduct(id, { pool, storage, ai, fetchImage });
      if (out.skipped) report.skipped += 1;
      else {
        report.done += 1;
        if (out.cutoutMs) report.cutoutMs.push(out.cutoutMs);
        if (out.embedMs) report.embedMs.push(out.embedMs);
      }
      await redis.hDel(KEYS.failed, id);
      await finish(redis, id);
      log(`done ${id}${out.cutoutMs ? ` cut-out ${out.cutoutMs} ms` : ""}${out.embedMs ? ` vector ${out.embedMs} ms` : ""}${out.skipped ? ` (${out.skipped})` : ""}`);
    } catch (e) {
      const tries = await redis.hIncrBy(KEYS.attempts, id, 1);
      const reason = String(e?.message ?? e).slice(0, 300);
      if (e?.retryable !== false && tries < maxAttempts) {
        report.retried += 1;
        await redis.lRem(KEYS.processing, 1, id);
        await redis.rPush(KEYS.queue, id);
        log(`retry ${id} (${tries} of ${maxAttempts}): ${reason}`);
      } else {
        await redis.hSet(KEYS.failed, id, reason);
        await finish(redis, id);
        report.failed.push({ id, reason, tries });
        log(`failed ${id}: ${reason}`);
      }
    }
  }
  return report;
}

async function finish(redis, id) {
  await redis.lRem(KEYS.processing, 1, id);
  await redis.sRem(KEYS.queued, id);
  await redis.hDel(KEYS.attempts, id);
}

/** Counts for the report: products that should have both, and how many do (one retailer's, if given). */
export async function coverage(pool, { retailerId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS eligible,
            count(*) FILTER (WHERE cutout_url IS NOT NULL)::int AS with_cutout,
            count(*) FILTER (WHERE embedding IS NOT NULL)::int AS with_vector,
            count(*) FILTER (WHERE embedding IS NOT NULL AND vector_dims(embedding) <> 768)::int AS wrong_dims
     FROM products WHERE removed_at IS NULL AND slot IS NOT NULL AND jsonb_array_length(images) > 0
       AND ($1::text IS NULL OR retailer_id = $1)`,
    [retailerId],
  );
  return rows[0];
}
