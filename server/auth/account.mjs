/**
 * An account's saved looks on the server, and the guest-to-account hand-over.
 *
 * claim: after signing in, the page sends the looks this browser saved as a guest. They move to the
 * account once per (account, guest id): a second claim from the same guest changes nothing. Among the
 * account's looks, one per dedupe key (the same rule as the browser's, docs/data-schemas.md 7.3), so a
 * look saved on two devices is kept once. A guest id can only be claimed by the account whose sign-in
 * link was asked for from it, so no one can take another browser's looks.
 */
import { createHash } from "node:crypto";

export const MAX_LOOKS = 100;
const MAX_LOOK_BYTES = 40_000;

const lookId = (userId, dedupeKey) => `slook_${createHash("sha256").update(`${userId}|${dedupeKey}`).digest("hex").slice(0, 24)}`;
const text = (v, max) => (typeof v === "string" && v.trim() && v.length <= max ? v : null);

/** A saved look from the page (src/shared/store.ts SavedLook), checked; null when it isn't one. */
export function readLook(v) {
  if (!v || typeof v !== "object") return null;
  const dedupeKey = text(v.dedupeKey, 600);
  const occasionLabel = text(v.occasionLabel, 120);
  const savedAt = text(v.savedAt, 40);
  if (!dedupeKey || !occasionLabel || !savedAt || Number.isNaN(Date.parse(savedAt))) return null;
  if (!v.look || typeof v.look !== "object" || !text(v.look.id, 200)) return null;
  const snapshot = JSON.stringify(v.look);
  if (snapshot.length > MAX_LOOK_BYTES) return null;
  return {
    dedupeKey,
    occasionLabel,
    savedAt: new Date(savedAt).toISOString(),
    outfitId: v.look.id,
    snapshot,
    recommendationId: text(v.recommendationId, 200),
    requestId: text(v.requestId, 200),
    inputKey: text(v.inputKey, 600),
  };
}

async function insertLook(client, userId, anonymousSessionId, l) {
  const { rowCount } = await client.query(
    `INSERT INTO saved_looks (saved_look_id, owner_user_id, owner_anonymous_session_id, recommendation_id, request_id, outfit_id, input_key, occasion_label, look_snapshot, dedupe_key, saved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
     ON CONFLICT DO NOTHING`,
    [lookId(userId, l.dedupeKey), userId, anonymousSessionId, l.recommendationId, l.requestId, l.outfitId, l.inputKey, l.occasionLabel, l.snapshot, l.dedupeKey, l.savedAt],
  );
  return rowCount === 1;
}

export function createAccounts(pool) {
  return {
    /** Moves a guest's looks to the account, once. Returns { moved, duplicates, rejected, already }. */
    async claim(user, anonymousSessionId, looks) {
      if (typeof anonymousSessionId !== "string" || !Array.isArray(looks)) throw Object.assign(new Error("Send anonymousSessionId and looks."), { status: 400 });
      if (looks.length > MAX_LOOKS) throw Object.assign(new Error(`At most ${MAX_LOOKS} looks.`), { status: 413 });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const started = await client.query("SELECT 1 FROM sign_in_links WHERE email = $1 AND anonymous_session_id = $2 AND used_at IS NOT NULL LIMIT 1", [user.email.toLowerCase(), anonymousSessionId]);
        if (!started.rowCount) throw Object.assign(new Error("This browser didn't sign in to this account."), { status: 403 });
        const fresh = await client.query("INSERT INTO account_claims (user_id, anonymous_session_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1", [user.id, anonymousSessionId]);
        if (!fresh.rowCount) {
          await client.query("ROLLBACK");
          return { moved: 0, duplicates: 0, rejected: 0, already: true };
        }
        let moved = 0;
        let duplicates = 0;
        let rejected = 0;
        for (const raw of looks) {
          const l = readLook(raw);
          if (!l) rejected += 1;
          else if (await insertLook(client, user.id, anonymousSessionId, l)) moved += 1;
          else duplicates += 1;
        }
        await client.query("UPDATE account_claims SET looks_moved = $3, looks_duplicate = $4 WHERE user_id = $1 AND anonymous_session_id = $2", [user.id, anonymousSessionId, moved, duplicates]);
        await client.query("COMMIT");
        return { moved, duplicates, rejected, already: false };
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },

    /** The account's looks, newest first, in the page's SavedLook shape. */
    async looks(user) {
      const { rows } = await pool.query(
        `SELECT saved_look_id, saved_at, occasion_label, look_snapshot, recommendation_id, request_id, input_key, dedupe_key, owner_anonymous_session_id
         FROM saved_looks WHERE owner_user_id = $1 ORDER BY saved_at DESC LIMIT 500`,
        [user.id],
      );
      return rows.map((r) => ({
        id: r.saved_look_id,
        savedAt: r.saved_at.toISOString(),
        occasionLabel: r.occasion_label,
        look: r.look_snapshot,
        ...(r.recommendation_id ? { recommendationId: r.recommendation_id } : {}),
        ...(r.request_id ? { requestId: r.request_id } : {}),
        ...(r.input_key ? { inputKey: r.input_key } : {}),
        dedupeKey: r.dedupe_key,
        owner: { anonymousSessionId: r.owner_anonymous_session_id, userId: user.id },
      }));
    },

    /** Saves one look to the account (signed in). Returns { saved, duplicate }. */
    async save(user, anonymousSessionId, raw) {
      const l = readLook(raw);
      if (!l || typeof anonymousSessionId !== "string") throw Object.assign(new Error("That isn't a saved look."), { status: 400 });
      const client = await pool.connect();
      try {
        const saved = await insertLook(client, user.id, anonymousSessionId, l);
        return { saved, duplicate: !saved, id: lookId(user.id, l.dedupeKey) };
      } finally {
        client.release();
      }
    },

    async remove(user, id) {
      const { rowCount } = await pool.query("DELETE FROM saved_looks WHERE owner_user_id = $1 AND saved_look_id = $2", [user.id, id]);
      return rowCount === 1;
    },

    /** The account's consents: the newest record for each category, with when it was given and withdrawn. */
    async consents(user) {
      const { rows } = await pool.query(
        `SELECT DISTINCT ON (category) category, version, granted_at, withdrawn_at
         FROM consents WHERE owner_user_id = $1 ORDER BY category, granted_at DESC`,
        [user.id],
      );
      return rows.map((r) => ({ category: r.category, version: r.version, grantedAt: r.granted_at.toISOString(), withdrawnAt: r.withdrawn_at?.toISOString() ?? null }));
    },

    /** Withdraws every consent the account holds now. The history stays; signing in again asks again. */
    async withdrawConsents(user, at = new Date()) {
      const { rows } = await pool.query("UPDATE consents SET withdrawn_at = $2 WHERE owner_user_id = $1 AND withdrawn_at IS NULL RETURNING category", [user.id, at]);
      return rows.map((r) => r.category).sort();
    },

    /** Removes the account's look with this dedupe key. Already gone counts as done, so the page can retry. */
    async removeByKey(user, dedupeKey) {
      if (!text(dedupeKey, 600)) throw Object.assign(new Error("Send the look's dedupeKey."), { status: 400 });
      const { rowCount } = await pool.query("DELETE FROM saved_looks WHERE owner_user_id = $1 AND dedupe_key = $2", [user.id, dedupeKey]);
      return { removed: rowCount > 0 };
    },
  };
}
