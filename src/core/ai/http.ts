/**
 * The live provider for any AI service: it posts the request envelope to this app's own server
 * (POST /api/ai/<service>, server/ai.mjs), never to a provider directly, so no key is ever in the page.
 * The server answers with a ProviderAnswer; the envelope checks the result before a screen sees it.
 * Marked billable unless the server says its provider is free, so a paid one never runs while paid
 * calls are switched off.
 */
import { apiUrl } from "../config";
import type { ProviderAnswer, ServiceName, ServiceProvider } from "./envelope";

export const AI_ENDPOINT = apiUrl("/api/ai");

const STATUSES = new Set(["succeeded", "partial", "empty", "failed", "disabled"]);

/** Reads the server's answer. Anything that does not fit becomes a failure, never a crash. */
export function readProviderAnswer<R>(raw: unknown, httpStatus: number): ProviderAnswer<R> {
  if (raw && typeof raw === "object" && STATUSES.has((raw as { status?: string }).status ?? "")) {
    const a = raw as ProviderAnswer<R>;
    const e = a.error;
    return {
      status: a.status,
      result: a.result,
      error: e && typeof e === "object" ? { code: e.code, message: String(e.message), retryable: Boolean(e.retryable) } : undefined,
      metadata: a.metadata && typeof a.metadata === "object" ? a.metadata : undefined,
    };
  }
  return { status: "failed", error: { code: "provider_error", message: `The server answered ${httpStatus} with nothing readable.`, retryable: httpStatus >= 500 } };
}

export function httpProvider<P, R>(service: ServiceName, endpoint = AI_ENDPOINT, fetcher: typeof fetch = (...a) => fetch(...a), info: { id?: string; version?: string; billable?: boolean } = {}): ServiceProvider<P, R> {
  return {
    id: info.id ?? `server-${service}`,
    version: info.version ?? "1.0.0",
    mode: "live",
    processing: "server",
    // Paid unless the server says this provider is free (GET /api/ai).
    billable: info.billable ?? true,
    async run(request, { signal }) {
      const res = await fetcher(`${endpoint}/${service}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify(request),
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        // Read as unreadable below.
      }
      return readProviderAnswer<R>(body, res.status);
    },
  };
}
