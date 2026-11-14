/**
 * Product analytics with a closed dictionary. Every event name and every property is declared below
 * with its type, and anything else is refused: no free-form properties, and a guard that refuses
 * anything that looks like an email address, an image or a long text. Face images, body photos,
 * derived skin readings, credentials and payment details are never accepted.
 *
 * Events go to a sink. Today the only sink keeps them in this browser (the internal page at
 * /internal/analytics reads them); an approved analytics service plugs in as another sink.
 */
import { APP_VERSION } from "./config";
import { anonymousId, currentUserId } from "./identity";
import { local, newId, readJson, session, writeJson } from "./ids";
import { simScenario } from "./sim";

type Prop =
  | { type: "string"; required?: boolean }
  | { type: "number"; required?: boolean }
  | { type: "boolean"; required?: boolean }
  | { type: "enum"; values: readonly string[]; required?: boolean };

interface EventSpec {
  category: "acquisition" | "journey" | "engagement" | "commercial" | "retention" | "account";
  journey?: "style_a_moment" | "style_dna";
  /** When it fires, in plain words. Also the analytics dictionary in docs/AI-READINESS.md. */
  trigger: string;
  props: Record<string, Prop>;
}

const OCCASION = { type: "enum", values: ["DINNER", "WORK", "DATE", "WEDDING", "PARTY"] } as const;
const REC = { type: "string", required: true } as const;
const OUTFIT = { type: "string", required: true } as const;
const QUESTION = { type: "enum", values: ["occasion", "venue", "time", "vibe", "spend"], required: true } as const;
const FEATURE = { type: "enum", values: ["style_dna", "tryon"], required: true } as const;
const PHOTO = { type: "enum", values: ["face_colour", "body_fit", "wardrobe_garment", "try_on"], required: true } as const;

