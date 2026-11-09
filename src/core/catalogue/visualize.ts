/**
 * Outfit visualization: one picture of one model wearing the whole composed look. The styling engine
 * and the composer decide the pieces; the visualization renders exactly that spec and may never swap
 * a piece. Provider independent: the page talks to an OutfitVisualizationProvider, and only the
 * provider knows its model's format.
 *
 * Today the provider is the deterministic mock: it answers with the look's library photograph, marked
 * "mock" and representative (illustrative), and makes nothing. A production image model plugs in on
 * the server as the outfit_visualization provider (docs/CATALOGUE.md); the page then posts the same
 * spec there. Paid calls need both switches (VITE_ALLOW_BILLABLE_IMAGES here, ALLOW_BILLABLE_AI on the
 * server), so nothing is charged by accident.
 *
 * Every picture is tied to its exact composition by a cache key built from the pieces (ids, the store's
 * product and variant ids) and the model setup. The same look is never made twice in a tab, and a
 * picture is never reused for other pieces. Each tab also has a ceiling on requests, and a ledger of
 * calls, cache hits, failures and estimated cost.
 */
import type { Garment, GarmentAttributes, Layer, OutfitRecommendation, Slot, StylingResponse, Visualization, VisualizationCheck } from "../contracts";
import { callService, buildServiceRequest } from "../ai/envelope";
import { httpProvider } from "../ai/http";
import { DEFINITIONS, type VisualizationPayload, type VisualizationResult } from "../ai/services";
import { liveServices } from "../ai/words";
import { ALLOW_BILLABLE_IMAGES, apiUrl } from "../config";

/** The one model every look is shown on, so the three looks compare like for like. */
export interface ModelSetup {
  modelId: string;
  /** Which picture of the model the provider keeps his face, build and studio from; a new one changes every key. */
  baseImage: string;
  pose: string;
  framing: string;
  lighting: string;
  background: string;
}
export const PRAXIS_MODEL: ModelSetup = {
  modelId: "praxis-model-01",
  baseImage: "praxis-model-01@1",
  pose: "standing straight, facing the camera, arms relaxed at his sides",
  framing: "full body, head to shoes, with room above the head and below the shoes",
  lighting: "soft warm studio light",
  background: "plain warm beige studio wall and floor",
};

/** How the picture is made: its shape and size. Part of the key, so a change never reuses old pictures. */
export interface RenderSetup {
  aspectRatio: "3:4";
  imageSize: "1K";
}
export const RENDER: RenderSetup = { aspectRatio: "3:4", imageSize: "1K" };

/** The spec's own shape; a change to it changes every key. */
export const SPEC_VERSION = 3;

/**
 * One piece as the picture sees it: what it is, in words and attributes, and where its picture is.
 * A store piece sends its product photo (https, the store's own); a reference piece sends only its id,
 * and the server reads the photograph and crop from its own catalogue; the customer's own piece goes by
 * words only, since its photo never leaves the device without consent for this use.
 */
export interface SpecGarment {
  garmentId: string;
  source: "shopify" | "reference" | "wardrobe";
  slot: Slot;
  layer?: Layer;
  name: string;
  attributes?: GarmentAttributes;
  description?: string;
  /** Store pieces: the store's product photo (https). */
  imageUrl?: string;
  retailerProductId?: string;
  retailerVariantId?: string;
  /** Reference pieces: the catalogue id (ref_<outfit>_<part>). */
  referenceId?: string;
}

/** The validated composition a picture is made of. */
export interface OutfitVisualizationSpec {
  version: number;
  outfitId: string;
  garments: SpecGarment[];
  model: ModelSetup;
  render: RenderSetup;
  cacheKey: string;
}

export interface VisualizationOutcome {
  status: "ready" | "mock" | "processing" | "failed";
  imageUrl?: string;
  /** verified: checked against the pieces. illustrative: a styling picture, details may differ. */
  fidelity: "verified" | "illustrative" | "unknown";
  provider: string;
  cacheKey: string;
  /** Estimated cost of this call in US dollars; 0 for the mock and for cache hits. */
  costUsd: number;
  error?: string;
  /** Whether trying again may work (a time out, a busy provider), as opposed to a refusal. */
  retryable?: boolean;
  /** What the picture's checks found (generated pictures). */
  checks?: VisualizationCheck[];
}

