/**
 * The stylist's words from a live provider. The rules engine chooses the looks; when the server has a
 * free writer switched on (Gemini, see server/providers/gemini-free.mjs), it rewrites each look's line
 * (explanation.summary) and note (rationale) for this customer's brief, in one call for all three.
 *
 * Only names and answers are sent, never a photo. Anything that is late, refused, malformed or out of
 * voice leaves the rules engine's words in place, so the looks never wait on it for long or break.
 */
import { HAS_BACKEND } from "../config";
import type { StylingRequest, StylingResponse } from "../contracts";
import { callService, buildServiceRequest } from "./envelope";
import { httpProvider, AI_ENDPOINT } from "./http";
import { DEFINITIONS, type ExplanationPayload, type ExplanationResult, type LookBrief } from "./services";

export interface LiveService {
  service: string;
  provider: string;
  version: string;
  billable: boolean;
  /** Only browsers that asked for it use it (a store feed being tested). */
  testOnly?: boolean;
  /** A paid provider whose spend the owner approved, within a budget the server enforces. */
  approved?: boolean;
}

/** How long the looks may wait for the words. */
export const WORDS_TIMEOUT_MS = 8000;

let live: Promise<LiveService[]> | null = null;

/** The services the server can answer now (GET /api/ai), asked once per tab. Nothing when it can't say. */
export function liveServices(fetcher: typeof fetch = (...a) => fetch(...a)): Promise<LiveService[]> {
  if (!live) {
    live = (async () => {
      // A preview with no server (VITE_BACKEND=none): nothing is live, and nothing is asked.
      if (!HAS_BACKEND) return [];
      try {
        const res = await fetcher(AI_ENDPOINT, { headers: { Accept: "application/json" } });
        if (!res.ok) return [];
        const body = (await res.json()) as { live?: unknown };
        return Array.isArray(body.live) ? (body.live.filter((x) => x && typeof x === "object" && typeof (x as LiveService).service === "string") as LiveService[]) : [];
      } catch {
        return [];
      }
    })();
  }
  return live;
}

export function resetLiveServices(): void {
  live = null;
}

/** The voice rules: no dashes, no talk of AI or data, "pieces" not "products", Style DNA in full. */
const BANNED = /[‐-―−]|\s-\s|\w-\w|\b(ai|a\.i\.|artificial|algorithm|model|data|analysis|products?|curated|effortless(ly)?|elevate[sd]?|must[ -]have|game[ -]changer)\b|!|(?<!style )\bdna\b/i;

/** A line that keeps the voice, tidied; null when it breaks a rule or is too short or long. */
export function voiceLine(text: unknown, max: number): string | null {
  if (typeof text !== "string") return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 12 || t.length > max || BANNED.test(t)) return null;
  return /[.?]$/.test(t) ? t : `${t}.`;
}

export function briefsOf(response: StylingResponse): LookBrief[] {
  return response.outfits.map((o) => ({
    outfitId: o.outfitId,
    role: o.role,
    title: o.title,
    pieces: o.garments.map((g) => ({ slot: g.slot, name: g.name, ...(g.source === "wardrobe" ? { owned: true } : {}) })),
  }));
}

/** The response with the provider's words in place of the rules engine's, look by look. */
export function withWords(response: StylingResponse, result: ExplanationResult | undefined): StylingResponse {
  const words = new Map((result?.looks ?? []).map((l) => [l.outfitId, l]));
  let changed = false;
  const outfits = response.outfits.map((o) => {
    const w = words.get(o.outfitId);
    const summary = voiceLine(w?.summary, 140);
    const note = voiceLine(w?.note, 180);
    if (!summary || !note) return o;
    changed = true;
    return { ...o, rationale: note, explanation: { ...o.explanation, summary, source: "model" as const } };
  });
  return changed ? { ...response, outfits } : response;
}

/**
 * Asks the live writer for the looks' words when the server has one, and returns the response with
 * them. Otherwise, or on any problem, returns the response as it was.
 */
export async function addStylistWords(response: StylingResponse, request: StylingRequest, options: { signal?: AbortSignal; fetcher?: typeof fetch } = {}): Promise<StylingResponse> {
  if (response.outfits.length === 0 || (response.status !== "completed" && response.status !== "partial")) return response;
  const writer = (await liveServices(options.fetcher)).find((s) => s.service === "styling_explanation" && !s.billable);
  if (!writer || options.signal?.aborted) return response;
  const provider = httpProvider<ExplanationPayload, ExplanationResult>("styling_explanation", AI_ENDPOINT, options.fetcher, { id: writer.provider, version: writer.version, billable: false });
  const payload: ExplanationPayload = { request, outfitId: response.outfits[0].outfitId, looks: briefsOf(response) };
  const answer = await callService(DEFINITIONS.styling_explanation, provider, buildServiceRequest("styling_explanation", payload, { anonymousSessionId: request.anonymousSessionId, userId: request.userId }), {
    signal: options.signal,
    timeoutMs: WORDS_TIMEOUT_MS,
    retries: 0,
  });
  return answer.status === "succeeded" || answer.status === "partial" ? withWords(response, answer.result) : response;
}
