/**
 * Journey types, the URL reader, and the context hook for Concept A.
 * The provider lives in journey.tsx.
 */
import { createContext, useContext, useEffect, type MutableRefObject } from "react";
import {
  OCCASIONS,
  SPEND,
  timesFor,
  VENUES,
  VIBES,
  type OccasionId,
  type Piece,
  type SpendId,
  type TimeId,
  type VibeId,
} from "../../shared/catalog";
import type { useLabStore } from "../../shared/store";
import type { ModeId } from "./mode";
import type { GateKind, LabUser } from "./user";

export type SignInMethod = "apple" | "google" | "email";
export type SignInSurface = "sync_offer" | "gate" | "menu";

export type FaceSource = "sample" | "own";
export type Slot = Piece["slot"];
export type DoneKind = "saved" | "dna";

export interface Answers {
  occasion: OccasionId | null;
  venue: string | null;
  time: TimeId | null;
  vibe: VibeId | null;
  spend: SpendId | null;
  face: FaceSource | null;
  item: Slot | null;
  hero: string | null;
  done: DoneKind | null;
}

export interface OwnedItem {
  slot: Slot;
  name: string;
  image: string | null;
  /** Set when the piece comes from the wardrobe, so the request names that same piece. */
  wardrobeItemId?: string;
  source?: "sample" | "upload" | "described";
  colour?: string;
}

const SLOTS: readonly Slot[] = ["top", "bottom", "shoes", "extras"];
const DONE: readonly DoneKind[] = ["saved", "dna"];
export const FACE_KEY = "praxis_lab_a_face";
export const ITEM_KEY = "praxis_lab_a_item";

/** Clears the journey. The face on file and the saved DNA stay. */
export const FRESH = { occasion: null, venue: null, time: null, vibe: null, spend: null, item: null, hero: null, done: null, fit: null, life: null, taste: null } as const;

export function readSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: unknown): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable; the session still works in memory.
  }
}

function oneOf<T extends string>(value: string | null, allowed: readonly { id: T }[]): T | null {
  return allowed.some((o) => o.id === value) ? (value as T) : null;
}

export function parseAnswers(params: URLSearchParams): Answers {
  const occasion = oneOf<OccasionId>(params.get("occasion"), OCCASIONS);
  const venue = occasion ? oneOf(params.get("venue"), VENUES[occasion]) : null;
  const item = params.get("item");
  const done = params.get("done");
  return {
    occasion,
    venue,
    time: oneOf<TimeId>(params.get("time"), timesFor(occasion)),
    vibe: oneOf<VibeId>(params.get("vibe"), VIBES),
    spend: oneOf<SpendId>(params.get("spend"), SPEND),
    face: params.get("face") === "own" ? "own" : params.get("face") === "sample" ? "sample" : null,
    item: SLOTS.includes(item as Slot) ? (item as Slot) : null,
    hero: params.get("hero"),
    done: DONE.find((k) => k === done) ?? null,
  };
}

export type Patch = Partial<Record<keyof Answers | "fit" | "life" | "taste" | "gate" | "restyle" | "retake", string | null>>;

export const GATES: readonly GateKind[] = ["tryon", "dna", "signin"];

export function withPatch(params: URLSearchParams, patch: Patch): URLSearchParams {
  const next = new URLSearchParams(params);
  /* A completion state or an open gate never survives a navigation unless the patch sets it. */
  next.delete("done");
  next.delete("gate");
  /* Starting a journey of your own leaves the shared link behind. */
  if ("occasion" in patch) ["via", "utm_source", "utm_medium", "utm_campaign"].forEach((k) => next.delete(k));
  Object.entries(patch).forEach(([key, value]) => {
    if (value === null || value === undefined) next.delete(key);
    else next.set(key, value);
  });
  return next;
}

export interface JourneyContextValue {
  base: string;
  answers: Answers;
  params: URLSearchParams;
  /** Builds an absolute href under the concept mount, carrying the current answers plus a patch. */
  href: (path: string, patch?: Patch) => string;
  /** Navigates to a step, optionally patching answers first. */
  go: (path: string, patch?: Patch, options?: { replace?: boolean }) => void;
  /** True from the first answered question until the journey is reset. */
  begun: boolean;
  faceImage: string | null;
  setFaceImage: (image: string | null) => void;
  ownedItem: OwnedItem | null;
  setOwnedItem: (item: OwnedItem | null) => void;
  store: ReturnType<typeof useLabStore>;
  reduced: boolean;
  mode: ModeId;
  setMode: (m: ModeId) => void;
  user: LabUser | null;
  /** Signs in (a preview) and moves this device's guest looks and feedback onto the account. */
  /** `accountId`: the server's account, after a real sign-in by email link (AUTH_MODE "magic-link"). */
  signIn: (email: string | undefined, how: { method: SignInMethod; surface: SignInSurface }, accountId?: string) => void;
  signOut: () => void;
  grantPremium: () => void;
  /** The gate open on this page, from ?gate=. */
  gate: GateKind | null;
  /** True when the action still needs its introduction, sign-in or Premium. */
  needsGate: (kind: GateKind) => boolean;
  /** Opens the gate in place (replace, no navigation). */
  /** Where a plain sign-in was opened from, for analytics. */
  openGate: (kind: GateKind, source?: SignInSurface) => void;
  closeGate: () => void;
  /** Screens register what the gate should do once it clears. */
  gateActions: MutableRefObject<Partial<Record<GateKind, () => void>>>;
  gateSource: MutableRefObject<SignInSurface>;
}

export const JourneyContext = createContext<JourneyContextValue | null>(null);

export function useJourney(): JourneyContextValue {
  const ctx = useContext(JourneyContext);
  if (!ctx) throw new Error("useJourney must be used inside JourneyProvider");
  return ctx;
}

/** Registers the action the gate performs for this kind while the screen is mounted. */
export function useGateAction(kind: GateKind, action: () => void): void {
  const { gateActions } = useJourney();
  useEffect(() => {
    const registry = gateActions.current;
    registry[kind] = action;
    return () => {
      if (registry[kind] === action) delete registry[kind];
    };
  }, [gateActions, kind, action]);
}

/** Runs the action now if the user may, else opens the gate for it. */
export function useGated(): (kind: GateKind, action: () => void) => void {
  const { needsGate, openGate } = useJourney();
  return (kind, action) => {
    if (needsGate(kind)) openGate(kind);
    else action();
  };
}
