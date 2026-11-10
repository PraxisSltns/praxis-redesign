/**
 * Journey state for Concept A. Answers live in the URL so reload and Back
 * keep the user where they were; captured images live in session storage.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useResolvedPath, useSearchParams } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import { useLabStore } from "../../shared/store";
import { useMode } from "./mode";
import { stepsFor, useUser, type GateKind } from "./user";
import { FACE_KEY, GATES, ITEM_KEY, JourneyContext, parseAnswers, readSession, withPatch, writeSession, type JourneyContextValue, type OwnedItem, type Patch, type SignInMethod, type SignInSurface } from "./journeyContext";
import { migrateFeedback } from "../../core/account";
import { track } from "../../core/analytics";
import { migrateWardrobe, pruneExpired, wardrobeEntries, writeWardrobe } from "../../core/data";
import { feedbackStore } from "../../core/feedback";
import { anonymousId, noteVisit, rotateAnonymousId } from "../../core/identity";
import { session } from "../../core/ids";
import { withdrawConsent, type ImageCategory } from "../../core/images";
import { PROVIDER_ADDRESS } from "./user";
import { AUTH_MODE } from "../../core/config";
import { ACCOUNT_LOOKS_PAGE, accountLooks, claimGuestLooks, removeAccountLook, saveAccountLook, signOutAccount } from "../../core/accountApi";
import { visibleTo } from "../../core/account";
import type { SavedLook } from "../../shared/store";
import { syncAccountRecords } from "../../core/accountRecords";

/** What a tab holds for the person using it, cleared at sign out. */
const SIGN_OUT_TAB_KEYS = ["praxis_lab_a_face", "praxis_lab_a_item", "praxis_dna_draft", "praxis_lab_a_removed", "praxis_tryon_photo", "praxis_tryon_request"];

