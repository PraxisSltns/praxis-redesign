/**
 * Sign-in by email link: the default AuthProvider (server/auth/provider.mjs).
 *
 * start: checks the address and the consents, limits how often a link can be asked for, keeps only a
 * hash of a random token (15 minutes, one use) and emails the link. It answers the same whether or not
 * the address has an account, so the form can't be used to find out who has one.
 * finish: takes the token once, makes the account if it's new (recording its consents), and returns it.
 */
import { createHash, randomBytes } from "node:crypto";
import { checkConsents } from "../../src/shared/consents.mjs";

export const LINK_MINUTES = 15;
export const LIMITS = { perEmail: 5, perAddress: 30, windowSeconds: 3600 };

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const newId = (prefix) => `${prefix}_${randomBytes(16).toString("hex")}`;

export const isEmail = (v) => typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const isAnonymousId = (v) => typeof v === "string" && /^anon_[A-Za-z0-9_-]{6,80}$/.test(v);

export class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Counts a request in a Redis window; true while it's under the limit. No Redis configured: no limit. */
async function underLimit(redis, key, limit, seconds) {
  if (!redis) return true;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, seconds);
  return n <= limit;
}

export function createMagicLinkProvider({ pool, redis = null, mailer, appOrigin, now = () => new Date() }) {
  return {
    id: "magic-link",

    async start({ email, anonymousSessionId, consents, address = "" }) {
      if (!isEmail(email)) throw new AuthError(400, "bad_email", "That address looks incomplete.");
      if (!isAnonymousId(anonymousSessionId)) throw new AuthError(400, "bad_request", "anonymousSessionId missing.");
      const { ok, missing } = checkConsents(consents);
      if (missing.length) throw new AuthError(400, "consent_missing", `Agree to the ${missing.join(" and ")} to continue.`);
      if (!mailer) throw new AuthError(503, "not_available", "Sign-in by email isn't available on this server yet.");
      const normal = email.trim().toLowerCase();
      try {
        const byEmail = await underLimit(redis, `auth:start:email:${sha256(normal)}`, LIMITS.perEmail, LIMITS.windowSeconds);
        const byAddress = await underLimit(redis, `auth:start:ip:${sha256(address)}`, LIMITS.perAddress, LIMITS.windowSeconds);
        if (!byEmail || !byAddress) throw new AuthError(429, "too_many", "That's a lot of links. Try again in an hour.");
      } catch (e) {
        if (e instanceof AuthError) throw e;
        // The limit can't be checked: refuse rather than send unlimited mail.
        throw new AuthError(503, "not_available", "Sign-in is busy. Try again shortly.");
      }
      const token = newToken();
      const expires = new Date(now().getTime() + LINK_MINUTES * 60_000);
      await pool.query(
        "INSERT INTO sign_in_links (token_hash, email, anonymous_session_id, consents, expires_at) VALUES ($1, $2, $3, $4::jsonb, $5)",
        [sha256(token), normal, anonymousSessionId, JSON.stringify(ok.map(({ category, version }) => ({ category, version }))), expires],
      );
      const link = `${appOrigin}/auth/verify?token=${encodeURIComponent(token)}`;
      await mailer.send({
        to: normal,
        link,
        subject: "Your Praxis sign-in link",
        text: `Here is your link to sign in to Praxis:\n\n${link}\n\nIt works once, for ${LINK_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`,
        html: `<p>Here is your link to sign in to Praxis:</p><p><a href="${link}">Sign in to Praxis</a></p><p>It works once, for ${LINK_MINUTES} minutes. If you didn't ask for it, you can ignore this email.</p>`,
      });
      return { sent: true };
    },

    async finish({ token }) {
      if (typeof token !== "string" || token.length < 20 || token.length > 200) throw new AuthError(400, "bad_link", "That link isn't complete.");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // One use: the first request marks it, any other finds it used.
        const { rows } = await client.query(
          `UPDATE sign_in_links SET used_at = $2
           WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
           RETURNING email, anonymous_session_id, consents`,
          [sha256(token), now()],
        );
        if (!rows.length) throw new AuthError(400, "link_expired", "That link has expired or was already used. Ask for a new one.");
        const { email, anonymous_session_id: anonymousSessionId, consents } = rows[0];
        const found = await client.query("SELECT user_id, email, display_name FROM users WHERE lower(email) = $1", [email]);
        let user = found.rows[0];
        const isNew = !user;
        if (isNew) {
          user = (await client.query("INSERT INTO users (user_id, email) VALUES ($1, $2) RETURNING user_id, email, display_name", [newId("user"), email])).rows[0];
        }
        // Record each consent agreed on the form that the account doesn't already hold at this version.
        for (const c of consents) {
          await client.query(
            `INSERT INTO consents (consent_id, owner_user_id, owner_anonymous_session_id, category, version, granted_at)
             SELECT $1, $2, $3, $4, $5, $6
             WHERE NOT EXISTS (SELECT 1 FROM consents WHERE owner_user_id = $2 AND category = $4 AND version = $5 AND withdrawn_at IS NULL)`,
            [newId("consent"), user.user_id, anonymousSessionId, c.category, c.version, now()],
          );
        }
        await client.query("COMMIT");
        return { user: { id: user.user_id, email: user.email, displayName: user.display_name }, isNew, anonymousSessionId };
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
  };
}
