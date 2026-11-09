/** A build served away from the server: /api addresses follow VITE_API_BASE_URL, and the server's CORS list decides who may call. */
import { describe, expect, it } from "vitest";
import { apiUrl, API_BASE_URL, HAS_BACKEND } from "../config";
import { AI_ENDPOINT } from "../ai/http";
import { TRYON_ENDPOINT } from "../adapters/tryonHttp";
import { ERROR_ENDPOINT } from "../monitoring";
// @ts-expect-error plain JavaScript module
import { allowedOrigins, applyCors } from "../../../server/cors.mjs";

function fakeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    status: 0,
    ended: false,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    writeHead(s: number) {
      this.status = s;
    },
    end() {
      this.ended = true;
    },
  };
}

describe("the server's address in the page", () => {
  it("stays on the page's own origin when no base is set (the default build)", () => {
    expect(API_BASE_URL).toBe("");
    expect(AI_ENDPOINT).toBe("/api/ai");
    expect(TRYON_ENDPOINT).toBe("/api/tryon");
    expect(ERROR_ENDPOINT).toBe("/api/client-error");
    expect(apiUrl("/api/visuals/img_0123456789abcdef01234567.jpg")).toBe("/api/visuals/img_0123456789abcdef01234567.jpg");
  });

  it("has a server unless the build says VITE_BACKEND=none", () => {
    expect(HAS_BACKEND).toBe(true);
  });

  it("puts the base in front of /api paths only", () => {
    expect(apiUrl("/api/ai", "http://localhost:3000")).toBe("http://localhost:3000/api/ai");
    expect(apiUrl("/api/visuals/img_1.jpg", "https://gw.example")).toBe("https://gw.example/api/visuals/img_1.jpg");
    expect(apiUrl("/images/look.jpg", "http://localhost:3000")).toBe("/images/look.jpg");
    expect(apiUrl("https://cdn.shopify.com/a.jpg", "http://localhost:3000")).toBe("https://cdn.shopify.com/a.jpg");
  });
});

describe("CORS on the server", () => {
  const origins = allowedOrigins({ CORS_ORIGINS: " http://localhost:5173/ , https://preview.example " });

  it("reads the allowed origins exactly, without trailing slashes", () => {
    expect(origins).toEqual(["http://localhost:5173", "https://preview.example"]);
    expect(allowedOrigins({})).toEqual([]);
  });

  it("answers a preflight from an allowed origin", () => {
    const res = fakeRes();
    expect(applyCors({ method: "OPTIONS", headers: { origin: "http://localhost:5173" } }, res, origins)).toBe(true);
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-allow-headers"]).toBe("Content-Type");
  });

  it("refuses a preflight from any other origin, with no CORS headers", () => {
    const res = fakeRes();
    expect(applyCors({ method: "OPTIONS", headers: { origin: "https://evil.example" } }, res, origins)).toBe(true);
    expect(res.status).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("lets an ordinary call carry on, marked for an allowed origin only", () => {
    const ok = fakeRes();
    expect(applyCors({ method: "POST", headers: { origin: "https://preview.example" } }, ok, origins)).toBe(false);
    expect(ok.headers["access-control-allow-origin"]).toBe("https://preview.example");
    const other = fakeRes();
    expect(applyCors({ method: "GET", headers: {} }, other, origins)).toBe(false);
    expect(other.headers).toEqual({});
  });
});
