/**
 * Cross-origin access to /api, for a page built with VITE_API_BASE_URL and served from somewhere else
 * (the Vite dev server, a preview host). Only the origins listed in CORS_ORIGINS (comma separated,
 * exact, for example http://localhost:5173) get the headers; every other origin gets none, so the
 * browser refuses the call. Unset, the default: same origin only, as on Railway.
 */

/** The allowed origins from the environment, without trailing slashes. */
export function allowedOrigins(env = process.env) {
  return (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/**
 * Adds the CORS headers to an /api response when the request's origin is allowed. Answers a preflight
 * (OPTIONS) itself and returns true; otherwise returns false and the route carries on.
 */
export function applyCors(req, res, origins = allowedOrigins()) {
  const origin = req.headers.origin;
  const allowed = typeof origin === "string" && origins.includes(origin);
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  if (req.method !== "OPTIONS") return false;
  if (allowed) {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  res.writeHead(allowed ? 204 : 403);
  res.end();
  return true;
}
