/**
 * The account's own controls: download everything the server keeps for it, and delete it.
 *
 * Download: one JSON document with the account, every consent given and withdrawn, the sessions (dates
 * only, never a token), the sign-in links asked for (dates only), the saved looks, wardrobe pieces,
 * feedback and guest hand-overs. Photos are never on the server, so there are none to include.
 *
 * Delete: the user row goes, and with it (ON DELETE CASCADE) its consents, sessions, saved looks,
 * feedback, wardrobe pieces and hand-overs; the sign-in links sent to its address go too. What is kept
 * afterwards is one setting, ACCOUNT_DELETION_KEEP_CONSENT_DAYS: 0 (the default) keeps nothing; above 0
 * keeps the consent history, with the address only as a SHA-256 hash, for that many days
 * (server/db/migrations/1762200000700_account-deletions.sql). The legal text decides the number.
 */
import { createHash, randomBytes } from "node:crypto";

const iso = (d) => (d ? new Date(d).toISOString() : null);
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** Days of consent history to keep after a deletion, from the environment: a whole number, 0 to 3650. */
export function keepConsentDays(env = process.env) {
  const n = Number((env.ACCOUNT_DELETION_KEEP_CONSENT_DAYS ?? "0").trim() || "0");
  return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : 0;
}

/** Removes kept consent histories whose time is up. Returns how many. */
export async function purgeExpiredDeletions(pool, now = new Date()) {
  const { rowCount } = await pool.query("DELETE FROM account_deletions WHERE keep_until <= $1", [now]);
  return rowCount;
}

export function createControls(pool, { now = () => new Date(), env = process.env } = {}) {
  return {
    /** Everything the server keeps for this account, as one document. */
    async export(user) {
      const q = async (sql) => (await pool.query(sql, [user.id])).rows;
      const [account] = await q("SELECT email, display_name, premium, created_at FROM users WHERE user_id = $1");
      const [consents, sessions, links, looks, wardrobe, feedback, claims] = await Promise.all([
        q("SELECT category, version, granted_at, withdrawn_at FROM consents WHERE owner_user_id = $1 ORDER BY granted_at"),
        q("SELECT created_at, last_seen_at, expires_at, revoked_at FROM sessions WHERE user_id = $1 ORDER BY created_at"),
        pool.query("SELECT created_at, expires_at, used_at FROM sign_in_links WHERE lower(email) = lower($1) ORDER BY created_at", [user.email]).then((r) => r.rows),
        q("SELECT saved_at, occasion_label, look_snapshot FROM saved_looks WHERE owner_user_id = $1 ORDER BY saved_at"),
        q("SELECT slot, label, source, colour, added_at, updated_at FROM wardrobe_items WHERE owner_user_id = $1 ORDER BY added_at"),
        q("SELECT outfit_id, garment_id, feedback, reason, created_at FROM feedback WHERE user_id = $1 ORDER BY created_at"),
        q("SELECT claimed_at, looks_moved, looks_duplicate FROM account_claims WHERE user_id = $1 ORDER BY claimed_at"),
      ]);
      return {
        exportedAt: now().toISOString(),
        about: "Everything Praxis keeps for your account on its server. Photos are never sent to the server, so there are none here; what is kept only in your browser is listed on Your data.",
        account: { email: account?.email ?? user.email, ...(account?.display_name ? { name: account.display_name } : {}), premium: Boolean(account?.premium), createdAt: iso(account?.created_at) },
        consents: consents.map((c) => ({ category: c.category, version: c.version, grantedAt: iso(c.granted_at), withdrawnAt: iso(c.withdrawn_at) })),
        sessions: sessions.map((s) => ({ startedAt: iso(s.created_at), lastSeenAt: iso(s.last_seen_at), expiresAt: iso(s.expires_at), endedAt: iso(s.revoked_at) })),
        signInLinks: links.map((l) => ({ sentAt: iso(l.created_at), expiresAt: iso(l.expires_at), usedAt: iso(l.used_at) })),
        savedLooks: looks.map((l) => ({ savedAt: iso(l.saved_at), occasion: l.occasion_label, look: l.look_snapshot })),
        wardrobe: wardrobe.map((w) => ({ slot: w.slot, name: w.label, source: w.source, ...(w.colour ? { colour: w.colour } : {}), addedAt: iso(w.added_at), updatedAt: iso(w.updated_at) })),
        feedback: feedback.map((f) => ({ outfitId: f.outfit_id, ...(f.garment_id ? { garmentId: f.garment_id } : {}), feedback: f.feedback, ...(f.reason ? { reason: f.reason } : {}), givenAt: iso(f.created_at) })),
        guestHandOvers: claims.map((c) => ({ at: iso(c.claimed_at), looksMoved: c.looks_moved, looksAlreadyThere: c.looks_duplicate })),
      };
    },

    /** Deletes the account and everything kept with it. Returns what was removed and what is kept. */
    async delete(user) {
      const days = keepConsentDays(env);
      const at = now();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: consents } = await client.query("SELECT category, version, granted_at, withdrawn_at FROM consents WHERE owner_user_id = $1 ORDER BY granted_at", [user.id]);
        if (days > 0) {
          await client.query("INSERT INTO account_deletions (deletion_id, email_sha256, deleted_at, keep_until, consents) VALUES ($1, $2, $3, $4, $5::jsonb)", [
            `del_${randomBytes(12).toString("hex")}`,
            sha256(user.email.trim().toLowerCase()),
            at,
            new Date(at.getTime() + days * 86_400_000),
            JSON.stringify(consents.map((c) => ({ category: c.category, version: c.version, grantedAt: iso(c.granted_at), withdrawnAt: iso(c.withdrawn_at) }))),
          ]);
        }
        const links = await client.query("DELETE FROM sign_in_links WHERE lower(email) = lower($1)", [user.email]);
        const gone = await client.query("DELETE FROM users WHERE user_id = $1", [user.id]);
        await client.query("DELETE FROM account_deletions WHERE keep_until <= $1", [at]);
        await client.query("COMMIT");
        return { deleted: gone.rowCount === 1, signInLinks: links.rowCount, keptConsentDays: days };
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
  };
}
