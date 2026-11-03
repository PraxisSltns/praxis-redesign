/**
 * The try-on adapter for a real engine. It sends the look and the photo to this app's own server
 * (POST /api/tryon, server/tryon.mjs), never to a provider directly, so no provider key is ever in the
 * page. The server answers in the same GeneratedImage shape the mock uses, checked here before the
 * screen sees it. Billable: it only runs when the deployment allows paid image calls, and the server
 * has its own switch as well.
 */
import { apiUrl } from "../config";
import { newId } from "../ids";
import type { GeneratedImage, TryOnAdapter } from "../vision";

export const TRYON_ENDPOINT = apiUrl("/api/tryon");

const STATUSES = new Set(["ready", "pending", "failed", "disabled"]);

/** Checks what the server sent back. Anything that does not fit becomes a failed result, never a crash. */
export function readGeneratedImage(raw: unknown, fallback: { outfitId: string; garmentIds: string[] }): GeneratedImage {
  const failed = (code: string, message: string): GeneratedImage => ({
    imageId: newId("img"),
    outfitId: fallback.outfitId,
    kind: "try_on",
    sourceGarmentIds: fallback.garmentIds,
    provider: "unknown",
    modelVersion: "unknown",
    status: "failed",
    error: { code, message, retryable: true },
    createdAt: new Date().toISOString(),
    retention: { deletable: true },
  });
  if (!raw || typeof raw !== "object") return failed("bad_response", "The try-on service sent something unreadable.");
  const r = raw as Partial<GeneratedImage>;
  if (typeof r.status !== "string" || !STATUSES.has(r.status)) return failed("bad_response", "The try-on service sent an unknown status.");
  if (r.outfitId !== fallback.outfitId) return failed("wrong_outfit", "The try-on service answered for a different look.");
  if (r.status === "ready" && (typeof r.storageRef !== "string" || !/^(https:|data:image\/)/.test(r.storageRef))) return failed("bad_response", "The try-on service sent no picture.");
  return {
    imageId: typeof r.imageId === "string" ? r.imageId : newId("img"),
    outfitId: r.outfitId,
    kind: "try_on",
    sourceGarmentIds: Array.isArray(r.sourceGarmentIds) ? r.sourceGarmentIds.map(String) : fallback.garmentIds,
    provider: typeof r.provider === "string" ? r.provider : "unknown",
    modelVersion: typeof r.modelVersion === "string" ? r.modelVersion : "unknown",
    status: r.status,
    error: r.error && typeof r.error === "object" ? { code: String(r.error.code), message: String(r.error.message), retryable: Boolean(r.error.retryable) } : undefined,
    width: typeof r.width === "number" ? r.width : undefined,
    height: typeof r.height === "number" ? r.height : undefined,
    storageRef: r.storageRef,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
    retention: r.retention && typeof r.retention === "object" ? { deletable: Boolean(r.retention.deletable), deleteAfter: r.retention.deleteAfter } : { deletable: true },
  };
}

export function createHttpTryOn(endpoint = TRYON_ENDPOINT, fetcher: typeof fetch = (...a) => fetch(...a)): TryOnAdapter {
  return {
    id: "http-try-on",
    version: "1.0.0",
    billable: true,
    async tryOn(input, options) {
      const res = await fetcher(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options?.signal,
        body: JSON.stringify({
          requestId: input.requestId ?? newId("tryon"),
          outfitId: input.outfitId,
          garmentIds: input.garmentIds,
          person: { image: input.person.ref, width: input.person.width, height: input.person.height, consentVersion: input.person.consentVersion },
        }),
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        // Read as unreadable below.
      }
      if (!res.ok && !(body && typeof body === "object" && "status" in body)) {
        return readGeneratedImage({ status: "failed", outfitId: input.outfitId, error: { code: `http_${res.status}`, message: "The try-on service did not answer.", retryable: res.status >= 500 } }, input);
      }
      return readGeneratedImage(body, input);
    },
  };
}

export const httpTryOn = createHttpTryOn();