export interface OutfitVisualizationProvider {
  readonly id: string;
  readonly version: string;
  readonly billable: boolean;
  visualize(spec: OutfitVisualizationSpec, options?: { signal?: AbortSignal }): Promise<VisualizationOutcome>;
}

/* ------------------------------------------------------------ the spec */

/** FNV-1a, enough to name a composition; not for secrets. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Worn from the outside in: outer layer, base, bottom, shoes, then extras. */
const WEAR_ORDER = (g: SpecGarment) => (g.slot === "top" ? (g.layer === "outer" ? 0 : 1) : g.slot === "bottom" ? 2 : g.slot === "shoes" ? 3 : 4);

function specGarment(g: Garment): SpecGarment {
  const base = { garmentId: g.garmentId, slot: g.slot, ...(g.layer ? { layer: g.layer } : {}), name: g.name, ...(g.attributes ? { attributes: g.attributes } : {}) };
  if (g.source === "retail") {
    const photo = g.product.imageUrl && /^https:\/\//i.test(g.product.imageUrl) ? { imageUrl: g.product.imageUrl } : {};
    return { ...base, source: "shopify", ...photo, retailerProductId: g.product.productId, ...(g.retailerVariantId ? { retailerVariantId: g.retailerVariantId } : {}) };
  }
  if (g.source === "reference") return { ...base, source: "reference", referenceId: g.referenceId, ...(g.description ? { description: g.description } : {}) };
  return { ...base, source: "wardrobe" };
}

/**
 * The spec for a composed look, taken from the look's own garments, so the picture always matches the
 * pieces listed beside it. The key names everything the picture depends on: each piece (ids, variant,
 * photo address, attributes), the model and his base picture, the render settings, the spec's shape
 * and the provider's version. Change any of them and the old picture is never reused.
 */
export function visualizationSpec(o: OutfitRecommendation, provider: { id: string; version: string }, model: ModelSetup = PRAXIS_MODEL, render: RenderSetup = RENDER): OutfitVisualizationSpec {
  const garments = o.garments.map(specGarment).sort((a, b) => WEAR_ORDER(a) - WEAR_ORDER(b));
  const identity = garments.map((g) =>
    JSON.stringify([g.slot, g.layer ?? "", g.source, g.source === "wardrobe" ? g.name : g.garmentId.replace(`${o.outfitId}_`, ""), g.referenceId ?? "", g.retailerProductId ?? "", g.retailerVariantId ?? "", g.imageUrl ?? "", g.attributes ?? {}]),
  );
  const cacheKey = `vis_${hash(JSON.stringify({ v: SPEC_VERSION, look: o.outfitId, identity, model, render, provider: `${provider.id}@${provider.version}` }))}`;
  return { version: SPEC_VERSION, outfitId: o.outfitId, garments, model, render, cacheKey };
}

/* ------------------------------------------------------------ providers */

/**
 * The deterministic mock: the look's library photograph, marked mock and illustrative. It answers
 * the same for the same spec, and can be made to wait or fail for tests.
 */
export function mockVisualizationProvider(options: { delayMs?: number; fail?: (spec: OutfitVisualizationSpec, attempt: number) => boolean } = {}): OutfitVisualizationProvider {
  const attempts = new Map<string, number>();
  return {
    id: "mock-visualization",
    version: "2.0.0",
    billable: false,
    async visualize(spec, { signal } = {}) {
      const attempt = (attempts.get(spec.cacheKey) ?? 0) + 1;
      attempts.set(spec.cacheKey, attempt);
      if (options.delayMs) await new Promise<void>((done, stop) => {
        const t = setTimeout(done, options.delayMs);
        signal?.addEventListener("abort", () => (clearTimeout(t), stop(new DOMException("aborted", "AbortError"))));
      });
      if (options.fail?.(spec, attempt)) return { status: "failed", fidelity: "unknown", provider: "mock-visualization", cacheKey: spec.cacheKey, costUsd: 0, error: "Simulated failure" };
      const library = /^[a-z]+_(safest|sharper|relaxed)_\d+$/.test(spec.outfitId) ? `/images/${spec.outfitId}.jpg` : undefined;
      if (!library) return { status: "failed", fidelity: "unknown", provider: "mock-visualization", cacheKey: spec.cacheKey, costUsd: 0, error: "No library photograph for this look" };
      return { status: "mock", imageUrl: library, fidelity: "illustrative", provider: "mock-visualization", cacheKey: spec.cacheKey, costUsd: 0 };
    },
  };
}