export const EVENTS = {
  landing_viewed: { category: "acquisition", trigger: "The home page is shown, once per visit.", props: { via: { type: "enum", values: ["story", "friend", "link", "none"], required: true } } },
  occasion_selected: { category: "acquisition", journey: "style_a_moment", trigger: "An occasion is chosen on home or on the occasion question.", props: { occasion: { ...OCCASION, required: true }, surface: { type: "enum", values: ["home", "question"], required: true } } },
  style_dna_explored: { category: "acquisition", journey: "style_dna", trigger: "Explore Style DNA (or a Style DNA link) is tapped by someone without a Style DNA.", props: { surface: { type: "enum", values: ["home", "bar", "menu", "completion"], required: true } } },

  question_answered: { category: "journey", journey: "style_a_moment", trigger: "An answer is chosen on a Style a Moment question.", props: { question: QUESTION, answer: { type: "string", required: true }, step: { type: "number", required: true }, restyle: { type: "boolean", required: true } } },
  step_abandoned: { category: "journey", journey: "style_a_moment", trigger: "The page is closed or left while a question is open and unanswered.", props: { question: QUESTION } },
  styling_submitted: { category: "journey", journey: "style_a_moment", trigger: "A styling request is sent to the recommendation service.", props: { requestId: { type: "string", required: true }, inputKey: { type: "string", required: true }, adapter: { type: "string", required: true }, wardrobeItems: { type: "number", required: true } } },
  processing_started: { category: "journey", journey: "style_a_moment", trigger: "The service starts working on a request.", props: { requestId: { type: "string", required: true } } },
  processing_completed: { category: "journey", journey: "style_a_moment", trigger: "The service answers with looks (complete or partial) or none.", props: { requestId: { type: "string", required: true }, recommendationId: REC, status: { type: "enum", values: ["completed", "partial", "empty"], required: true }, outfits: { type: "number", required: true }, durationMs: { type: "number", required: true } } },
  processing_failed: { category: "journey", journey: "style_a_moment", trigger: "The service fails, or its answer is rejected by validation.", props: { requestId: { type: "string", required: true }, code: { type: "string", required: true } } },
  processing_delayed: { category: "journey", journey: "style_a_moment", trigger: "A request runs long enough for the screen to say it is taking longer than usual.", props: { requestId: { type: "string", required: true } } },
  processing_cancelled: { category: "journey", journey: "style_a_moment", trigger: "The customer cancels a request while it runs.", props: { requestId: { type: "string", required: true } } },
  retry_requested: { category: "journey", journey: "style_a_moment", trigger: "Try again is tapped after a failed request.", props: { attempt: { type: "number", required: true }, code: { type: "string", required: true } } },
  results_viewed: { category: "journey", journey: "style_a_moment", trigger: "The looks for a recommendation are first shown in a visit.", props: { recommendationId: REC, outfits: { type: "number", required: true }, mode: { type: "enum", values: ["demonstration", "personalized"], required: true }, shared: { type: "boolean", required: true } } },

  outfit_selected: { category: "engagement", journey: "style_a_moment", trigger: "Another look is brought to the front.", props: { recommendationId: REC, outfitId: OUTFIT, rank: { type: "number", required: true }, method: { type: "enum", values: ["thumbnail", "swipe", "arrow", "key", "viewer"], required: true } } },
  outfit_enlarged: { category: "engagement", journey: "style_a_moment", trigger: "A look is opened large.", props: { recommendationId: REC, outfitId: OUTFIT } },
  garment_deselected: { category: "engagement", journey: "style_a_moment", trigger: "A piece is unticked.", props: { recommendationId: { type: "string" }, outfitId: OUTFIT, garmentId: { type: "string", required: true } } },
  garment_reselected: { category: "engagement", journey: "style_a_moment", trigger: "An unticked piece is ticked again.", props: { recommendationId: { type: "string" }, outfitId: OUTFIT, garmentId: { type: "string", required: true } } },
  recommendation_rejected: { category: "engagement", journey: "style_a_moment", trigger: "Not for me is tapped on a look.", props: { recommendationId: REC, outfitId: OUTFIT, rank: { type: "number", required: true } } },
  feedback_submitted: { category: "engagement", journey: "style_a_moment", trigger: "More like this is tapped, or a reason is given after Not for me.", props: { recommendationId: REC, outfitId: OUTFIT, feedback: { type: "enum", values: ["more_like_this", "not_for_me"], required: true }, reason: { type: "enum", values: ["too_formal", "too_casual", "wrong_colours", "wrong_fit", "too_expensive"] }, garmentId: { type: "string" } } },
  look_shared: { category: "engagement", journey: "style_a_moment", trigger: "A share action completes or hands off to the system share sheet.", props: { recommendationId: { type: "string" }, outfitId: OUTFIT, channel: { type: "enum", values: ["story", "friend", "image", "link"], required: true } } },
  restyle_changed: { category: "engagement", journey: "style_a_moment", trigger: "An answer is changed from Restyle.", props: { field: { type: "enum", values: ["occasion", "venue", "time", "vibe", "spend"], required: true } } },

  size_selected: { category: "commercial", journey: "style_a_moment", trigger: "A size is chosen for a piece in Check out.", props: { outfitId: OUTFIT, garmentId: { type: "string", required: true }, size: { type: "string", required: true } } },
  retailer_redirected: { category: "commercial", journey: "style_a_moment", trigger: "The customer leaves for a retailer's site to buy a piece. Only when a real link exists.", props: { outfitId: OUTFIT, garmentId: { type: "string", required: true }, retailerId: { type: "string", required: true }, route: { type: "enum", values: ["retailer_site", "affiliate"], required: true } } },
  checkout_initiated: { category: "commercial", journey: "style_a_moment", trigger: "Check out is opened with at least one piece chosen.", props: { recommendationId: { type: "string" }, outfitId: OUTFIT, pieces: { type: "number", required: true }, total: { type: "number", required: true }, priceStatus: { type: "enum", values: ["example", "estimated", "live"], required: true } } },

  look_saved: { category: "retention", journey: "style_a_moment", trigger: "A look is saved, signed in or not.", props: { recommendationId: { type: "string" }, outfitId: OUTFIT, signedIn: { type: "boolean", required: true } } },
  saved_look_reopened: { category: "retention", trigger: "A saved look is opened from Saved looks.", props: { outfitId: OUTFIT } },
  user_returned: { category: "retention", trigger: "A browser that has visited before starts a new visit.", props: { daysSinceLastVisit: { type: "number", required: true }, visits: { type: "number", required: true } } },
  wardrobe_item_added: { category: "retention", journey: "style_a_moment", trigger: "A piece the customer owns is added, from the looks or the wardrobe. Never carries the photo or its name.", props: { slot: { type: "enum", values: ["top", "bottom", "shoes", "extras"], required: true }, source: { type: "enum", values: ["sample", "upload", "described"], required: true }, surface: { type: "enum", values: ["looks", "wardrobe"] } } },
  wardrobe_item_edited: { category: "retention", trigger: "A piece in the wardrobe gets a new name, type or colour. Never carries the words.", props: { slot: { type: "enum", values: ["top", "bottom", "shoes", "extras"], required: true } } },
  wardrobe_item_removed: { category: "retention", trigger: "A piece is removed from the wardrobe.", props: { slot: { type: "enum", values: ["top", "bottom", "shoes", "extras"], required: true } } },
  wardrobe_item_used: { category: "retention", journey: "style_a_moment", trigger: "A piece from the wardrobe is used in a set of looks.", props: { slot: { type: "enum", values: ["top", "bottom", "shoes", "extras"], required: true } } },
  style_dna_started: { category: "retention", journey: "style_dna", trigger: "The first Style DNA question is shown.", props: {} },
  style_dna_step: { category: "retention", journey: "style_dna", trigger: "A Style DNA question is answered. The photo answer says only own or sample.", props: { step: { type: "enum", values: ["photo", "fit", "week", "taste"], required: true }, answer: { type: "string", required: true } } },
  style_dna_analysis_finished: { category: "retention", journey: "style_dna", trigger: "The colour estimate for a Style DNA photo comes back. Says only the outcome, never a result.", props: { status: { type: "enum", values: ["completed", "unreadable", "failed", "disabled"], required: true } } },
  style_dna_estimate_confirmed: { category: "retention", journey: "style_dna", trigger: "Looks right is tapped on the colour estimate.", props: {} },
  style_dna_corrected: { category: "retention", journey: "style_dna", trigger: "The customer changes part of their Style DNA. Says which part, never the value.", props: { field: { type: "enum", values: ["undertone", "contrast", "fit", "week", "tastes"], required: true } } },
  style_dna_completed: { category: "retention", journey: "style_dna", trigger: "A Style DNA is saved.", props: { photo: { type: "enum", values: ["own", "sample"], required: true }, tasteCount: { type: "number", required: true } } },

  photo_consent_given: { category: "account", trigger: "The customer agrees to a use of their photo, before giving one.", props: { category: PHOTO } },
  photo_rejected: { category: "account", trigger: "A photo fails the checks before use. Says why, never the photo.", props: { category: PHOTO, problem: { type: "enum", values: ["not_an_image", "unsupported_type", "too_large", "too_small", "too_dark", "too_bright", "unreadable", "no_face", "colour_cast"], required: true } } },
  photo_deleted: { category: "account", trigger: "The customer deletes a photo they gave.", props: { category: PHOTO } },
  tryon_opened: { category: "engagement", trigger: "See it on me opens for a look, after any gate.", props: { recommendationId: REC, outfitId: { type: "string", required: true } } },
  tryon_photo_ready: { category: "engagement", trigger: "A try-on photo passes the checks and is shown back. Says how it was taken, never the photo.", props: { source: { type: "enum", values: ["camera", "upload"], required: true } } },
  tryon_submitted: { category: "engagement", trigger: "The customer confirms their photo and a try-on request is made.", props: { requestId: { type: "string", required: true }, outfitId: { type: "string", required: true }, adapter: { type: "string", required: true }, attempt: { type: "number", required: true } } },
  tryon_answered: { category: "engagement", trigger: "The try-on service answers, fails, times out or is cancelled.", props: { requestId: { type: "string", required: true }, status: { type: "enum", values: ["ready", "not_connected", "failed", "timed_out", "cancelled"], required: true }, code: { type: "string" }, durationMs: { type: "number", required: true } } },
  local_data_deleted: { category: "account", trigger: "The customer deletes everything Praxis keeps in this browser. Recorded after, as the first event of a clean slate.", props: {} },
  premium_intro_viewed: { category: "account", trigger: "The introduction to a Premium feature is shown.", props: { feature: FEATURE } },
  premium_intro_continued: { category: "account", trigger: "Continue is tapped on a Premium introduction.", props: { feature: FEATURE } },
  paywall_viewed: { category: "account", trigger: "The Premium payment step is shown.", props: { feature: FEATURE } },
  premium_started: { category: "account", trigger: "The Premium preview payment completes. No charge is made.", props: { feature: FEATURE } },
  sync_offer_viewed: { category: "account", trigger: "A guest sees the offer to sign in after saving.", props: {} },
  sync_offer_dismissed: { category: "account", trigger: "A guest declines the offer to sign in after saving.", props: {} },
  signin_completed: { category: "account", trigger: "The sign-in preview completes.", props: { method: { type: "enum", values: ["apple", "google", "email"], required: true }, surface: { type: "enum", values: ["sync_offer", "gate", "menu"], required: true } } },
  signed_out: { category: "account", trigger: "The person signs out; this device becomes a new guest's.", props: {} },
  page_failed: { category: "engagement", trigger: "A page could not be drawn and the error page showed instead.", props: { kind: { type: "string", required: true } } },
  look_save_failed: { category: "engagement", trigger: "Saving a look could not be written to this browser (storage full or blocked). Nothing is shown as saved.", props: { recommendationId: REC, outfitId: { type: "string", required: true } } },
  account_migrated: { category: "account", trigger: "What a guest saved is moved to the account at sign-in.", props: { looks: { type: "number", required: true }, duplicates: { type: "number", required: true }, feedback: { type: "number", required: true }, wardrobe: { type: "number" } } },
  account_consent_withdrawn: { category: "account", trigger: "A signed-in account withdraws its agreement to the terms and privacy notice from Your data; it is signed out on every device.", props: { count: { type: "number", required: true } } },
  account_migration_failed: { category: "account", trigger: "Moving a guest's looks or feedback to the account could not be written; what was not moved stays as it was.", props: { part: { type: "enum", values: ["looks", "feedback"], required: true } } },
} as const satisfies Record<string, EventSpec>;

