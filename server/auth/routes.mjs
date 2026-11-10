/**
 * Sign-in, session and account routes:
 *
 *   POST   /api/auth/start      { email, anonymousSessionId, consents }  -> 202 { sent: true }
 *   POST   /api/auth/verify     { token }  -> sets the session cookie; { user, isNew, anonymousSessionId }
 *   GET    /api/auth/me         -> { user } or 401
 *   POST   /api/auth/sign-out   -> ends the session, clears the cookie
 *   POST   /api/account/claim   { anonymousSessionId, looks }  -> the guest's looks move to the account, once
 *   GET    /api/looks           -> { looks } (signed in)
 *   POST   /api/looks           { anonymousSessionId, look }  -> saves one (signed in)
 *   DELETE /api/looks/<id>      -> removes one (signed in)
 *   GET    /api/account/consents           -> { consents: [{ category, version, grantedAt, withdrawnAt }] }
 *   POST   /api/account/consents/withdraw  -> { withdrawn: [category], signedOut: n } withdraws them all and
 *                                             ends every session of the account; signing in asks again
 *   GET    /api/wardrobe        -> { items }      PUT { anonymousSessionId, item }    DELETE { wardrobeItemId }
 *   GET    /api/feedback        -> { records }    PUT { anonymousSessionId, record }  DELETE { eventId }
 *                                  (server/auth/records.mjs; the page's three-way sync, src/core/accountSync.ts)
 *   DELETE /api/looks           { dedupeKey }  -> { removed } removes the account's look with that key; already gone is 200 too
 *
 * Changes are accepted only from this app's own pages: a POST or DELETE must carry an Origin of
 * APP_ORIGIN or one in CORS_ORIGINS. With SameSite=Lax cookies, that stops other sites acting for a
 * signed-in visitor. The verify step is a POST from the /auth/verify page, never the emailed GET itself,
 * so a mail scanner that opens links can't use one up.
 */
import { allowedOrigins } from "../cors.mjs";
import { db } from "../db.mjs";
import { readBody } from "../tryon.mjs";
import { createAccounts } from "./account.mjs";
import { createRecords } from "./records.mjs";
import { AuthError } from "./magic-link.mjs";
import { appOrigin, authProvider } from "./provider.mjs";
import { cookieHeader, createSessions, SESSION_DAYS } from "./sessions.mjs";

const PATHS = /^\/api\/(auth\/(start|verify|me|sign-out)|account\/(claim|consents|consents\/withdraw)|looks(\/slook_[0-9a-f]{24})?|wardrobe|feedback)$/;
export const isAccountPath = (pathname) => PATHS.test(pathname);

function reply(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(payload));
}

/** Whether a changing request comes from this app's own pages. */
export function trustedOrigin(req, env = process.env) {
  const origin = req.headers.origin;
  if (typeof origin !== "string") return false;
  return origin === appOrigin(env) || allowedOrigins(env).includes(origin);
}

async function json(req) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new AuthError(415, "bad_request", "Send JSON.");
  try {
    return JSON.parse(await readBody(req, 2 * 1024 * 1024));
  } catch (e) {
    throw new AuthError(e?.code === "too_large" ? 413 : 400, "bad_request", "The request could not be read.");
  }
}

const clientAddress = (req) => {
  const fwd = req.headers["x-forwarded-for"];
  return (typeof fwd === "string" ? fwd.split(",")[0].trim() : "") || req.socket?.remoteAddress || "";
};

