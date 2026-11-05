/**
 * The AuthProvider the gateway signs people in with. Every provider has the same two steps, so another
 * (Clerk, say) can replace the default without the routes, sessions or account hand-over changing:
 *
 *   start({ email, anonymousSessionId, consents, address })  -> { sent: true }
 *     begins a sign-in for an address; `consents` are the account consents agreed on the form
 *     (src/shared/consents.mjs); `address` is the caller's network address, for rate limits only
 *   finish({ token })  -> { user: { id, email, displayName }, isNew, anonymousSessionId }
 *     completes it; creates the account (recording its consents) if it's new
 *
 * Both throw AuthError(status, code, message) for the route to answer. The session that follows is the
 * gateway's own (server/auth/sessions.mjs), whichever provider signed the person in.
 *
 * AUTH_PROVIDER picks one: "magic-link" (the default: an emailed link, server/auth/magic-link.mjs) or
 * "off" (no sign-in on this server).
 */
import { db } from "../db.mjs";
import { redis } from "../redis.mjs";
import { createMagicLinkProvider } from "./magic-link.mjs";
import { createMailer } from "./mailer.mjs";

/** Where sign-in links point: APP_ORIGIN, or the local server outside production. Never the request's Host header. */
export function appOrigin(env = process.env) {
  const set = (env.APP_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (set) return set;
  return env.NODE_ENV === "production" ? "" : `http://localhost:${env.PORT ?? 3000}`;
}

let shared;
/** The configured provider, or null when sign-in is off or this server has no database. */
export function authProvider(env = process.env) {
  if (shared !== undefined) return shared;
  const name = (env.AUTH_PROVIDER ?? "magic-link").trim();
  const pool = db();
  const origin = appOrigin(env);
  if (name === "off" || !pool || !origin) return (shared = null);
  if (name !== "magic-link") throw new Error(`Unknown AUTH_PROVIDER "${name}".`);
  return (shared = createMagicLinkProvider({ pool, redis: redis(), mailer: createMailer(env), appOrigin: origin }));
}