export type EventName = keyof typeof EVENTS;

type ValueOf<P> = P extends { type: "enum"; values: readonly (infer V)[] } ? V : P extends { type: "number" } ? number : P extends { type: "boolean" } ? boolean : string;
type PropsOf<N extends EventName> = (typeof EVENTS)[N]["props"];
export type EventProps<N extends EventName> = {
  [K in keyof PropsOf<N> as PropsOf<N>[K] extends { required: true } ? K : never]: ValueOf<PropsOf<N>[K]>;
} & {
  [K in keyof PropsOf<N> as PropsOf<N>[K] extends { required: true } ? never : K]?: ValueOf<PropsOf<N>[K]>;
};

export interface PraxisAnalyticsEvent {
  eventId: string;
  eventName: EventName;
  timestamp: string;
  anonymousSessionId: string;
  userId?: string;
  journey?: "style_a_moment" | "style_dna";
  recommendationId?: string;
  outfitId?: string;
  properties: Record<string, string | number | boolean>;
  applicationVersion: string;
  /** Set while test mode is on, so simulated sessions never count as real ones. */
  testMode?: string;
}

export interface AnalyticsSink {
  send(event: PraxisAnalyticsEvent): void;
}

/* --------------------------------------------------------------- the guard */

const MAX_STRING = 160;
/** Refuses values that could carry personal data: emails, images, encoded blobs, long free text. */
function unsafe(value: string): boolean {
  return value.length > MAX_STRING || /@/.test(value) || /^data:/i.test(value) || /^blob:/i.test(value) || /base64/i.test(value);
}

