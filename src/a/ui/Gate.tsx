/**
 * The gate, shown in place over the stage. For a Premium feature it first explains what the feature
 * gives (the introduction), then asks for sign-in and Premium, skipping any step already satisfied.
 * It traps focus, closes on Escape and returns focus. On success it closes and performs the action.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { track } from "../../core/analytics";
import { PREMIUM } from "../../core/config";
import { useJourney } from "../lib/journeyContext";
import { resolveFromResponse } from "../lib/looks";
import { useStylingResponse, useStylingSpec } from "../lib/styling";
import { stepsFor, type GateKind, type GateStep } from "../lib/user";
import { useScrollLock } from "../lib/scrollLock";
import { DnaIntro, PremiumCard, PremiumTop, SignInStep, TryOnIntro, usePremiumPayment, type PremiumFeature } from "./GateSteps";

const STEP_LABEL: Record<GateStep, string> = { intro: PREMIUM.name, signin: "Sign in", premium: PREMIUM.name };
const SUCCESS_MS = 900;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function Gate() {
  const { gate, closeGate } = useJourney();
  useScrollLock(gate !== null);
  return (
    <AnimatePresence>
      {gate ? <GateDialog key={gate} kind={gate} onClose={closeGate} /> : null}
    </AnimatePresence>
  );
}

/** The look on the page, for the try-on introduction's picture. */
function useCurrentLook() {
  const { answers } = useJourney();
  const spec = useStylingSpec();
  const { response } = useStylingResponse(spec);
  return useMemo(() => resolveFromResponse(response, answers.occasion, answers.hero)?.hero ?? null, [response, answers.occasion, answers.hero]);
}

function GateDialog({ kind, onClose }: { kind: GateKind; onClose: () => void }) {
  const { user, signIn, grantPremium, gateActions, gateSource, go, reduced, store } = useJourney();
  /* Frozen at open: the list must not shrink under the index once a step is satisfied. */
  const [steps] = useState<GateStep[]>(() => stepsFor(kind, user, { hasDna: Boolean(store.dna) }));
  const [index, setIndex] = useState(0);
  const [success, setSuccess] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  const finished = useRef(false);
  const feature: PremiumFeature | null = kind === "dna" ? "style_dna" : kind === "tryon" ? "tryon" : null;
  const look = useCurrentLook();

  const perform = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    const registered = gateActions.current[kind];
    onClose();
    window.setTimeout(() => {
      if (registered) registered();
      else if (kind === "tryon") go("moment/tryon");
      else if (kind === "dna") go("dna/face", { occasion: null, venue: null, time: null, vibe: null, spend: null, item: null, hero: null, done: null, face: null });
    }, 0);
  }, [gateActions, kind, onClose, go]);

  /* Nothing left to satisfy: close and act. */
  useEffect(() => {
    if (steps.length === 0 && !success) perform();
  }, [steps.length, success, perform]);

  useEffect(() => {
    returnRef.current = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      returnRef.current?.focus?.();
    };
  }, [onClose]);

  const step = steps[index] ?? null;

  /* Each step a person actually sees is counted once per opening. */
  useEffect(() => {
    if (!feature || !step) return;
    if (step === "intro") track("premium_intro_viewed", { feature });
    if (step === "premium") track("paywall_viewed", { feature });
  }, [feature, step]);

  /* A step that takes focus when it appears: the next one starts at its first control. */
  useEffect(() => {
    if (index > 0) panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [index]);

  const advance = useCallback(() => {
    if (index + 1 < steps.length) setIndex(index + 1);
    else perform();
  }, [index, steps.length, perform]);

  const payment = usePremiumPayment({
    onPaid: () => {
      grantPremium();
      if (feature) track("premium_started", { feature });
      setSuccess(true);
      window.setTimeout(perform, SUCCESS_MS);
    },
  });

  const hidden = reduced ? { opacity: 0 } : { opacity: 0, y: 24 };
  /* The introduction is not a hurdle, so the count covers only what is asked: "1 of 2, Sign in". */
  const asked: GateStep[] = steps.filter((s) => s !== "intro");
  const askedIndex = step ? asked.indexOf(step) : -1;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center lg:p-8">
      <motion.button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0 : 0.2 }}
        className="absolute inset-0 cursor-default bg-[var(--scrim)]"
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={success ? "You’re in" : step === "intro" ? (kind === "dna" ? "Style DNA" : "Try-on") : step ? STEP_LABEL[step] : "Continue"}
        initial={hidden}
        animate={{ opacity: 1, y: 0 }}
        exit={hidden}
        transition={{ duration: reduced ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
        className={`a-gate relative ${!success && step === "intro" ? "a-gate-wide" : ""}`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between pl-5 pr-2 lg:pl-8 lg:pr-4">
          <span className="a-label text-[var(--muted)]" aria-live="polite">
            {/* A count only when it tells him something: what comes after this step. */}
            {success || !step || step === "intro" || asked.length < 2 ? "" : askedIndex < asked.length - 1 ? `${STEP_LABEL[step]}, then ${STEP_LABEL[asked[askedIndex + 1]]}` : `${STEP_LABEL[step]}, last step`}
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center text-[var(--text)] transition-colors duration-200 hover:text-[var(--muted)]">
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>
        <div className="mx-auto mb-2 h-1 w-9 shrink-0 rounded-full bg-[var(--rule)] lg:hidden" aria-hidden="true" />

        {success ? (
          <div className="px-5 pb-8 pt-2 lg:px-8 lg:pb-10" aria-live="polite">
            <h2 className="a-display">You’re in.</h2>
            <p className="mt-4 leading-6">{PREMIUM.name} is on your account.</p>
          </div>
        ) : step === "intro" ? (
          <div className="a-gate-scroll px-5 pb-6 pt-2 lg:px-8">
            {kind === "dna" ? (
              <DnaIntro
                onStart={() => {
                  track("premium_intro_continued", { feature: "style_dna" });
                  advance();
                }}
                onLater={onClose}
              />
            ) : (
              <TryOnIntro
                image={look?.image ?? null}
                title={look?.title ?? null}
                onStart={() => {
                  track("premium_intro_continued", { feature: "tryon" });
                  advance();
                }}
                onLater={onClose}
              />
            )}
          </div>
        ) : step === "signin" ? (
          <div className="a-gate-scroll px-5 pb-6 pt-2 lg:px-8 lg:pb-8">
            <SignInStep
              surface={kind === "signin" ? gateSource.current : "gate"}
              reason={kind === "signin" ? "You can save looks without an account. Signing in keeps them together under your name." : `${kind === "dna" ? "Style DNA" : "See it on me"} is part of ${PREMIUM.name}, so I’ll need you signed in first.`}
              onSignedIn={(email, method) => {
                signIn(email, { method, surface: kind === "signin" ? gateSource.current : "gate" });
                advance();
              }}
            />
          </div>
        ) : step === "premium" ? (
          <>
            <div className="shrink-0 px-5 pb-4 pt-2 lg:px-8">
              <PremiumTop busy={payment.busy} onApplePay={payment.applePay} />
            </div>
            <div className="a-gate-scroll px-5 pb-6 pt-2 lg:px-8 lg:pb-8">
              <PremiumCard busy={payment.busy} onPay={payment.cardPay} />
            </div>
          </>
        ) : null}
      </motion.div>
    </div>
  );
}
