/**
 * Error monitoring and the health check, with no outside service. Errors go to the server's log as one
 * JSON line each (Railway keeps the logs: Project, Deployments, View logs), so they can be searched for
 * `"type":"client_error"` or `"type":"server_error"`. Nothing personal is logged: no IP, no address,
 * no message text from the page, no photo; only the error's name, where it happened, the page path
 * without its query, and a few stack frames from the app's own files.
 *
 * GET /api/health says which build is running and that no paid provider is switched on, for the
 * smoke tests after a deploy (tools/smoke.mjs). server/index.mjs adds `dependencies` (Postgres and
 * Redis, server/health.mjs) and answers 503 with `ok: false` when a configured one is down.
 */
import { readFileSync } from "node:fs";
import { AI_SERVICES, FREE_DEFAULTS, providerName } from "./ai.mjs";
import { readBody } from "./tryon.mjs";
import { pictureSpend } from "./visuals.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const STARTED = new Date().toISOString();

/** Which build this is: the commit Railway deployed, or "local". */
export const RELEASE = { version: pkg.version, commit: (process.env.RAILWAY_GIT_COMMIT_SHA ?? "").slice(0, 7) || "local" };

/** One JSON line per error, so the log can be filtered. */
export function logError(type, fields) {
  console.error(JSON.stringify({ type, at: new Date().toISOString(), release: RELEASE.commit, ...fields }));
}

export function health() {
  const configured = AI_SERVICES.filter((s) => (process.env[`AI_PROVIDER_${s.toUpperCase()}`] ?? "").trim());
  const free = Object.keys(FREE_DEFAULTS).filter((s) => FREE_DEFAULTS[s][0] === providerName(s));
  return {
    ok: true,
    ...RELEASE,
    startedAt: STARTED,
    ai: { providersSet: configured, freeOn: free, billableAllowed: process.env.ALLOW_BILLABLE_AI === "true" },
    tryOn: { providerSet: Boolean((process.env.TRYON_PROVIDER ?? "").trim()), billableAllowed: process.env.ALLOW_BILLABLE_IMAGES === "true" },
    pictures: { provider: providerName("outfit_visualization") || "none", ...pictureSpend() },
  };
}

const clean = (v, max) =>
  typeof v === "string"
    ? v
        .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
        .replace(/data:[^\s"')]+/g, "[data]")
        .replace(/\?[^\s"')]*/g, "")
        .slice(0, max)
    : undefined;

/* At most 60 reports a minute, so a loop in a page cannot flood the log. */
let windowStart = 0;
let inWindow = 0;

export async function handleClientError(req, res) {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    inWindow = 0;
  }
  let body;
  try {
    body = JSON.parse(await readBody(req, 4096));
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (++inWindow <= 60 && body && typeof body === "object") {
    logError("client_error", {
      name: clean(body.name, 60) ?? "Error",
      where: clean(body.where, 40),
      path: clean(body.path, 120),
      build: clean(body.release, 40),
      frames: Array.isArray(body.frames) ? body.frames.slice(0, 5).map((f) => clean(f, 160)) : undefined,
    });
  }
  res.writeHead(204, { "Cache-Control": "no-store" });
  res.end();
}