export type Validation = { ok: true; properties: Record<string, string | number | boolean> } | { ok: false; error: string };

export function validateEvent(name: string, props: Record<string, unknown>): Validation {
  const spec = (EVENTS as Record<string, EventSpec>)[name];
  if (!spec) return { ok: false, error: `unknown event ${name}` };
  const out: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(props)) {
    if (props[key] === undefined) continue;
    if (!(key in spec.props)) return { ok: false, error: `${name}: unknown property ${key}` };
  }
  for (const [key, p] of Object.entries(spec.props)) {
    const v = props[key];
    if (v === undefined || v === null) {
      if (p.required) return { ok: false, error: `${name}: missing ${key}` };
      continue;
    }
    if (p.type === "number" && !(typeof v === "number" && Number.isFinite(v))) return { ok: false, error: `${name}: ${key} must be a number` };
    if (p.type === "boolean" && typeof v !== "boolean") return { ok: false, error: `${name}: ${key} must be true or false` };
    if (p.type === "string" && (typeof v !== "string" || v.length === 0 || unsafe(v))) return { ok: false, error: `${name}: ${key} is not an allowed string` };
    if (p.type === "enum" && !(typeof v === "string" && p.values.includes(v))) return { ok: false, error: `${name}: ${key} is not one of ${p.values.join(", ")}` };
    out[key] = v as string | number | boolean;
  }
  return { ok: true, properties: out };
}

