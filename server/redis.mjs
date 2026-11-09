/**
 * The gateway's Redis client, from REDIS_URL. Unset: there is no Redis, `redis()` is null and the health
 * check says "off". The client connects on first use and reconnects by itself with a growing delay.
 *
 * Commands fail at once while the connection is down (no offline queue), so a request that needs Redis
 * gets an error instead of waiting for it to come back.
 */
import { createClient } from "redis";

export function redisSettings(env = process.env) {
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    url: (env.REDIS_URL ?? "").trim(),
    connectTimeout: n(env.REDIS_CONNECT_TIMEOUT_MS, 5_000),
  };
}

let client = null;
let connecting = null;

/** The shared client, or null when REDIS_URL isn't set. */
export function redis() {
  if (client) return client;
  const { url, connectTimeout } = redisSettings();
  if (!url) return null;
  client = createClient({
    url,
    disableOfflineQueue: true,
    socket: { connectTimeout, reconnectStrategy: (retries) => Math.min(250 * 2 ** retries, 5_000) },
  });
  // Without a listener a lost connection would crash the process; it reconnects on its own.
  let last = 0;
  client.on("error", (err) => {
    if (Date.now() - last < 30_000) return;
    last = Date.now();
    console.error(JSON.stringify({ type: "redis_error", at: new Date().toISOString(), code: err?.code ?? err?.name ?? "unknown" }));
  });
  connecting = client.connect().catch(() => undefined);
  return client;
}

/** The shared client once its first connection attempt has finished (null when REDIS_URL isn't set). For jobs, which need it up before they start. */
export async function redisReady() {
  const c = redis();
  if (c) await connecting;
  return c;
}

/** Closes the client (tests, shutdown). */
export async function closeRedis() {
  const c = client;
  client = null;
  connecting = null;
  if (c?.isOpen) await c.close().catch(() => c.destroy());
  else c?.destroy();
}
