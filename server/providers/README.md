# Providers

## AI service providers

`<name>.mjs` files for `server/ai.mjs` export `id`, `version`, `billable`, `SERVICES` (the services they answer) and `run(request, { signal })`. See `docs/AI-SERVICES.md`.

- `shopify-feed.mjs`: real pieces from one Shopify store for `?stock=live` tabs (`product_matching`). It reads the store's list with `server/retailers/shopify.mjs`, the same reader the catalogue import uses.
- `gemini-free.mjs`: the stylist's words (`styling_explanation`) on Gemini's free tier. Switches on when `GEMINI_API_KEY` is set; text only, never a photo.

## Try-on providers

A provider is one file here, `<name>.mjs`, chosen with `TRYON_PROVIDER=<name>` on the server.
None is active by default. `example.mjs` shows the shape and never calls anything.

```js
export const id = "my-provider";        // shown on the result, for tracing
export const version = "2026-10";       // the provider's model or API version
export const billable = true;           // true if a call costs money (needs ALLOW_BILLABLE_IMAGES=true)

/**
 * request: { requestId, outfitId, garmentIds, person: { image (data URL), width, height } }
 * Returns the GeneratedImage shape from src/core/vision.ts:
 *   { status: "ready", storageRef: "https://..." | "data:image/...", width, height, modelVersion,
 *     retention: { deletable: true, deleteAfter } }
 * or { status: "failed", error: { code, message, retryable } }.
 * Read the API key from process.env inside this file. Never log the photo.
 */
export async function tryOn(request, { signal }) { ... }
```

Garment pictures for a request come from the catalogue by `garmentIds`. Turning a provider on also
needs the page built with `VITE_TRYON_ADAPTER=http` and `VITE_ALLOW_BILLABLE_IMAGES=true`, and the
try-on consent wording (src/core/images.ts, `TRY_ON_SERVER`) reviewed before launch.