/* --------------------------------------------------------------- the sinks */

const LOCAL_KEY = "praxis_events";
const LOCAL_LIMIT = 1000;

/** Keeps the newest events in this browser, for the internal page and for tests. */
export function createLocalSink(storage: () => Storage | undefined = local): AnalyticsSink & { read(): PraxisAnalyticsEvent[]; clear(): void } {
  return {
    send(event) {
      const events = readJson<PraxisAnalyticsEvent[]>(storage(), LOCAL_KEY) ?? [];
      events.push(event);
      writeJson(storage(), LOCAL_KEY, events.slice(-LOCAL_LIMIT));
    },
    read: () => readJson<PraxisAnalyticsEvent[]>(storage(), LOCAL_KEY) ?? [],
    clear: () => void writeJson(storage(), LOCAL_KEY, null),
  };
}

export const localSink = createLocalSink();
const sinks: AnalyticsSink[] = [localSink];

/** Adds a sink, such as an approved analytics service. Returns a function that removes it. */
export function addSink(sink: AnalyticsSink): () => void {
  sinks.push(sink);
  return () => {
    const i = sinks.indexOf(sink);
    if (i >= 0) sinks.splice(i, 1);
  };
}

/* ------------------------------------------------------------- recording */

const ONCE_KEY = "praxis_events_once";

/**
 * Records one event. Returns it, or null when the dictionary refuses it (the reason is logged in
 * development). With `once`, an event with the same key is recorded only once per visit, so a
 * re-render, a remount or a reload never counts the same moment twice.
 */
export function track<N extends EventName>(name: N, props: EventProps<N>, options: { once?: string } = {}): PraxisAnalyticsEvent | null {
  const checked = validateEvent(name, props as Record<string, unknown>);
  if (!checked.ok) {
    if (import.meta.env?.DEV) console.warn(`[analytics] refused: ${checked.error}`);
    return null;
  }
  if (options.once) {
    const tab = session();
    const seen = readJson<string[]>(tab, ONCE_KEY) ?? [];
    const key = `${name}:${options.once}`;
    if (seen.includes(key)) return null;
    writeJson(tab, ONCE_KEY, [...seen, key].slice(-400));
  }
  const spec = EVENTS[name] as EventSpec;
  const { recommendationId, outfitId, ...rest } = checked.properties;
  const event: PraxisAnalyticsEvent = {
    eventId: newId("evt"),
    eventName: name,
    timestamp: new Date().toISOString(),
    anonymousSessionId: anonymousId(),
    properties: rest,
    applicationVersion: APP_VERSION,
  };
  const userId = currentUserId();
  if (userId) event.userId = userId;
  if (spec.journey) event.journey = spec.journey;
  if (typeof recommendationId === "string") event.recommendationId = recommendationId;
  if (typeof outfitId === "string") event.outfitId = outfitId;
  const sim = simScenario();
  if (sim) event.testMode = sim;
  for (const sink of sinks) {
    try {
      sink.send(event);
    } catch {
      // A failing sink never breaks the page.
    }
  }
  return event;
}