/** How long one picture may take: the server makes it, checks it, and may make it once more. */
export const VISUALIZATION_TIMEOUT_MS = 180_000;

/** The server's outfit_visualization provider, through POST /api/ai (server/ai.mjs). */
export function serverVisualizationProvider(info: { provider: string; version: string; billable: boolean; approved?: boolean }, fetcher?: typeof fetch, who: { anonymousSessionId: string; userId?: string } = { anonymousSessionId: "anonymous" }): OutfitVisualizationProvider & { approved?: boolean } {
  const http = httpProvider<VisualizationPayload, VisualizationResult>("outfit_visualization", undefined, fetcher, { id: info.provider, version: info.version, billable: info.billable });
  return {
    id: info.provider,
    version: info.version,
    billable: info.billable,
    approved: info.approved,
    async visualize(spec, { signal } = {}) {
      const payload: VisualizationPayload = { outfitId: spec.outfitId, garmentIds: spec.garments.map((g) => g.garmentId), spec };
      const answer = await callService(DEFINITIONS.outfit_visualization, http, buildServiceRequest("outfit_visualization", payload, who), { signal, retries: 0, timeoutMs: VISUALIZATION_TIMEOUT_MS, ...(info.approved ? { allowBillable: true } : {}) });
      const r = answer.result;
      if ((answer.status === "succeeded" || answer.status === "partial") && r && r.outfitId === spec.outfitId) {
        return { status: r.generated ? "ready" : "mock", imageUrl: r.imageUrl ? apiUrl(r.imageUrl) : r.imageUrl, fidelity: r.fidelity === "exact" ? "verified" : "illustrative", provider: info.provider, cacheKey: spec.cacheKey, costUsd: Number((answer.metadata as { costUsd?: unknown } | undefined)?.costUsd) || 0, ...(r.checks ? { checks: r.checks } : {}) };
      }
      return { status: "failed", fidelity: "unknown", provider: info.provider, cacheKey: spec.cacheKey, costUsd: Number((answer.metadata as { costUsd?: unknown } | undefined)?.costUsd) || 0, error: answer.error?.message ?? answer.status, retryable: answer.error?.retryable ?? false };
    },
  };
}

/** The provider this tab uses: the server's when it has one that may run here, else the mock. */
export async function visualizationProviderInUse(who: { anonymousSessionId: string; userId?: string }, fetcher?: typeof fetch): Promise<OutfitVisualizationProvider> {
  const live = (await liveServices(fetcher)).find((s) => s.service === "outfit_visualization");
  // A paid provider runs when this build allows paid pictures, or when the server says its spend is
  // approved and within budget (server/visuals.mjs); the server refuses past the budget either way.
  if (live && (!live.billable || ALLOW_BILLABLE_IMAGES || live.approved)) return serverVisualizationProvider(live, fetcher, who);
  return mockVisualizationProvider();
}

/* ------------------------------------------------------------ cache and ledger */

/** The most picture requests one tab may make. Cache hits don't count. */
export const MAX_VISUALIZATIONS_PER_TAB = 24;
const CACHE_KEY = "praxis_visual_cache";
const LEDGER_KEY = "praxis_visual_ledger";

export interface VisualizationLedger {
  requests: number;
  cacheHits: number;
  failures: number;
  refused: number;
  costUsd: number;
}

