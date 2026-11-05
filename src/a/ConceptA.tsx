/**
 * Concept A: Stage. One full-viewport stage split in two: one question at a
 * time on the left, a living print on the right. Every step is a route.
 * Champagne and mocha palettes, element system Hairline, light and dark.
 */
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import "./a.css";
import "./a-layout.css";
import { useConceptFonts } from "../shared/fonts";
import { JourneyProvider } from "./lib/journey";
import { useJourney } from "./lib/journeyContext";
import { Home } from "./screens/Home";
import { InternalAnalytics } from "./screens/Internal";
import { YourData } from "./screens/YourData";
import { VerifySignIn } from "./screens/VerifySignIn";
import { Wardrobe } from "./screens/Wardrobe";
import { LookDetail, Looks } from "./screens/Looks";
import { Build } from "./screens/moment/Build";
import { Question } from "./screens/moment/Question";
import { Results } from "./screens/moment/Results";
import { TryOn } from "./screens/moment/TryOn";
import { You, YouFace, YouItem } from "./screens/moment/You";
import { DnaBuild, DnaHome, DnaResult } from "./screens/dna/DnaResult";
import { DnaFace, DnaFit, DnaInspiration, DnaLifestyle } from "./screens/dna/DnaSteps";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { Gate } from "./ui/Gate";
import { TestModeTag } from "./ui/TestModeTag";

const SHOW_INTERNAL = import.meta.env.DEV || import.meta.env.VITE_INTERNAL_PAGE === "true";

const FONTS = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=Geist:wght@400;500&family=Geist+Mono:wght@400&display=swap";

function Fallback() {
  const { href } = useJourney();
  return <Navigate to={href("")} replace />;
}

/**
 * Style DNA is Premium. Someone with Premium, or with a Style DNA already saved (to look over or
 * delete), goes in; anyone else typing the address lands on home with the Style DNA introduction open.
 */
function DnaOnly({ children }: { children: ReactNode }) {
  const { href, user, store } = useJourney();
  if (user?.premium || store.dna) return <>{children}</>;
  return <Navigate to={href("", { gate: "dna" })} replace />;
}

/** Try-on is Premium: without it, the address leads back to the looks with the try-on introduction open. */
function TryOnOnly({ children }: { children: ReactNode }) {
  const { href, user, answers } = useJourney();
  if (!answers.spend) return <Navigate to={href("", { gate: null })} replace />;
  if (user?.premium) return <>{children}</>;
  return <Navigate to={href("moment/results", { gate: "tryon" })} replace />;
}

function Shell() {
  const { mode, href } = useJourney();
  const { pathname } = useLocation();
  return (
    <div data-lab data-concept="a" data-mode={mode} className="min-h-[100dvh]">
      <ErrorBoundary home={href("")} resetKey={pathname}>
        <Routes>
          <Route index element={<Home />} />
          <Route path="moment" element={<Fallback />} />
          {/* The occasion is chosen on home; old links to the occasion question land there with their answers. */}
          <Route path="moment/occasion" element={<Fallback />} />
          <Route path="moment/venue" element={<Question key="venue" step="venue" />} />
          <Route path="moment/time" element={<Question key="time" step="time" />} />
          <Route path="moment/feel" element={<Question key="feel" step="feel" />} />
          <Route path="moment/spend" element={<Question key="spend" step="spend" />} />
          <Route path="moment/you" element={<You />} />
          <Route path="moment/you/face" element={<YouFace />} />
          <Route path="moment/you/item" element={<YouItem />} />
          <Route path="moment/build" element={<Build />} />
          <Route path="moment/results" element={<Results />} />
          <Route path="moment/tryon" element={<TryOnOnly><TryOn /></TryOnOnly>} />
          <Route path="looks" element={<Looks />} />
          <Route path="looks/:id" element={<LookDetail />} />
          <Route path="dna" element={<DnaOnly><DnaHome /></DnaOnly>} />
          <Route path="dna/face" element={<DnaOnly><DnaFace /></DnaOnly>} />
          <Route path="dna/fit" element={<DnaOnly><DnaFit /></DnaOnly>} />
          <Route path="dna/lifestyle" element={<DnaOnly><DnaLifestyle /></DnaOnly>} />
          <Route path="dna/inspiration" element={<DnaOnly><DnaInspiration /></DnaOnly>} />
          <Route path="dna/build" element={<DnaOnly><DnaBuild /></DnaOnly>} />
          <Route path="dna/result" element={<DnaOnly><DnaResult /></DnaOnly>} />
          <Route path="data" element={<YourData />} />
          <Route path="wardrobe" element={<Wardrobe />} />
          <Route path="auth/verify" element={<VerifySignIn />} />
          {/* Test mode and the event log: in development, or in a build made with VITE_INTERNAL_PAGE=true; never in the live build. */}
          {SHOW_INTERNAL && <Route path="internal/analytics" element={<InternalAnalytics />} />}
          <Route path="*" element={<Fallback />} />
        </Routes>
      </ErrorBoundary>
      <Gate />
      <TestModeTag />
    </div>
  );
}

export default function ConceptA() {
  useConceptFonts("a", FONTS);
  return (
    <JourneyProvider>
      <Shell />
    </JourneyProvider>
  );
}
