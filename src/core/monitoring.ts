/**
 * Error monitoring from the page, with no outside service: an error that reaches the customer (a page
 * that fails to draw, an uncaught error, a promise nobody handled) is sent to this app's own server,
 * which writes it to its log (server/monitor.mjs). What is sent is the error's name, where it
 * happened, the path without its query, and up to five stack frames from the app's own files. Never
 * the message, which could hold something personal, and never a photo or an address.
 */
import { APP_VERSION, apiUrl, HAS_BACKEND } from "./config";
import { session, readJson, writeJson } from "./ids";

export const ERROR_ENDPOINT = apiUrl("/api/client-error");
const SENT_KEY = "praxis_errors_sent";
/** At most this many reports per tab, so one broken page cannot send a stream. */
const PER_TAB = 5;

export interface ErrorReport {
  name: string;
  where: string;
  path: string;
  release: string;
  frames: string[];
}

/** Only frames from the app's own bundle, as file:line:column, with no query and no other site. */
export function framesOf(stack: string | undefined): string[] {
  if (!stack) return [];
  const out: string[] = [];
  for (const m of stack.matchAll(/(\/(?:assets|src)\/[\w./-]+\.(?:js|ts|tsx|mjs)):(\d+):(\d+)/g)) {
    out.push(`${m[1]}:${m[2]}:${m[3]}`);
    if (out.length === 5) break;
  }
  return out;
}

export function reportFor(error: unknown, where: string, pathname: string): ErrorReport {
  const e = error as { name?: unknown; stack?: unknown } | null;
  const name = typeof e?.name === "string" && /^[\w$.]{1,60}$/.test(e.name) ? e.name : "Error";
  return { name, where: where.slice(0, 40), path: pathname.split("?")[0].slice(0, 120), release: APP_VERSION, frames: framesOf(typeof e?.stack === "string" ? e.stack : undefined) };
}

/** Sends one report, unless this tab already sent the same one or its share. Never throws. */
export function reportError(error: unknown, where: string, send: (body: string) => void = beacon): boolean {
  try {
    const report = reportFor(error, where, typeof location === "undefined" ? "/" : location.pathname);
    const tab = session();
    const sent = readJson<string[]>(tab, SENT_KEY) ?? [];
    const key = `${report.name}|${report.where}|${report.frames[0] ?? ""}`;
    if (sent.length >= PER_TAB || sent.includes(key)) return false;
    writeJson(tab, SENT_KEY, [...sent, key]);
    send(JSON.stringify(report));
    return true;
  } catch {
    return false;
  }
}

function beacon(body: string): void {
  const blob = new Blob([body], { type: "application/json" });
  if (typeof navigator !== "undefined" && navigator.sendBeacon?.(ERROR_ENDPOINT, blob)) return;
  void fetch(ERROR_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
}

/** Listens for errors nothing else caught. Called once at start. */
export function watchErrors(): void {
  // A preview with no server has nowhere to send reports (VITE_BACKEND=none).
  if (!HAS_BACKEND) return;
  window.addEventListener("error", (e) => reportError(e.error ?? { name: "ScriptError" }, "window"));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "promise"));
}
