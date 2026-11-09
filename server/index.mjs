/**
 * The production server (Railway runs `npm run start`). It does what `serve -s dist` did, files with
 * the SPA fallback to index.html. The page is sent `no-cache` so a deploy shows at once; static files
 * cache hard.
 *
 * It also answers POST /api/tryon, the plug-in point for a real try-on engine (server/tryon.mjs). With
 * no provider set up, the default, it answers that no engine is connected and calls nothing.
 *
 * A page served from another origin (built with VITE_API_BASE_URL) may call /api only from an origin
 * listed in CORS_ORIGINS (server/cors.mjs).
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { handleTryOn, readBody } from "./tryon.mjs";
import { handleCutout, handleSearch, isCutoutPath } from "./search.mjs";
import { handleAccount, isAccountPath } from "./auth/routes.mjs";
import { handleAi, liveServices } from "./ai.mjs";
import { handleVisual } from "./visuals.mjs";
import { handleClientError, health, logError, RELEASE } from "./monitor.mjs";
import { applyCors } from "./cors.mjs";
import { closeDb } from "./db.mjs";
import { dependencies, statusFor } from "./health.mjs";
import { closeRedis } from "./redis.mjs";

const ROOT = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const PORT = Number(process.env.PORT ?? 3000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
};
const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".md", ".webmanifest"]);
/* The on-device colour reader's engine and model are large and never change between deploys: compressed once, kept. */
const COMPRESS_ONCE = new Set([".wasm", ".task"]);
const compressed = new Map();

const INDEX = readFileSync(join(ROOT, "index.html"), "utf8");

function send(req, res, status, headers, body) {
  const accepts = /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
  let out = typeof body === "string" ? Buffer.from(body) : body;
  if (accepts && out.length > 1024) {
    out = gzipSync(out);
    headers["Content-Encoding"] = "gzip";
  }
  headers["Vary"] = res.getHeader("Vary") ? `${res.getHeader("Vary")}, Accept-Encoding` : "Accept-Encoding";
  headers["Content-Length"] = out.length;
  res.writeHead(status, headers);
  res.end(req.method === "HEAD" ? undefined : out);
}

function page(req, res) {
  send(req, res, 200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache" }, INDEX);
}

function file(req, res, path, stat) {
  const ext = extname(path).toLowerCase();
  const type = TYPES[ext] ?? "application/octet-stream";
  const rel = path.slice(ROOT.length).split(sep).join("/");
  const cache = rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=604800";
  const headers = { "Content-Type": type, "Cache-Control": cache, "Last-Modified": stat.mtime.toUTCString(), "Accept-Ranges": "bytes" };
  if (req.headers["if-modified-since"] && new Date(req.headers["if-modified-since"]) >= new Date(stat.mtime.toUTCString())) {
    res.writeHead(304, headers);
    return res.end();
  }
  if (COMPRESSIBLE.has(ext)) return send(req, res, 200, headers, readFileSync(path));
  if (COMPRESS_ONCE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
    const key = `${path}|${stat.mtimeMs}`;
    if (!compressed.has(key)) compressed.set(key, gzipSync(readFileSync(path)));
    const out = compressed.get(key);
    res.writeHead(200, { ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding", "Content-Length": out.length });
    return res.end(req.method === "HEAD" ? undefined : out);
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    return createReadStream(path, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "Content-Length": stat.size });
  if (req.method === "HEAD") return res.end();
  createReadStream(path).pipe(res);
}

function route(req, res) {
  /* A page served from another origin (VITE_API_BASE_URL) may call /api when CORS_ORIGINS lists it (server/cors.mjs). */
  if (req.url?.startsWith("/api/") && applyCors(req, res)) return;
  /* The try-on plug-in point (server/tryon.mjs); answers "disabled" until a provider is set up. */
  if (req.url?.split("?")[0] === "/api/tryon") {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      return res.end();
    }
    void handleTryOn(req, res);
    return;
  }
  /* Every AI service's plug-in point (server/ai.mjs); each answers "disabled" until its provider is set up. */
  const ai = /^\/api\/ai\/([a-z_]+)$/.exec(req.url?.split("?")[0] ?? "");
  if (ai) {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      return res.end();
    }
    void handleAi(req, res, ai[1]);
    return;
  }
  /* Sign-in, the session, the guest-to-account hand-over and the account's saved looks (server/auth). */
  const accountPath = req.url?.split("?")[0] ?? "";
  if (isAccountPath(accountPath)) {
    void handleAccount(req, res, accountPath);
    return;
  }
  /* Search the imported catalogue by words or a photo (server/search.mjs). */
  if (req.url?.split("?")[0] === "/api/search") {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      return res.end();
    }
    // Room for an 8 MB photo as base64, plus the rest of the body.
    void handleSearch(req, res, (r) => readBody(r, 12 * 1024 * 1024));
    return;
  }
  /* Errors from the page, logged without personal details (server/monitor.mjs). */
  if (req.url?.split("?")[0] === "/api/client-error") {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      return res.end();
    }
    void handleClientError(req, res).catch(() => res.headersSent || (res.writeHead(400), res.end()));
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (pathname === "/api/ai") {
    void liveServices()
      .catch(() => [])
      .then((live) => send(req, res, 200, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" }, JSON.stringify({ live })));
    return;
  }
  /* Catalogue cut-outs, streamed from the private bucket (server/search.mjs). */
  if (isCutoutPath(pathname)) return void handleCutout(req, res, pathname);
  /* Outfit pictures made by the image provider (server/visuals.mjs). */
  const picture = /^\/api\/visuals\/(img_[0-9a-f]{24})\.jpg$/.exec(pathname);
  if (picture) return handleVisual(req, res, picture[1]);
  /* The build, the switches, and whether Postgres and Redis answer: 503 when a configured one is down (server/health.mjs). */
  if (pathname === "/api/health") {
    void dependencies()
      .catch(() => ({ db: "down", redis: "down", ai: "down" }))
      .then((deps) => {
        const status = statusFor(deps);
        send(req, res, status, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" }, JSON.stringify({ ...health(), ok: status === 200, dependencies: deps }));
      });
    return;
  }
  const path = normalize(join(ROOT, pathname));
  if (path !== ROOT && !path.startsWith(ROOT + sep)) {
    res.writeHead(403);
    return res.end();
  }
  if (path !== ROOT && pathname !== "/index.html" && existsSync(path)) {
    const stat = statSync(path);
    if (stat.isFile()) return file(req, res, path, stat);
  }
  /* Asset-looking paths that are missing get a real 404, so a lost image falls back instead of rendering HTML. */
  if (extname(pathname) && extname(pathname) !== ".html") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end("Not found");
  }
  page(req, res);
}

export const server = createServer((req, res) => {
  try {
    route(req, res);
  } catch (err) {
    logError("server_error", { name: err?.name ?? "Error", path: (req.url ?? "").split("?")[0].slice(0, 120) });
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Something went wrong.");
  }
});

process.on("uncaughtException", (err) => {
  // Logged, then the process ends so Railway starts a clean one.
  logError("server_error", { name: err?.name ?? "Error", where: "uncaught" });
  process.exit(1);
});
process.on("unhandledRejection", (err) => logError("server_error", { name: err?.name ?? "Error", where: "unhandled_rejection" }));

/* Railway stops a deploy with SIGTERM: finish open requests, then close the database pool and Redis. */
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    server.close(() => void Promise.allSettled([closeDb(), closeRedis()]).then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

server.listen(PORT, () => console.log(`Praxis ${RELEASE.version} (${RELEASE.commit}) on :${PORT}`));