const session = (): Storage | undefined => {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : undefined;
  } catch {
    return undefined;
  }
};
const read = <T>(key: string, fallback: T, store = session()): T => {
  try {
    return JSON.parse(store?.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown, store = session()) => {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    /* a full or blocked store only costs the cache */
  }
};

export function visualizationLedger(store = session()): VisualizationLedger {
  return read(LEDGER_KEY, { requests: 0, cacheHits: 0, failures: 0, refused: 0, costUsd: 0 }, store);
}

/** Forget this tab's pictures and ledger (tests, and the customer's data page). */
export function clearVisualizations(store = session()): void {
  try {
    store?.removeItem(CACHE_KEY);
    store?.removeItem(LEDGER_KEY);
  } catch {
    /* nothing kept */
  }
}

/**
 * A picture for the spec: from this tab's cache when the very same composition was shown before,
 * otherwise from the provider (one retry on failure), within the tab's ceiling and the billing switch.
 */
export async function visualize(spec: OutfitVisualizationSpec, provider: OutfitVisualizationProvider & { approved?: boolean }, options: { signal?: AbortSignal; store?: Storage; allowBillable?: boolean; limit?: number } = {}): Promise<VisualizationOutcome> {
  const store = options.store ?? session();
  const cache = read<Record<string, VisualizationOutcome>>(CACHE_KEY, {}, store);
  const ledger = visualizationLedger(store);
  const hit = cache[spec.cacheKey];
  if (hit && hit.status !== "failed") {
    write(LEDGER_KEY, { ...ledger, cacheHits: ledger.cacheHits + 1 }, store);
    return { ...hit, costUsd: 0 };
  }
  const refuse = (error: string): VisualizationOutcome => {
    write(LEDGER_KEY, { ...ledger, refused: ledger.refused + 1 }, store);
    return { status: "failed", fidelity: "unknown", provider: provider.id, cacheKey: spec.cacheKey, costUsd: 0, error };
  };
  if (provider.billable && !(options.allowBillable ?? (ALLOW_BILLABLE_IMAGES || provider.approved))) return refuse("Paid pictures are switched off.");
  if (ledger.requests >= (options.limit ?? MAX_VISUALIZATIONS_PER_TAB)) return refuse("Too many pictures asked for in this tab.");

  let out: VisualizationOutcome = { status: "failed", fidelity: "unknown", provider: provider.id, cacheKey: spec.cacheKey, costUsd: 0 };
  let requests = ledger.requests;
  let cost = ledger.costUsd;
  // A paid provider retries on the server, inside its budget; asking twice from here would pay twice.
  const tries = provider.billable ? 1 : 2;
  for (let attempt = 1; attempt <= tries && !options.signal?.aborted; attempt += 1) {
    requests += 1;
    try {
      out = await provider.visualize(spec, { signal: options.signal });
    } catch (e) {
      out = { status: "failed", fidelity: "unknown", provider: provider.id, cacheKey: spec.cacheKey, costUsd: 0, error: String((e as Error)?.message ?? e) };
    }
    cost += out.costUsd;
    // A picture for another composition is refused outright.
    if (out.cacheKey !== spec.cacheKey) out = { status: "failed", fidelity: "unknown", provider: provider.id, cacheKey: spec.cacheKey, costUsd: 0, error: "The picture was made for other pieces." };
    if (out.status !== "failed") break;
  }
  write(LEDGER_KEY, { ...ledger, requests, costUsd: Math.round(cost * 10000) / 10000, failures: ledger.failures + (out.status === "failed" ? 1 : 0) }, store);
  if (out.status !== "failed") write(CACHE_KEY, { ...cache, [spec.cacheKey]: out }, store);
  return out;
}

/** The look's picture from an outcome. A failure keeps the look's own photo, marked representative. */
export function withVisualization(o: OutfitRecommendation, out: VisualizationOutcome): OutfitRecommendation {
  if (out.status === "failed" || !out.imageUrl) return { ...o, visualization: { ...o.visualization, fidelity: "representative", cacheKey: out.cacheKey } };
  const vis: Visualization = {
    imageId: `img_${out.cacheKey}`,
    outfitId: o.outfitId,
    kind: "styled_visualization",
    url: out.imageUrl,
    provider: out.provider,
    fidelity: out.fidelity === "verified" ? "exact" : "representative",
    sourceGarmentIds: o.garments.map((g) => g.garmentId),
    status: out.status === "mock" ? "mock" : out.status === "processing" ? "processing" : "ready",
    cacheKey: out.cacheKey,
    ...(out.checks ? { checks: out.checks } : {}),
    ...(o.visualization.width && o.visualization.url === out.imageUrl ? { width: o.visualization.width, height: o.visualization.height } : {}),
  };
  return { ...o, visualization: vis };
}

/** Pictures for every look of a response, side by side. */
export async function visualizeLooks(response: StylingResponse, provider: OutfitVisualizationProvider, options: { signal?: AbortSignal; store?: Storage; allowBillable?: boolean } = {}): Promise<StylingResponse> {
  const outfits = await Promise.all(
    response.outfits.map(async (o) => withVisualization(o, await visualize(visualizationSpec(o, provider), provider, options))),
  );
  return { ...response, outfits };
}
