/**
 * Find a piece: the page's side of POST /api/search (server/search.mjs). A few words or a photo of a
 * piece go to this app's own server, which embeds them with its own model and ranks the imported
 * catalogue. Nothing leaves for a third party, and the server keeps neither the words nor the photo.
 *
 * The catalogue is shown to a visitor on the same terms as in the looks (src/core/catalogue/hybrid.ts):
 * only when the server offers free product matching from the catalogue, and while that is for testing
 * only, only in a tab opened with ?stock=live. Until a retailer agrees to their pieces being shown,
 * customers don't see the screen at all.
 */
import { apiUrl, HAS_BACKEND } from "./config";
import { liveServices } from "./ai/words";
import { wantsRealStock } from "./ai/stock";
import type { Slot } from "./contracts";

export const SEARCH_ENDPOINT = "/api/search";
export const SEARCH_TIMEOUT_MS = 15_000;
/** The server's own limit is 300 characters. */
export const MAX_SEARCH_TEXT = 120;
const SLOTS: readonly Slot[] = ["top", "bottom", "shoes", "extras"];
/** A cut-out on this app's server, as the search returns it. */
const CUTOUT_PATH = /^\/api\/cutouts\/prod_[0-9a-f]{24}\/[0-9a-f]{16}\.png$/;

export interface FoundPiece {
  productId: string;
  title: string;
  brand?: string;
  retailer: string;
  slot: Slot;
  subcategory?: string;
  colour?: string;
  price: number | null;
  currency?: string;
  /** The store's own page for the piece, https only. */
  productUrl?: string;
  /** The piece's cut-out on this server. */
  cutoutUrl: string;
  sizes: string[];
}

export interface SearchAnswer {
  pieces: FoundPiece[];
  /** The kind of piece the words were read as ("blazer"), when they named one. */
  understood?: string;
  ms?: number;
}

export type SearchQuery = { text: string } | { image: string };

export class SearchError extends Error {
  constructor(
    readonly code: "unavailable" | "bad_image" | "failed" | "timeout",
    message: string,
  ) {
    super(message);
  }
}

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined);

function https(v: unknown): string | undefined {
  const s = str(v, 2000);
  if (!s) return undefined;
  try {
    return new URL(s).protocol === "https:" ? s : undefined;
  } catch {
    return undefined;
  }
}

/** One item of the server's answer, checked; null when it can't be shown. */
export function readFoundPiece(v: unknown): FoundPiece | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const productId = str(o.productId, 80);
  const title = str(o.title, 200);
  const retailer = str(o.retailer, 120);
  const cutout = str(o.cutoutUrl, 200);
  if (!productId || !title || !retailer || !cutout || !CUTOUT_PATH.test(cutout) || !SLOTS.includes(o.slot as Slot)) return null;
  const price = typeof o.price === "number" && Number.isFinite(o.price) && o.price >= 0 ? o.price : null;
  return {
    productId,
    title,
    retailer,
    slot: o.slot as Slot,
    cutoutUrl: apiUrl(cutout),
    price,
    sizes: Array.isArray(o.sizes) ? o.sizes.filter((s): s is string => typeof s === "string" && s.length <= 20).slice(0, 30) : [],
    ...(str(o.brand, 120) ? { brand: str(o.brand, 120) } : {}),
    ...(str(o.subcategory, 60) ? { subcategory: str(o.subcategory, 60) } : {}),
    ...(str(o.colour, 30) ? { colour: str(o.colour, 30) } : {}),
    ...(str(o.currency, 3) ? { currency: str(o.currency, 3) } : {}),
    ...(https(o.productUrl) ? { productUrl: https(o.productUrl) } : {}),
  };
}

/** "$98", or "" when the piece has no price. */
export function priceText(p: Pick<FoundPiece, "price" | "currency">): string {
  if (p.price === null) return "";
  const amount = Number.isInteger(p.price) ? String(p.price) : p.price.toFixed(2);
  return !p.currency || p.currency === "USD" ? `$${amount}` : `${amount} ${p.currency}`;
}

/**
 * Whether this visitor may search the catalogue, by the same rule as catalogue pieces in the looks:
 * "everyone" once the catalogue is open to customers, "test" in a tab opened with ?stock=live while it
 * is for testing only, and null otherwise (no server, no catalogue, or a customer's tab during testing).
 */
export async function searchAvailable(fetcher?: typeof fetch, wanted: () => boolean = wantsRealStock): Promise<"everyone" | "test" | null> {
  if (!HAS_BACKEND) return null;
  try {
    const live = await liveServices(fetcher);
    const matching = live.find((s) => s.service === "product_matching" && s.provider === "catalogue" && !s.billable);
    if (!matching) return null;
    if (!matching.testOnly) return "everyone";
    return wanted() ? "test" : null;
  } catch {
    return null;
  }
}

/** Runs one search. Throws a SearchError the screen can put in words. */
export async function searchCatalogue(query: SearchQuery, options: { signal?: AbortSignal; fetcher?: typeof fetch; limit?: number } = {}): Promise<SearchAnswer> {
  const fetcher = options.fetcher ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const body = "text" in query ? { text: query.text.trim().slice(0, MAX_SEARCH_TEXT) } : { image: query.image };
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), SEARCH_TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  options.signal?.addEventListener("abort", onAbort);
  try {
    let res: Response;
    try {
      res = await fetcher(apiUrl(SEARCH_ENDPOINT), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, limit: options.limit ?? 24 }),
        signal: timeout.signal,
        credentials: "same-origin",
      });
    } catch {
      if (options.signal?.aborted) throw new SearchError("failed", "The search was stopped.");
      throw timeout.signal.aborted ? new SearchError("timeout", "The search took too long. Try again.") : new SearchError("unavailable", "Search isn't reachable just now. Try again in a moment.");
    }
    if (res.status === 422) throw new SearchError("bad_image", "I couldn't read that photo. Try another one, of a single piece.");
    if (res.status === 503) throw new SearchError("unavailable", "Search isn't set up here yet.");
    if (!res.ok) throw new SearchError("failed", "The search couldn't be run just now. Try again.");
    const json = (await res.json().catch(() => null)) as { items?: unknown[]; query?: { kind?: { subcategory?: unknown } }; ms?: { total?: unknown } } | null;
    const pieces = (Array.isArray(json?.items) ? json.items : []).map(readFoundPiece).filter((p): p is FoundPiece => p !== null);
    const understood = str(json?.query?.kind?.subcategory, 60);
    return { pieces, ...(understood ? { understood: understood.replace(/-/g, " ") } : {}), ...(typeof json?.ms?.total === "number" ? { ms: json.ms.total } : {}) };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
