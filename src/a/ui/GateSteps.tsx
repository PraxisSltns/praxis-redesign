/**
 * The gate steps: the introduction to a Premium feature, sign in, then Premium. Value first, then
 * the commitment. Sign-in and payment are previews; nothing leaves the browser and no charge is made.
 */
import { useState } from "react";
import { Apple, Check, Lock } from "lucide-react";
import { AUTH_MODE, premiumAmount, premiumPrice, PREMIUM } from "../../core/config";
import { startSignIn } from "../../core/accountApi";
import { anonymousId } from "../../core/identity";
import { local, writeJson } from "../../core/ids";
import type { SignInMethod, SignInSurface } from "../lib/journeyContext";
import { isEmail } from "../lib/user";
import { Field, PrimaryButton, QuietButton, TextButton } from "./controls";

const SIGNIN_MS = 900;
const PAY_MS = 1200;

/* ------------------------------------------------------------- introductions */

export type PremiumFeature = "style_dna" | "tryon";

/** Only what Style DNA does today. Using your own pieces is open to everyone, so it isn't listed here. */
const DNA_GETS = ["Your style preferences, saved", "Your fit and colours, remembered", "A profile you can revisit and update"];

function Gets({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((b) => (
        <li key={b} className="flex items-start gap-2 text-[15px] leading-6">
          <Check size={16} strokeWidth={1.5} aria-hidden="true" className="mt-1 shrink-0 text-[var(--accent)]" />
          {b}
        </li>
      ))}
    </ul>
  );
}

function IntroHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="a-label flex items-center gap-3 text-[var(--muted)]">
        {eyebrow}
        <span className="a-tag">{PREMIUM.name}</span>
      </p>
      <h2 className="a-display mt-3">{title}</h2>
    </div>
  );
}

function IntroFoot({ onStart, onLater, start }: { onStart: () => void; onLater: () => void; start: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-baseline gap-2">
        <span className="text-[15px]">{PREMIUM.name}</span>
        <span className="a-mono text-[15px] text-[var(--muted)]">{premiumPrice()}</span>
        <span className="text-[13px] text-[var(--muted)]">Cancel any time.</span>
      </p>
      <div className="flex items-center gap-2">
        <PrimaryButton onClick={onStart}>{start}</PrimaryButton>
        <TextButton onClick={onLater}>Not now</TextButton>
      </div>
    </div>
  );
}

/** Style DNA, explained before anything is asked: what it gives, what it takes, how long, the price. */
export function DnaIntro({ onStart, onLater }: { onStart: () => void; onLater: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <IntroHead eyebrow="Style DNA" title="Your style. More personal." />
      <p className="text-[15px] leading-6">Go beyond the occasion. A personal style profile that remembers your fit, colours, lifestyle and preferences.</p>
      <Gets items={DNA_GETS} />
      <div className="a-preview-note">
        <p className="a-label text-[var(--muted)]">In preview</p>
        <p className="mt-1 text-[15px] leading-6">Today I save your profile and lean your looks towards your taste. Looks built around your colours and fit come next.</p>
      </div>
      <p className="text-[13px] leading-5 text-[var(--muted)]">Four short steps: a photo of your face, or a sample instead, then your fit, your lifestyle and your personal taste. About two minutes.</p>
      <IntroFoot onStart={onStart} onLater={onLater} start="Start" />
    </div>
  );
}

/** Try-on, explained honestly before anything is asked. The picture is the look on a model, and says so. */
export function TryOnIntro({ image, title, onStart, onLater }: { image: string | null; title: string | null; onStart: () => void; onLater: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <IntroHead eyebrow="Try-on" title="See it on you." />
      <div className="flex items-start gap-4">
        {image ? (
          <figure className="a-intro-print shrink-0">
            <img src={image} alt={title ? `${title}, on a model` : "The look, on a model"} draggable={false} />
            <figcaption className="a-label mt-2 text-[var(--muted)]">On a model</figcaption>
          </figure>
        ) : null}
        <p className="text-[15px] leading-6">Add one photo of you and I’ll show this look on it, so you can judge the fit and the colours before you buy.</p>
      </div>
      <p className="text-[13px] leading-5 text-[var(--muted)]">Try-on isn’t switched on yet. You can add your photo and send it; I’ll tell you plainly that no picture was made, never show one made to look like you.</p>
      <IntroFoot onStart={onStart} onLater={onLater} start="Continue" />
    </div>
  );
}

/* ------------------------------------------------------------------ sign in */

interface SignInProps {
  /** Why an account is asked for here, in one line. */
  reason: string;
  onSignedIn: (email: string | undefined, method: SignInMethod) => void;
  /** Where the sign-in began, kept for when the emailed link brings the person back (a real sign-in). */
  surface?: SignInSurface;
}