export async function handleAccount(req, res, pathname, { pool = db(), provider = authProvider(), env = process.env } = {}) {
  try {
    if (!pool) throw new AuthError(503, "not_available", "Accounts aren't set up on this server.");
    const sessions = createSessions(pool);
    const accounts = createAccounts(pool);
    const records = createRecords(pool);
    const secure = appOrigin(env).startsWith("https://");
    const changing = req.method === "POST" || req.method === "PUT" || req.method === "DELETE";
    if (changing && !trustedOrigin(req, env)) throw new AuthError(403, "bad_origin", "This request didn't come from Praxis.");

    if (pathname === "/api/auth/start" && req.method === "POST") {
      if (!provider) throw new AuthError(503, "not_available", "Sign-in isn't available on this server yet.");
      const body = await json(req);
      return reply(res, 202, await provider.start({ email: body?.email, anonymousSessionId: body?.anonymousSessionId, consents: body?.consents, address: clientAddress(req) }));
    }
    if (pathname === "/api/auth/verify" && req.method === "POST") {
      if (!provider) throw new AuthError(503, "not_available", "Sign-in isn't available on this server yet.");
      const body = await json(req);
      const done = await provider.finish({ token: body?.token });
      const token = await sessions.start(done.user.id);
      return reply(res, 200, done, { "Set-Cookie": cookieHeader(token, { secure, maxAge: SESSION_DAYS * 86_400 }) });
    }
    if (pathname === "/api/auth/sign-out" && req.method === "POST") {
      await sessions.end(req);
      return reply(res, 200, { signedOut: true }, { "Set-Cookie": cookieHeader("", { secure, maxAge: 0 }) });
    }

    const user = await sessions.user(req);
    if (pathname === "/api/auth/me" && req.method === "GET") return user ? reply(res, 200, { user }) : reply(res, 401, { error: "Not signed in." });
    if (!user) throw new AuthError(401, "signed_out", "Sign in first.");

    if (pathname === "/api/account/claim" && req.method === "POST") {
      const body = await json(req);
      return reply(res, 200, await accounts.claim(user, body?.anonymousSessionId, body?.looks));
    }
    if (pathname === "/api/account/consents" && req.method === "GET") return reply(res, 200, { consents: await accounts.consents(user) });
    if (pathname === "/api/account/consents/withdraw" && req.method === "POST") {
      const withdrawn = await accounts.withdrawConsents(user);
      const signedOut = await sessions.endAll(user.id);
      return reply(res, 200, { withdrawn, signedOut }, { "Set-Cookie": cookieHeader("", { secure, maxAge: 0 }) });
    }
    if (pathname === "/api/wardrobe" || pathname === "/api/feedback") {
      const wardrobe = pathname === "/api/wardrobe";
      if (req.method === "GET") return reply(res, 200, wardrobe ? { items: await records.wardrobe(user) } : { records: await records.feedback(user) });
      const body = await json(req);
      if (req.method === "PUT") return reply(res, 200, wardrobe ? await records.putWardrobe(user, body?.anonymousSessionId, body?.item) : await records.putFeedback(user, body?.anonymousSessionId, body?.record));
      if (req.method === "DELETE") return reply(res, 200, wardrobe ? await records.removeWardrobe(user, body?.wardrobeItemId) : await records.removeFeedback(user, body?.eventId));
    }
    if (pathname === "/api/looks" && req.method === "GET") return reply(res, 200, { looks: await accounts.looks(user) });
    if (pathname === "/api/looks" && req.method === "POST") {
      const body = await json(req);
      return reply(res, 200, await accounts.save(user, body?.anonymousSessionId, body?.look));
    }
    if (pathname === "/api/looks" && req.method === "DELETE") {
      const body = await json(req);
      return reply(res, 200, await accounts.removeByKey(user, body?.dedupeKey));
    }
    if (pathname.startsWith("/api/looks/") && req.method === "DELETE") {
      return reply(res, (await accounts.remove(user, pathname.slice("/api/looks/".length))) ? 200 : 404, {});
    }
    res.writeHead(405);
    return res.end();
  } catch (e) {
    if (e instanceof AuthError) return reply(res, e.status, { error: e.message, code: e.code });
    if (e?.status) return reply(res, e.status, { error: e.message });
    console.error(JSON.stringify({ type: "account_error", at: new Date().toISOString(), path: pathname, name: e?.name ?? "Error", code: e?.code ?? null }));
    return reply(res, 500, { error: "Something went wrong. Try again." });
  }
}
