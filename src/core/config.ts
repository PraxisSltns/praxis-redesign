/**
 * Build-time configuration. Values come from Vite environment variables (VITE_*) set in the
 * deployment, never from the page, so a visitor cannot switch an adapter or a price.
 */

declare const __APP_VERSION__: string | undefined;

/** The deployed build, stamped on every analytics event. */
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

function env(name: string): string | undefined {
  try {
    const value = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name];
    return value && value.trim() !== "" ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where this app's server is, for a build served from somewhere else (a Vite dev server, a preview host).
 * Empty (the default): the page calls its own origin, as on Railway. Set: every /api call and every
 * /api picture goes to this address instead, for example http://localhost:3000. The server must list
 * the page's origin in CORS_ORIGINS. An address only: never put a key or secret in a VITE_ variable.
 */
export const API_BASE_URL: string = (env("VITE_API_BASE_URL") ?? "").replace(/\/+$/, "");

/** A path on this app's server (/api/...) made absolute when API_BASE_URL is set; anything else unchanged. */
export function apiUrl(path: string, base: string = API_BASE_URL): string {
  return base && path.startsWith("/api/") ? `${base}${path}` : path;
}

/**
 * Whether this build has a server to talk to. A static preview with none (Vercel builds with
 * VITE_BACKEND=none) makes no /api call at all: the looks come from the rules engine, the page never
 * asks which services are live, and errors aren't reported. Setting VITE_API_BASE_URL brings the server
 * back, so a preview pointed at staging works without changing this.
 */
export const HAS_BACKEND: boolean = env("VITE_BACKEND") !== "none" || API_BASE_URL !== "";

/** Which recommendation adapter answers styling requests. Only "mock" exists today; service.ts falls back to it. */
export const RECOMMENDATION_ADAPTER: string = env("VITE_RECOMMENDATION_ADAPTER") ?? "mock";

/**
 * The one switch for image services that cost money (analysis, generation, try-on). Off unless the
 * deployment sets VITE_ALLOW_BILLABLE_IMAGES=true; vision.ts refuses billable calls while it is off.
 */
export const ALLOW_BILLABLE_IMAGES: boolean = env("VITE_ALLOW_BILLABLE_IMAGES") === "true";

/**
 * Which try-on adapter makes the picture. "mock" (the default) makes none and says so. "http" sends the
 * photo and the look to this app's own server (POST /api/tryon), which hands it to the provider set up
 * there; provider keys live only on the server. The http adapter is billable, so it also needs
 * VITE_ALLOW_BILLABLE_IMAGES=true, and the server needs its own switch (see server/tryon.mjs).
 */
export const TRYON_ADAPTER: "mock" | "http" = env("VITE_TRYON_ADAPTER") === "http" ? "http" : "mock";

/** The one subscription. Style DNA is the experience; Premium is the subscription it belongs to. */
export const PREMIUM = {
  name: "Premium",
  amount: 9,
  currency: "USD",
  period: "month",
} as const;

/** "$9 a month", from the configuration above. */
export function premiumPrice(): string {
  return `$${PREMIUM.amount} a ${PREMIUM.period}`;
}

/** "$9", for the pay button. */
export function premiumAmount(): string {
  return `$${PREMIUM.amount}`;
}

/**
 * AI services answered by a live provider instead of the mock, as a comma list of service names
 * (src/core/ai/envelope.ts ServiceName), such as "face_colour_analysis,product_matching". Empty by
 * default: every service is the free mock. A listed service posts to this app's server
 * (POST /api/ai/<service>, server/ai.mjs), which holds the provider keys; a paid one also needs
 * VITE_ALLOW_BILLABLE_IMAGES=true here and ALLOW_BILLABLE_AI=true on the server.
 */
export const AI_PROVIDERS: readonly string[] = (env("VITE_AI_PROVIDERS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
