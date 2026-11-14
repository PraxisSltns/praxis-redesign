/**
 * An account's wardrobe pieces and feedback on the server (tables wardrobe_items and feedback), for the
 * page's three-way sync (src/core/accountSync.ts). Each record is keyed by the page's own id (a wardrobe
 * piece by the account and its id, since the same sample piece has the same id for everyone), so it is
 * one row however often it is sent. A record can only be written or removed by the account that owns it;
 * a feedback id another account holds is refused.
 *
 * Wardrobe photos never come here: only the piece's name, type and colour.
 */
const SLOTS = ["top", "bottom", "shoes", "extras"];
const SOURCES = ["sample", "upload", "described"];
const KINDS = ["more_like_this", "not_for_me"];
const REASONS = ["too_formal", "too_casual", "wrong_colours", "wrong_fit", "too_expensive"];
export const MAX_WARDROBE = 50;
export const MAX_FEEDBACK = 300;

const bad = (message) => Object.assign(new Error(message), { status: 400 });
const text = (v, max) => (typeof v === "string" && v.trim() && v.length <= max ? v : null);
const time = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
const id = (v, prefix) => (typeof v === "string" && v.startsWith(prefix) && v.length <= 80 && /^[A-Za-z0-9_:.-]+$/.test(v) ? v : null);

/** A wardrobe piece from the page (src/core/data.ts WardrobeEntry), checked. */
export function readWardrobeItem(v) {
  if (!v || typeof v !== "object") return null;
  const wardrobeItemId = id(v.wardrobeItemId, "wardrobe_");
  const label = text(v.label, 60);
  const addedAt = time(v.addedAt);
  if (!wardrobeItemId || !label || !addedAt || !SLOTS.includes(v.slot) || !SOURCES.includes(v.source)) return null;
  const colour = v.colour === undefined ? null : text(v.colour, 30);
  if (v.colour !== undefined && !colour) return null;
  const updatedAt = v.updatedAt === undefined ? null : time(v.updatedAt);
  if (v.updatedAt !== undefined && !updatedAt) return null;
  return { wardrobeItemId, slot: v.slot, label, source: v.source, colour, addedAt, updatedAt };
}

/** A word on a look from the page (src/core/contracts.ts OutfitFeedback), checked. */
export function readFeedback(v) {
  if (!v || typeof v !== "object") return null;
  const eventId = id(v.eventId, "fb_");
  const createdAt = time(v.createdAt);
  const recommendationId = text(v.recommendationId, 200);
  const requestId = text(v.requestId, 200);
  const outfitId = text(v.outfitId, 200);
  if (!eventId || !createdAt || !recommendationId || !requestId || !outfitId || !KINDS.includes(v.feedback)) return null;
  if (v.reason !== undefined && !REASONS.includes(v.reason)) return null;
  const adapterId = text(v.adapter?.id, 80);
  const adapterVersion = text(v.adapter?.version, 80);
  if (!adapterId || !adapterVersion) return null;
  const garmentId = v.garmentId === undefined ? null : text(v.garmentId, 200);
  return { eventId, createdAt, recommendationId, requestId, outfitId, garmentId, feedback: v.feedback, reason: v.reason ?? null, adapterId, adapterVersion };
}

export function createRecords(pool) {
  return {
    async wardrobe(user) {
      const { rows } = await pool.query(
        `SELECT wardrobe_item_id, slot, label, source, colour, added_at, updated_at, owner_anonymous_session_id
         FROM wardrobe_items WHERE owner_user_id = $1 ORDER BY coalesce(updated_at, added_at) DESC LIMIT $2`,
        [user.id, MAX_WARDROBE * 4],
      );
      return rows.map((r) => ({
        wardrobeItemId: r.wardrobe_item_id,
        slot: r.slot,
        label: r.label,
        source: r.source,
        ...(r.colour ? { colour: r.colour } : {}),
        addedAt: r.added_at.toISOString(),
        ...(r.updated_at ? { updatedAt: r.updated_at.toISOString() } : {}),
        owner: { anonymousSessionId: r.owner_anonymous_session_id, userId: user.id },
      }));
    },

    /** Adds or changes one of the account's pieces. */
    async putWardrobe(user, anonymousSessionId, raw) {
      const item = readWardrobeItem(raw);
      if (!item || !text(anonymousSessionId, 120)) throw bad("That isn't a wardrobe piece.");
      const { rowCount } = await pool.query(
        `INSERT INTO wardrobe_items (wardrobe_item_id, owner_user_id, owner_anonymous_session_id, slot, label, source, colour, added_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (owner_user_id, wardrobe_item_id) DO UPDATE SET slot = EXCLUDED.slot, label = EXCLUDED.label, colour = EXCLUDED.colour, updated_at = EXCLUDED.updated_at`,
        [item.wardrobeItemId, user.id, anonymousSessionId, item.slot, item.label, item.source, item.colour, item.addedAt, item.updatedAt],
      );
      return { saved: rowCount === 1 };
    },

    async removeWardrobe(user, wardrobeItemId) {
      if (!id(wardrobeItemId, "wardrobe_")) throw bad("Send the piece's wardrobeItemId.");
      const { rowCount } = await pool.query("DELETE FROM wardrobe_items WHERE owner_user_id = $1 AND wardrobe_item_id = $2", [user.id, wardrobeItemId]);
      return { removed: rowCount > 0 };
    },

    async feedback(user) {
      const { rows } = await pool.query(
        `SELECT feedback_id, anonymous_session_id, recommendation_id, request_id, outfit_id, garment_id, feedback, reason, adapter_id, adapter_version, created_at
         FROM feedback WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [user.id, MAX_FEEDBACK * 2],
      );
      return rows.map((r) => ({
        eventId: r.feedback_id,
        anonymousSessionId: r.anonymous_session_id,
        userId: user.id,
        recommendationId: r.recommendation_id,
        requestId: r.request_id,
        outfitId: r.outfit_id,
        ...(r.garment_id ? { garmentId: r.garment_id } : {}),
        feedback: r.feedback,
        ...(r.reason ? { reason: r.reason } : {}),
        adapter: { id: r.adapter_id, version: r.adapter_version },
        createdAt: r.created_at.toISOString(),
      }));
    },

    /** Keeps one word on a look. Feedback isn't edited, only given or taken back, so a repeat changes nothing. */
    async putFeedback(user, anonymousSessionId, raw) {
      const f = readFeedback(raw);
      if (!f || !text(anonymousSessionId, 120)) throw bad("That isn't feedback on a look.");
      await pool.query(
        `INSERT INTO feedback (feedback_id, anonymous_session_id, user_id, recommendation_id, request_id, outfit_id, garment_id, feedback, reason, adapter_id, adapter_version, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (feedback_id) DO NOTHING`,
        [f.eventId, anonymousSessionId, user.id, f.recommendationId, f.requestId, f.outfitId, f.garmentId, f.feedback, f.reason, f.adapterId, f.adapterVersion, f.createdAt],
      );
      const { rows } = await pool.query("SELECT user_id FROM feedback WHERE feedback_id = $1", [f.eventId]);
      if (rows[0]?.user_id !== user.id) throw Object.assign(new Error("That feedback belongs to someone else."), { status: 409 });
      return { saved: true };
    },

    async removeFeedback(user, eventId) {
      if (!id(eventId, "fb_")) throw bad("Send the feedback's eventId.");
      const { rowCount } = await pool.query("DELETE FROM feedback WHERE user_id = $1 AND feedback_id = $2", [user.id, eventId]);
      return { removed: rowCount > 0 };
    },
  };
}
