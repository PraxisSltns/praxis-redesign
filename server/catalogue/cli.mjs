/**
 * Runs the catalogue's batch job until its queue is empty and prints a report: what was done, retried
 * or failed, cut-out and vector timings, and coverage (every live, slotted product with a photo should
 * have exactly one cut-out and one 768-number vector).
 *
 *   npm run catalogue:process              queue what's missing, then work through it
 *   npm run catalogue:process -- --limit 5 stop after five (the rest stay queued; run again to carry on)
 *   npm run catalogue:process -- --retailer ret_...   only that retailer's products
 *
 * Needs DATABASE_URL, REDIS_URL, S3_BUCKET (and its keys) and AI_SERVICE_URL.
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createAiService } from "../ai-service.mjs";
import { closeDb, db } from "../db.mjs";
import { closeRedis, redisReady } from "../redis.mjs";
import { storage } from "../storage.mjs";
import { coverage, createImageFetcher, enqueuePending, KEYS, runWorker } from "./process.mjs";

const stats = (xs) => {
  if (!xs.length) return "none";
  const s = [...xs].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return `${s.length} in all: median ${at(0.5)} ms, 90th percentile ${at(0.9)} ms, slowest ${s[s.length - 1]} ms`;
};

async function main() {
  const { values } = parseArgs({ options: { limit: { type: "string" }, retailer: { type: "string" }, quiet: { type: "boolean" } } });
  const only = { retailerId: values.retailer ?? null };
  const pool = db();
  const cache = await redisReady();
  const bucket = storage();
  const ai = createAiService();
  const missing = [!pool && "DATABASE_URL", !cache && "REDIS_URL", !bucket && "S3_BUCKET", !ai && "AI_SERVICE_URL"].filter(Boolean);
  if (missing.length) throw new Error(`Set ${missing.join(", ")} first (see .env.example).`);
  await cache.ping();

  const started = Date.now();
  const added = await enqueuePending(pool, cache, only);
  console.log(`queued ${added} new; ${await cache.lLen(KEYS.queue)} waiting, ${await cache.lLen(KEYS.processing)} left over from a stopped run`);
  const report = await runWorker({
    pool,
    redis: cache,
    storage: bucket,
    ai,
    fetchImage: createImageFetcher(),
    limit: values.limit ? Number(values.limit) : Infinity,
    log: values.quiet ? () => {} : (line) => console.log(`  ${line}`),
  });
  const cover = await coverage(pool, only);
  console.log(`done ${report.done}, skipped ${report.skipped} (already done), retried ${report.retried}, failed ${report.failed.length}, recovered ${report.recovered} from a stopped run, in ${Math.round((Date.now() - started) / 1000)} s`);
  console.log(`cut-outs: ${stats(report.cutoutMs)}`);
  console.log(`vectors:  ${stats(report.embedMs)}`);
  console.log(`coverage: ${cover.with_cutout} of ${cover.eligible} have a cut-out, ${cover.with_vector} of ${cover.eligible} a vector (${cover.wrong_dims} of the wrong size)`);
  for (const f of report.failed) console.log(`  failed ${f.id} after ${f.tries} tries: ${f.reason}`);
  const waiting = await cache.lLen(KEYS.queue);
  if (waiting) console.log(`${waiting} still queued: run again to carry on`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .catch((e) => {
      console.error(`The batch job stopped: ${e?.message ?? e}`);
      process.exitCode = 1;
    })
    .finally(() => Promise.allSettled([closeDb(), closeRedis()]));
}
