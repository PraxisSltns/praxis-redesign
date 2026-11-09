/**
 * The dependency part of GET /api/health: whether Postgres, Redis and the ai service answer. Each is
 * "up", "down" or "off" (not configured: no DATABASE_URL, REDIS_URL or AI_SERVICE_URL, as on the
 * existing Railway service). Only Postgres or Redis being down makes the server unhealthy (503), so a
 * server with no database still passes its health check and the smoke tests. The ai service is
 * reported but doesn't fail the gateway: nothing on the page depends on it yet.
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

/** The ai service's address (services/ai), from AI_SERVICE_URL, or "" when it isn't set. */
export const aiServiceUrl = (env = process.env) => (env.AI_SERVICE_URL ?? "").trim().replace(/\/+$/, "");

/** A client for the ai service's /health, or null when AI_SERVICE_URL isn't set. */
export function aiHealthClient(url = aiServiceUrl(), fetcher = fetch) {
  if (!url) return null;
  return {
    async check() {
      const res = await fetcher(`${url}/health`, { headers: { Accept: "application/json" } });
      if (!res.ok || (await res.json())?.ok !== true) throw new Error(`ai answered ${res.status}`);
    },
  };
}

/** The status of each dependency, checked in parallel. */
export async function dependencies({ pool = db(), cache = redis(), ai = aiHealthClient(), ms = CHECK_TIMEOUT_MS } = {}) {
  const [database, queue, models] = await Promise.all([
    probe(pool, (p) => p.query("SELECT 1"), ms),
    probe(cache, async (c) => {
      if ((await c.ping()) !== "PONG") throw new Error("unexpected reply");
    }, ms),
    probe(ai, (a) => a.check(), ms),
  ]);
  return { db: database, redis: queue, ai: models };
}

/** 503 when Postgres or Redis is configured and down, 200 otherwise. */
export function statusFor(deps) {
  return deps.db === "down" || deps.redis === "down" ? 503 : 200;
}
