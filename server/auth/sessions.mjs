/**
 * The gateway's sessions: a random token in an httpOnly cookie, and only its hash in the database, so
 * a leaked table signs no one in. 30 days; ended by signing out. The cookie is SameSite=Lax (sent when
 * following a link to the site, not on other sites' requests) and Secure whenever the site is https.
 */
import { randomBytes } from "node:crypto";
import { sha256 } from "./magic-link.mjs";

export const COOKIE = "praxis_session";
export const SESSION_DAYS = 30;

export function cookieHeader(value, { secure, maxAge }) {
  return [`${COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`, ...(secure ? ["Secure"] : [])].join("; ");
}

/** The session token from a request's cookies, or null. */
export function tokenFrom(req) {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) {
      const value = v.join("=");
      return /^[A-Za-z0-9_-]{40,60}$/.test(value) ? value : null;
    }
  }
  return null;
}

export function createSessions(pool, { now = () => new Date() } = {}) {
  return {
    /** Starts a session; returns the cookie's value. */
    async start(userId) {
      const token = randomBytes(32).toString("base64url");
      const expires = new Date(now().getTime() + SESSION_DAYS * 86_400_000);
      await pool.query("INSERT INTO sessions (session_hash, user_id, expires_at) VALUES ($1, $2, $3)", [sha256(token), userId, expires]);
      return token;
    },
    /** The signed-in user for a request, or null. */
    async user(req) {
      const token = tokenFrom(req);
      if (!token) return null;
      const { rows } = await pool.query(
        `UPDATE sessions s SET last_seen_at = $2
         FROM users u
         WHERE s.session_hash = $1 AND s.user_id = u.user_id AND s.revoked_at IS NULL AND s.expires_at > $2
         RETURNING u.user_id, u.email, u.display_name`,
        [sha256(token), now()],
      );
      const u = rows[0];
      return u ? { id: u.user_id, email: u.email, displayName: u.display_name } : null;
    },
    async end(req) {
      const token = tokenFrom(req);
      if (token) await pool.query("UPDATE sessions SET revoked_at = $2 WHERE session_hash = $1 AND revoked_at IS NULL", [sha256(token), now()]);
    },
    /** Ends every session an account has, on every device. Returns how many. */
    async endAll(userId) {
      const { rowCount } = await pool.query("UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL", [userId, now()]);
      return rowCount;
    },
  };
}