export function JourneyProvider({ children }: { children: ReactNode }) {
  const base = useResolvedPath("").pathname.replace(/\/$/, "");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const reduced = useReducedMotion() ?? false;
  const { mode, setMode } = useMode();
  const { user, signIn: userSignIn, signOut: userSignOut, grantPremium } = useUser();
  const labStore = useLabStore("a", user?.id);
  const { migrateToAccount, syncAccountLooks, markSynced, notePendingRemoval } = labStore;

  /* With a real account, the server keeps the account's looks. Each send that fails stays noted on this
     device (unsynced, or a pending removal) and is sent again on the next sync. */
  const sendLook = useCallback(
    (accountId: string, entry: SavedLook) =>
      void saveAccountLook(anonymousId(), entry).then((r) => {
        if (r.ok) markSynced(accountId, entry.dedupeKey);
        else track("account_migration_failed", { part: "looks" });
      }),
    [markSynced],
  );
  const sendRemoval = useCallback(
    (accountId: string, dedupeKey: string) =>
      void removeAccountLook(dedupeKey).then((r) => {
        if (r.ok) notePendingRemoval(accountId, dedupeKey, false);
      }),
    [notePendingRemoval],
  );
  /** Brings in the account's looks from other devices, drops the ones removed there, and sends what this device owes. */
  const syncWithAccount = useCallback(
    (accountId: string, mine: SavedLook[]) => {
      const r = syncAccountLooks(accountId, mine, mine.length < ACCOUNT_LOOKS_PAGE);
      if (!r.ok) return;
      for (const l of r.toSave) sendLook(accountId, l);
      for (const key of r.toRemove) sendRemoval(accountId, key);
    },
    [syncAccountLooks, sendLook, sendRemoval],
  );

  const store = useMemo(() => {
    if (AUTH_MODE !== "magic-link" || !user) return labStore;
    const accountId = user.id;
    return {
      ...labStore,
      saveLook: (...args: Parameters<typeof labStore.saveLook>) => {
        const result = labStore.saveLook(...args);
        if (result.ok && !result.existing) sendLook(accountId, result.entry);
        return result;
      },
      removeLook: (id: string) => {
        const entry = labStore.looks.find((l) => l.id === id);
        const ok = labStore.removeLook(id);
        if (ok && entry?.owner?.userId === accountId) {
          notePendingRemoval(accountId, entry.dedupeKey, true);
          sendRemoval(accountId, entry.dedupeKey);
        }
        return ok;
      },
      restoreLook: (entry: SavedLook) => {
        const ok = labStore.restoreLook(entry);
        if (ok && entry.owner?.userId === accountId) {
          notePendingRemoval(accountId, entry.dedupeKey, false);
          sendLook(accountId, entry);
        }
        return ok;
      },
    };
  }, [labStore, user, sendLook, sendRemoval, notePendingRemoval]);

  /* Records past their retention period go before any screen reads them (the stores cache what they read). */
  useState(() => pruneExpired());

  const accountId = AUTH_MODE === "magic-link" ? user?.id : undefined;

  /* A visit is counted once per tab; a browser that has been here before counts as returning. */
  useEffect(() => {
    const visit = noteVisit();
    if (visit?.returning) track("user_returned", { daysSinceLastVisit: visit.daysSinceLastVisit, visits: visit.visits });
  }, []);

  const signIn = useCallback(
    (email: string | undefined, how: { method: SignInMethod; surface: SignInSurface }, accountId?: string) => {
      const address = how.method === "email" ? email : PROVIDER_ADDRESS[how.method];
      if (!address) return;
      const anon = anonymousId();
      // A real account: this browser's guest looks go to the server once, and the account's looks from other devices come here.
      const guestLooks = accountId ? labStore.looks.filter((l) => !l.owner?.userId && visibleTo(l, undefined, anon)) : [];
      const account = userSignIn(address, accountId);
      track("signin_completed", how);
      // Looks first; feedback only once they are safely on the account. A failed write changes nothing.
      const looks = migrateToAccount(account.id, anon);
      if (!looks.ok) {
        track("account_migration_failed", { part: "looks" });
        return;
      }
      const feedback = migrateFeedback(feedbackStore.all(), account.id, anon);
      const feedbackMoved = feedbackStore.replaceAll(feedback.records);
      const wardrobe = migrateWardrobe(wardrobeEntries(), account.id, anon);
      if (wardrobe.moved) writeWardrobe(wardrobe.entries);
      track("account_migrated", { looks: looks.moved, duplicates: looks.duplicates, feedback: feedbackMoved ? feedback.moved : 0, wardrobe: wardrobe.moved });
      if (!feedbackMoved) track("account_migration_failed", { part: "feedback" });
      if (accountId) {
        void claimGuestLooks(anon, guestLooks)
          .then((claimed) => {
            if (!claimed.ok) track("account_migration_failed", { part: "looks" });
            return accountLooks();
          })
          .then((mine) => {
            if (mine.ok) syncWithAccount(account.id, mine.looks);
          });
      }
    },
    [userSignIn, migrateToAccount, syncWithAccount, labStore.looks],
  );
  const [faceImage, setFace] = useState<string | null>(() => readSession<string>(FACE_KEY));
  const [ownedItem, setItem] = useState<OwnedItem | null>(() => readSession<OwnedItem>(ITEM_KEY));

  useEffect(() => writeSession(FACE_KEY, faceImage), [faceImage]);
  useEffect(() => writeSession(ITEM_KEY, ownedItem), [ownedItem]);

  /**
   * Signing out leaves this device as a new guest's: a new anonymous id, so nothing saved before shows;
   * the photos and the unsaved Style DNA in this tab are deleted; photo consent is asked again. What the
   * account saved stays on the device, hidden, for when it signs in again.
   */
  const signOut = useCallback(() => {
    rotateAnonymousId();
    setFace(null);
    setItem(null);
    for (const key of SIGN_OUT_TAB_KEYS) {
      try {
        session()?.removeItem(key);
      } catch {
        // Nothing to remove.
      }
    }
    for (const category of ["face_colour", "wardrobe_garment", "try_on", "body_fit"] as ImageCategory[]) withdrawConsent(category);
    if (AUTH_MODE === "magic-link") void signOutAccount();
    userSignOut();
    track("signed_out", {});
  }, [userSignOut]);

  /* With a real account, each page load syncs the account's looks with this device. If the server says
     the session has ended (signed out elsewhere, consent withdrawn, or past its 30 days), this device
     signs out too, rather than looking signed in while nothing reaches the account. */
  useEffect(() => {
    if (!accountId) return;
    let live = true;
    void accountLooks().then((mine) => {
      if (!live) return;
      if (mine.ok) syncWithAccount(accountId, mine.looks);
      else if (mine.status === 401) signOut();
    });
    return () => {
      live = false;
    };
  }, [accountId, syncWithAccount, signOut]);

  /* The account's wardrobe and feedback: synced on each load and each change of screen (src/core/accountRecords.ts). */
  const { pathname: screen } = useLocation();
  useEffect(() => {
    if (!accountId) return;
    void syncAccountRecords(accountId, anonymousId()).then((r) => {
      if (r === "signed_out") signOut();
    });
  }, [accountId, screen, signOut]);
  const { pathname } = useLocation();
  const gateActions = useRef<Partial<Record<GateKind, () => void>>>({});

  const answers = useMemo(() => parseAnswers(params), [params]);

  const href = useCallback(
    (path: string, patch: Patch = {}) => {
      const search = withPatch(params, patch).toString();
      const pathname = path === "" ? base || "/" : `${base}/${path.replace(/^\//, "")}`;
      return search ? `${pathname}?${search}` : pathname;
    },
    [base, params],
  );

  const go = useCallback(
    (path: string, patch: Patch = {}, options: { replace?: boolean } = {}) => {
      navigate(href(path, patch), { replace: options.replace });
    },
    [navigate, href],
  );

  const begun = Boolean(answers.occasion || answers.done || params.get("fit") || params.get("life"));

  const gateParam = params.get("gate");
  const gate = GATES.find((g) => g === gateParam) ?? null;
  const hasDna = Boolean(store.dna);
  const needsGate = useCallback((kind: GateKind) => stepsFor(kind, user, { hasDna }).length > 0, [user, hasDna]);
  const gateSource = useRef<SignInSurface>("menu");
  const openGate = useCallback(
    (kind: GateKind, source: SignInSurface = "menu") => {
      gateSource.current = source;
      const next = new URLSearchParams(params);
      next.set("gate", kind);
      navigate(`${pathname}?${next.toString()}`, { replace: true });
    },
    [navigate, params, pathname],
  );
  const closeGate = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete("gate");
    const search = next.toString();
    navigate(search ? `${pathname}?${search}` : pathname, { replace: true });
  }, [navigate, params, pathname]);

  const value = useMemo<JourneyContextValue>(
    () => ({
      base,
      answers,
      params,
      href,
      go,
      begun,
      faceImage,
      setFaceImage: setFace,
      ownedItem,
      setOwnedItem: setItem,
      store,
      reduced,
      mode,
      setMode,
      user,
      signIn,
      signOut,
      grantPremium,
      gate,
      needsGate,
      openGate,
      closeGate,
      gateActions,
      gateSource,
    }),
    [base, answers, params, href, go, begun, faceImage, ownedItem, store, reduced, mode, setMode, user, signIn, signOut, grantPremium, gate, needsGate, openGate, closeGate],
  );

  return <JourneyContext.Provider value={value}>{children}</JourneyContext.Provider>;
}