/** A sign-in link waiting to be opened (src/a/screens/VerifySignIn.tsx reads it). */
export const SIGNIN_PENDING_KEY = "praxis_signin_pending";

/** A real sign-in (AUTH_MODE "magic-link"): an emailed link, with the account's consents agreed here. */
function EmailLinkSignIn({ reason, surface = "gate" }: Pick<SignInProps, "reason" | "surface">) {
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const send = async () => {
    if (busy) return;
    if (!isEmail(email)) return setError(email.trim() ? "That address looks incomplete. Check it and try again." : "Enter your email to continue.");
    if (!agreed) return setError("Agree to the terms and privacy notice to continue.");
    setError(null);
    setBusy(true);
    const here = new URL(window.location.href);
    here.searchParams.delete("gate");
    writeJson(local(), SIGNIN_PENDING_KEY, { surface, returnTo: `${here.pathname}${here.search}`, at: new Date().toISOString() });
    const answer = await startSignIn(email.trim(), anonymousId());
    setBusy(false);
    if (answer.ok) setSentTo(email.trim());
    else setError(answer.error);
  };

  if (sentTo) {
    return (
      <div className="flex flex-col gap-6" aria-live="polite">
        <div>
          <h2 className="a-display">Check your email.</h2>
          <p className="mt-3 max-w-[40ch] text-[15px] leading-6 text-[var(--muted)]">
            I sent a sign-in link to {sentTo}. It works once, for 15 minutes, and signs you in on the device you open it on.
          </p>
        </div>
        <QuietButton className="w-full" onClick={() => setSentTo(null)}>
          Use a different email
        </QuietButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="a-display">Sign in so I can remember you.</h2>
        <p className="mt-3 max-w-[40ch] text-[15px] leading-6 text-[var(--muted)]">{reason}</p>
      </div>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Field
          id="gate-email"
          label="Email"
          value={email}
          onChange={(v) => {
            setEmail(v);
            setError(null);
          }}
          placeholder="you@example.com"
          type="email"
          inputMode="email"
          autoComplete="email"
        />
        <label htmlFor="gate-consent" className="flex min-h-[44px] items-start gap-3 text-[14px] leading-5">
          <input
            id="gate-consent"
            type="checkbox"
            className="mt-[2px] h-5 w-5 shrink-0 accent-[var(--accent)]"
            checked={agreed}
            onChange={(e) => {
              setAgreed(e.target.checked);
              setError(null);
            }}
          />
          <span>I agree to the Praxis terms and privacy notice.</span>
        </label>
        {error ? (
          <p role="alert" className="text-[13px] leading-5 text-[var(--error)]">
            {error}
          </p>
        ) : null}
        <QuietButton type="submit" className="w-full" disabled={busy} aria-busy={busy}>
          {busy ? "Sending your link" : "Email me a sign-in link"}
        </QuietButton>
      </form>
    </div>
  );
}

export function SignInStep({ reason, onSignedIn, surface }: SignInProps) {
  if (AUTH_MODE === "magic-link") return <EmailLinkSignIn reason={reason} surface={surface} />;
  return <PreviewSignIn reason={reason} onSignedIn={onSignedIn} />;
}

/** The sign-in preview: no account behind it (AUTH_MODE "preview", the default). */
function PreviewSignIn({ reason, onSignedIn }: SignInProps) {
  const [busy, setBusy] = useState<SignInMethod | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  const start = (way: SignInMethod) => {
    if (busy) return;
    if (way === "email" && !isEmail(email)) {
      setEmailError(email.trim() ? "That address looks incomplete. Check it and try again." : "Enter your email to continue.");
      return;
    }
    setEmailError(null);
    setBusy(way);
    window.setTimeout(() => onSignedIn(way === "email" ? email.trim() : undefined, way), SIGNIN_MS);
  };

  const label = (way: SignInMethod, text: string) => (busy === way ? "Signing you in" : text);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="a-display">Sign in so I can remember you.</h2>
        <p className="mt-3 max-w-[40ch] text-[15px] leading-6 text-[var(--muted)]">{reason}</p>
      </div>
      <div className="flex flex-col gap-2">
        <button type="button" className="a-control a-ink w-full" onClick={() => start("apple")} disabled={busy !== null} aria-busy={busy === "apple"}>
          {busy === "apple" ? null : <Apple size={16} strokeWidth={1.5} aria-hidden="true" className="mr-2" />}
          {label("apple", "Continue with Apple")}
        </button>
        <button type="button" className="a-control w-full justify-center" onClick={() => start("google")} disabled={busy !== null} aria-busy={busy === "google"}>
          {label("google", "Continue with Google")}
        </button>
      </div>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          start("email");
        }}
      >
        <Field
          id="gate-email"
          label="Email"
          value={email}
          onChange={(v) => {
            setEmail(v);
            setEmailError(null);
          }}
          placeholder="you@example.com"
          type="email"
          inputMode="email"
          autoComplete="email"
        />
        {emailError ? (
          <p role="alert" className="text-[13px] leading-5 text-[var(--error)]">
            {emailError}
          </p>
        ) : null}
        <QuietButton type="submit" className="w-full" disabled={busy !== null} aria-busy={busy === "email"}>
          {label("email", "Continue with email")}
        </QuietButton>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ Premium */

