/**
 * Where the emailed sign-in link lands (/auth/verify?token=..., AUTH_MODE "magic-link"). The link
 * itself changes nothing: this page sends the token to the server once (a POST, so a mail scanner that
 * opens links can't use it up), signs in, and goes back to where the sign-in began. The guest's saved
 * looks then move to the account (src/a/lib/journey.tsx).
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { verifySignIn } from "../../core/accountApi";
import { local, readJson, writeJson } from "../../core/ids";
import { useJourney } from "../lib/journeyContext";
import type { SignInSurface } from "../lib/journeyContext";
import { SIGNIN_PENDING_KEY } from "../ui/GateSteps";
import { PrimaryButton } from "../ui/controls";
import { TopBar } from "../ui/TopBar";

const SURFACES: SignInSurface[] = ["sync_offer", "gate", "menu"];

export function VerifySignIn() {
  const { href, signIn } = useJourney();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const token = params.get("token") ?? "";
    // The token leaves the address bar at once, so it isn't kept in history or shared by accident.
    window.history.replaceState(null, "", window.location.pathname);
    void verifySignIn(token).then((answer) => {
      if (!answer.ok) return setProblem(answer.error);
      const pending = readJson<{ surface?: string; returnTo?: string }>(local(), SIGNIN_PENDING_KEY);
      writeJson(local(), SIGNIN_PENDING_KEY, null);
      const surface = SURFACES.find((s) => s === pending?.surface) ?? "gate";
      signIn(answer.user.email, { method: "email", surface }, answer.user.id);
      const back = typeof pending?.returnTo === "string" && pending.returnTo.startsWith("/") && !pending.returnTo.startsWith("//") ? pending.returnTo : href("looks");
      navigate(back, { replace: true });
    });
  }, [params, signIn, navigate, href]);

  return (
    <div className="min-h-[100dvh] bg-[var(--bg)]">
      <TopBar back={href("")} />
      <main className="mx-auto flex max-w-[640px] flex-col gap-6 px-5 pb-16 pt-4 lg:px-10" aria-live="polite">
        {problem ? (
          <>
            <h1 className="a-display">That link didn't work.</h1>
            <p className="max-w-[48ch] leading-6 text-[var(--muted)]">{problem}</p>
            <PrimaryButton onClick={() => navigate(`${href("")}?gate=signin`, { replace: true })}>Send a new link</PrimaryButton>
          </>
        ) : (
          <h1 className="a-display">Signing you in</h1>
        )}
      </main>
    </div>
  );
}
