/**
 * The page's side of sign-in and the account (server/auth/routes.mjs), used when AUTH_MODE is
 * "magic-link". Every call sends the session cookie (credentials: "include", so a page on another
 * origin set by VITE_API_BASE_URL works too) and none throws: each answers { ok, ... }.
 */
import { ACCOUNT_CONSENTS } from "../shared/consents.mjs";
import type { SavedLook } from "../shared/store";
import { apiUrl } from "./config";

export interface AccountUser {
  id: string;
  email: string;
  displayName: string | null;
}

type Answer<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

/** Browsers finish a keepalive request after the page moves on, for bodies up to 64 KB. */
const KEEPALIVE_MAX = 60_000;

async function call<T>(path: string, init: RequestInit = {}): Promise<Answer<T>> {
  try {
    // A write is often followed at once by a change of page (sign-in returning, Remove going back to
    // Looks), which would cancel it. Small ones survive that; anything lost is sent again by the next sync.
    const keepalive = typeof init.body === "string" && init.body.length <= KEEPALIVE_MAX;
    const res = await fetch(apiUrl(path), {
      ...init,
      keepalive,
      credentials: "include",
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Accept: "application/json" },
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { ok: true, ...body } : { ok: false, status: res.status, error: body.error ?? "Something went wrong. Try again." };
  } catch {
    return { ok: false, status: 0, error: "I couldn't reach Praxis. Check your connection and try again." };
  }
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

/** The consents the sign-in form asks for, at their current versions (src/shared/consents.mjs). */
export const accountConsents = () => ACCOUNT_CONSENTS.map(({ category, version }) => ({ category, version }));

export const startSignIn = (email: string, anonymousSessionId: string) => post<{ sent: true }>("/api/auth/start", { email, anonymousSessionId, consents: accountConsents() });
export const verifySignIn = (token: string) => post<{ user: AccountUser; isNew: boolean; anonymousSessionId: string }>("/api/auth/verify", { token });
export const signOutAccount = () => post<{ signedOut: true }>("/api/auth/sign-out", {});
export const claimGuestLooks = (anonymousSessionId: string, looks: SavedLook[]) => post<{ moved: number; duplicates: number; rejected: number; already: boolean }>("/api/account/claim", { anonymousSessionId, looks });
export interface AccountConsent {
  category: string;
  version: string;
  grantedAt: string;
  withdrawnAt: string | null;
}
export const listAccountConsents = () => call<{ consents: AccountConsent[] }>("/api/account/consents");
export const withdrawAccountConsents = () => post<{ withdrawn: string[]; signedOut: number }>("/api/account/consents/withdraw", {});
export const accountLooks = () => call<{ looks: SavedLook[] }>("/api/looks");
export const removeAccountLook = (dedupeKey: string) => call<{ removed: boolean }>("/api/looks", { method: "DELETE", body: JSON.stringify({ dedupeKey }) });
/** The server sends at most this many looks; a list this long may be cut short. */
export const ACCOUNT_LOOKS_PAGE = 500;
export const saveAccountLook = (anonymousSessionId: string, look: SavedLook) => post<{ saved: boolean; duplicate: boolean; id: string }>("/api/looks", { anonymousSessionId, look });
