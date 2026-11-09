/**
 * The gateway's client for the ai service (services/ai) at AI_SERVICE_URL: cut-outs and embeddings.
 * Cut-outs are slow on CPU (tens of seconds a picture, see docs/reports/week-1.md phase 4), so only the
 * batch job (server/catalogue/process.mjs) asks for them; requests never wait for one.
 */
import { aiServiceUrl } from "./health.mjs";

export const CUTOUT_TIMEOUT_MS = 300_000;
export const EMBED_TIMEOUT_MS = 30_000;

export class AiServiceError extends Error {
  constructor(message, { status = 0, retryable = true } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

async function call(fetcher, url, init, ms) {
  let res;
  try {
    res = await fetcher(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    throw new AiServiceError(e?.name === "TimeoutError" ? `the ai service took longer than ${ms / 1000} s` : "the ai service could not be reached");
  }
  if (!res.ok) {
    const detail = await res.json().then((b) => b?.detail).catch(() => null);
    // 4xx: the input is wrong and asking again won't help (a broken image); 5xx and 503: try later.
    throw new AiServiceError(`the ai service answered ${res.status}${detail ? `: ${detail}` : ""}`, { status: res.status, retryable: res.status >= 500 });
  }
  return res;
}

/** A client, or null when AI_SERVICE_URL isn't set. */
export function createAiService(url = aiServiceUrl(), fetcher = fetch) {
  if (!url) return null;
  return {
    url,
    /** The garment as a PNG with a transparent background. */
    async cutout(bytes, contentType = "image/jpeg") {
      const res = await call(fetcher, `${url}/cutout`, { method: "POST", headers: { "Content-Type": contentType }, body: bytes }, CUTOUT_TIMEOUT_MS);
      return { png: Buffer.from(await res.arrayBuffer()), model: res.headers.get("x-model"), ms: Number(res.headers.get("x-elapsed-ms")) || null };
    },
    async embedImages(images) {
      return embed(fetcher, url, { images: images.map((b) => Buffer.from(b).toString("base64")) });
    },
    async embedTexts(texts) {
      return embed(fetcher, url, { texts });
    },
  };
}

async function embed(fetcher, url, body) {
  const res = await call(fetcher, `${url}/embed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, EMBED_TIMEOUT_MS);
  const out = await res.json();
  if (!Array.isArray(out?.vectors) || out.vectors.some((v) => !Array.isArray(v) || v.length !== 768)) throw new AiServiceError("the ai service sent vectors of the wrong size", { retryable: false });
  return out;
}

/** A pgvector literal, '[0.1,0.2,...]'. */
export const toVector = (v) => `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