const BENEFITS = ["Style DNA: your colours, fit and taste in one profile", "Try-on, in preview while it is built"];

function groups(v: string): string {
  return v.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
}

function expiry(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d;
}

interface PremiumProps {
  onPaid: () => void;
}

/** The parts of the Premium step that must always be visible: what it includes, the price, Apple Pay. */
export function PremiumTop({ busy, onApplePay }: { busy: "apple" | "card" | null; onApplePay: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="a-display">{PREMIUM.name}</h2>
        <ul className="mt-4 flex flex-col gap-2">
          {BENEFITS.map((b) => (
            <li key={b} className="flex items-center gap-2 text-[15px] leading-6">
              <Check size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-[var(--accent)]" />
              {b}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="flex items-baseline gap-2">
          <span className="a-display a-display-md">{premiumAmount()}</span>
          <span className="text-[15px] text-[var(--muted)]">a {PREMIUM.period}</span>
        </p>
        <p className="mt-1 text-[13px] leading-5 text-[var(--muted)]">Cancel any time.</p>
      </div>
      <button type="button" className="a-control a-applepay w-full" onClick={onApplePay} disabled={busy !== null} aria-busy={busy === "apple"}>
        {busy === "apple" ? (
          "Confirming with Apple Pay"
        ) : (
          <>
            <Apple size={18} strokeWidth={1.5} aria-hidden="true" />
            Pay
          </>
        )}
      </button>
    </div>
  );
}

/** The card form under Apple Pay; this part may scroll on a short phone. */
export function PremiumCard({ busy, onPay }: { busy: "apple" | "card" | null; onPay: () => boolean }) {
  const [card, setCard] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (busy) return;
    if (!card.trim() || !exp.trim() || !cvc.trim()) {
      setError("Check your card number, expiry and CVC.");
      return;
    }
    setError(null);
    onPay();
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="flex items-center gap-3 text-[13px] leading-5 text-[var(--muted)]">
        <span className="h-px flex-1 bg-[var(--rule)]" aria-hidden="true" />
        or pay with card
        <span className="h-px flex-1 bg-[var(--rule)]" aria-hidden="true" />
      </p>
      <Field id="gate-card" label="Card number" value={card} onChange={(v) => setCard(groups(v))} placeholder="4242 4242 4242 4242" inputMode="numeric" autoComplete="off" />
      <div className="flex gap-3">
        <Field id="gate-exp" label="Expiry" value={exp} onChange={(v) => setExp(expiry(v))} placeholder="MM / YY" inputMode="numeric" autoComplete="off" />
        <Field id="gate-cvc" label="CVC" value={cvc} onChange={(v) => setCvc(v.replace(/\D/g, "").slice(0, 4))} placeholder="123" inputMode="numeric" autoComplete="off" />
      </div>
      {error ? (
        <p role="alert" className="text-[13px] leading-5 text-[var(--error)]">
          {error}
        </p>
      ) : null}
      <PrimaryButton type="submit" className="w-full" disabled={busy !== null} aria-busy={busy === "card"}>
        {busy === "card" ? "One moment" : `Pay ${premiumAmount()}`}
      </PrimaryButton>
      <p className="flex items-center gap-1.5 text-[12px] leading-4 text-[var(--muted)]">
        <Lock size={12} strokeWidth={1.5} aria-hidden="true" />
        This is a preview. No charge is made.
      </p>
    </form>
  );
}

/** Owns the paying state for both routes so the header and the card share it. */
export function usePremiumPayment({ onPaid }: PremiumProps) {
  const [busy, setBusy] = useState<"apple" | "card" | null>(null);
  const pay = (route: "apple" | "card") => {
    if (busy) return false;
    setBusy(route);
    window.setTimeout(onPaid, PAY_MS);
    return true;
  };
  return { busy, applePay: () => pay("apple"), cardPay: () => pay("card") };
}
