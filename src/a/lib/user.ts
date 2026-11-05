/**
 * The account preview. Sign-in and Premium are persisted in localStorage;
 * no network, no real payment or identity provider. Premium belongs to an account, not to the
 * device: signing out and in as someone else never carries it over.
 */
import { useCallback, useState } from "react";
import { userIdFor } from "../../core/identity";
import { local, readJson, writeJson } from "../../core/ids";

export interface LabUser {
  /** Stable account id, used to own saved looks and feedback. */
  id: string;
  name: string;
  email: string;
  premium: boolean;
}

/**
 * What a gate can stand in front of. Save is open to everyone; signin is the plain sign-in, as from
 * the bar or the offer to sync after saving.
 */
export type GateKind = "tryon" | "dna" | "signin";
/** The intro explains a Premium feature before anything is asked of the customer. */
export type GateStep = "intro" | "signin" | "premium";

const KEY = "praxis_lab_a_user";
const PREMIUM_KEY = "praxis_lab_a_premium";

/**
 * The stand-in Apple and Google sign-ins have no real identity behind them, so each gets its own
 * fixed address on this device: they are two different accounts, never one shared one.
 */
export const PROVIDER_ADDRESS = { apple: "apple-account@praxis.app", google: "google-account@praxis.app" } as const;
const PROVIDER_NAME: Record<string, string> = { [PROVIDER_ADDRESS.apple]: "Apple account", [PROVIDER_ADDRESS.google]: "Google account" };

/** A display name from an address: tarek.hassoun@... becomes Tarek. */
export function nameFrom(email: string): string {
  const known = PROVIDER_NAME[email.toLowerCase()];
  if (known) return known;
  const first = email.split("@")[0].split(/[._+\-\d]/).find(Boolean) ?? "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : "You";
}

/** Whether a typed address is complete enough to sign in with. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function premiumFor(id: string): boolean {
  return readJson<Record<string, boolean>>(local(), PREMIUM_KEY)?.[id] === true;
}

function setPremium(id: string): boolean {
  const all = readJson<Record<string, boolean>>(local(), PREMIUM_KEY) ?? {};
  return writeJson(local(), PREMIUM_KEY, { ...all, [id]: true });
}

function read(): LabUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LabUser> & { plus?: boolean };
    if (typeof parsed.name !== "string" || typeof parsed.email !== "string") return null;
    const id = typeof parsed.id === "string" ? parsed.id : userIdFor(parsed.email);
    // Earlier builds kept Premium (once called Plus) on the device record; it moves to the account.
    if (parsed.premium === true || parsed.plus === true) setPremium(id);
    return { id, name: parsed.name, email: parsed.email, premium: premiumFor(id) };
  } catch {
    return null;
  }
}

function write(user: LabUser | null): void {
  try {
    if (user) localStorage.setItem(KEY, JSON.stringify(user));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable; the session still works in memory.
  }
}

/** Which steps a gated action still needs for this user. The intro shows to anyone without Premium. */
export function stepsFor(kind: GateKind, user: LabUser | null, options: { hasDna?: boolean } = {}): GateStep[] {
  const steps: GateStep[] = [];
  const premiumFeature = kind === "tryon" || kind === "dna";
  if (premiumFeature && !user?.premium && !(kind === "dna" && options.hasDna)) steps.push("intro");
  if (!user) steps.push("signin");
  if (premiumFeature && !user?.premium) steps.push("premium");
  return steps;
}

export function useUser() {
  const [user, setUser] = useState<LabUser | null>(() => read());

  /** Signs in with an address (the email form, or a provider's stand-in address); with a real sign-in, as the server's account id. */
  const signIn = useCallback((email: string, accountId?: string): LabUser => {
    const address = email.trim().toLowerCase();
    const id = accountId ?? userIdFor(address);
    const next: LabUser = { id, name: nameFrom(address), email: address, premium: premiumFor(id) };
    write(next);
    setUser(next);
    return next;
  }, []);

  const signOut = useCallback(() => {
    write(null);
    setUser(null);
  }, []);

  /** Premium for the signed-in account. Without an account there is nothing to give it to. */
  const grantPremium = useCallback(() => {
    const prev = read();
    if (!prev) return;
    setPremium(prev.id);
    const next: LabUser = { ...prev, premium: true };
    write(next);
    setUser(next);
  }, []);

  return { user, signIn, signOut, grantPremium };
}
