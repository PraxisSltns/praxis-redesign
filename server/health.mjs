/**
 * The dependency part of GET /api/health: whether Postgres and Redis answer. Each is "up", "down" or
 * "off" (not configured: no DATABASE_URL or REDIS_URL, as on the existing Railway service). Only a
 * configured dependency that doesn't answer makes the server unhealthy (503), so a server with no
 * database still passes its health check and the smoke tests.
 */
import { db } from "./db.mjs";
import { redis } from "./redis.mjs";

/** How long one check may take before it counts as down. */
export const CHECK_TIMEOUT_MS = 2_000;

function within(promise, ms) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** "off" when there's no client, "up" when the probe answers in time, "down" otherwise. */
export async function probe(client, ask, ms = CHECK_TIMEOUT_MS) {
  if (!client) return "off";
  try {
    await within(Promise.resolve().then(() => ask(client)), ms);
    return "up";
  } catch {
    return "down";
  }
}

/** The status of each dependency, checked in parallel. */
export async function dependencies({ pool = db(), cache = redis(), ms = CHECK_TIMEOUT_MS } = {}) {
  const [database, queue] = await Promise.all([
    probe(pool, (p) => p.query("SELECT 1"), ms),
    probe(cache, async (c) => {
      if ((await c.ping()) !== "PONG") throw new Error("unexpected reply");
    }, ms),
  ]);
  return { db: database, redis: queue };
}

/** 503 when any configured dependency is down, 200 otherwise. */
export function statusFor(deps) {
  return Object.values(deps).includes("down") ? 503 : 200;
}
