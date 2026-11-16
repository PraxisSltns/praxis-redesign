/**
 * Contextual chrome only: a back arrow, the progress spine, a quiet
 * "New moment" link once the journey has begun, and the monogram that opens
 * the overlay menu. No persistent navigation.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Bookmark, Menu as MenuIcon, Search as SearchIcon, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { track } from "../../core/analytics";
import { FRESH, useJourney } from "../lib/journeyContext";
import { trapTab } from "../lib/focusTrap";
import { useScrollLock } from "../lib/scrollLock";
import { useSearchAccess } from "../lib/searchAccess";
import { TextButton } from "./controls";

export interface SpineStep {
  label: string;
  /** Route under the mount to return to. Null when not yet reachable. */
  to: string | null;
  state: "done" | "current" | "todo";
}

interface TopBarProps {
  spine?: SpineStep[];
  /** Where the arrow goes. "back" uses history. */
  back?: string | "back" | null;
  /** Kept for callers; the wordmark now sits centred on every screen. */
  wordmark?: boolean;
}

export function TopBar({ spine, back = null }: TopBarProps) {
  const { href, user, openGate, store } = useJourney();
  const canSearch = Boolean(useSearchAccess());
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  /* The button that opened the menu, so focus can go back to it on close. */
  const opener = useRef<HTMLElement | null>(null);
  const openMenu = (e: { currentTarget: HTMLElement }) => {
    opener.current = e.currentTarget;
    setMenu(true);
  };

  return (
    <header className="relative z-10 flex h-14 items-center justify-between pl-2 pr-2 lg:h-20 lg:pl-10 lg:pr-8">
      <div className="flex min-w-0 items-center gap-1">
        {back && (
          <button
            type="button"
            aria-label="Back"
            onClick={() => (back === "back" ? navigate(-1) : navigate(back))}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-[var(--text)] transition-colors duration-200 hover:text-[var(--muted)] lg:-ml-3"
          >
            <ArrowLeft size={20} strokeWidth={1.5} />
          </button>
        )}
        <Link to={href("", FRESH)} aria-label="Praxis, home" className="a-wordmark absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[var(--text)] lg:static lg:mr-8 lg:translate-x-0 lg:translate-y-0">
          Praxis
        </Link>
        {spine && <Spine steps={spine} />}
      </div>

      {/* On desktop the few places to go sit in the bar; a light veil keeps them readable over any photo. */}
      <div className="a-topright flex items-center">
        <nav aria-label="Praxis" className="a-desktop items-center">
          {canSearch ? (
            <>
              <Link to={href("search", { hero: null })} className="a-control a-tertiary a-signin gap-2">
                <SearchIcon size={15} strokeWidth={1.5} aria-hidden="true" />
                {/* Below 1280 px the magnifier alone stands for Find a piece, as the bookmark does for Saved looks. */}
                <span className="sr-only xl:not-sr-only">Find a piece</span>
              </Link>
              <span className="a-bar-rule" aria-hidden="true" />
            </>
          ) : null}
          <Link to={href("looks", { hero: null })} className="a-control a-tertiary a-signin gap-2">
            <Bookmark size={15} strokeWidth={1.5} aria-hidden="true" />
            {/* Below 1280 px the bookmark alone stands for Saved looks, so the bar clears the step names. */}
            <span className="sr-only xl:not-sr-only">Saved looks</span>
          </Link>
          <span className="a-bar-rule" aria-hidden="true" />
          <Link to={href("wardrobe", { hero: null })} className="a-control a-tertiary a-signin">
            Wardrobe
          </Link>
          <span className="a-bar-rule" aria-hidden="true" />
          <Link
            to={store.dna ? href("dna", { hero: null }) : href("", { ...FRESH, gate: "dna" })}
            onClick={() => (store.dna ? undefined : track("style_dna_explored", { surface: "bar" }))}
            className="a-control a-tertiary a-signin"
          >
            Style DNA
          </Link>
          <span className="a-bar-rule" aria-hidden="true" />
        </nav>
        {user ? (
          <button type="button" onClick={openMenu} aria-label={`${user.name}, open menu`} className="a-desktop mr-1 items-center justify-center" style={{ width: 44, height: 44 }}>
            <span className="a-avatar" aria-hidden="true">
              {user.name.charAt(0)}
            </span>
          </button>
        ) : (
          <button type="button" onClick={() => openGate("signin", "menu")} className="a-control a-tertiary a-desktop a-signin">
            Sign in
          </button>
        )}
        <button
          type="button"
          aria-label="Menu"
          aria-expanded={menu}
          onClick={openMenu}
          className="flex h-11 w-11 shrink-0 items-center justify-center text-[var(--text)] transition-colors duration-300 hover:text-[var(--muted)] lg:hidden"
        >
          <MenuIcon size={22} strokeWidth={1.25} />
        </button>
      </div>

      <Menu open={menu} onClose={() => setMenu(false)} returnTo={opener} />
    </header>
  );
}

function Spine({ steps }: { steps: SpineStep[] }) {
  return (
    <nav aria-label="Progress" className="a-spine a-desktop">
      <ol className="flex items-center gap-3 sm:gap-5">
        {steps.map((s) => {
          /* Where he is reads at once: the current step in ink with a hairline under it, the rest quiet. */
          const color = s.state === "current" ? "a-spine-current text-[var(--text)]" : s.state === "done" ? "text-[var(--muted)]" : "text-[var(--muted)]";
          return (
            <li key={s.label} aria-current={s.state === "current" ? "step" : undefined}>
              {s.to && s.state === "done" ? (
                <Link to={s.to} className={`inline-flex min-h-[44px] items-center ${color} transition-colors duration-200 hover:text-[var(--text)]`}>
                  {s.label}
                </Link>
              ) : (
                <span className={`inline-flex min-h-[44px] items-center ${color}`}>{s.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The same steps on a phone, where the bar has no room: a quiet row above the question that
 * scrolls sideways if it must. Answered steps open from here too, in either direction.
 */
export function PhoneSpine({ steps }: { steps: SpineStep[] }) {
  return (
    <nav aria-label="Progress" className="a-phone-spine a-spine -mx-5 -mt-4 mb-2 lg:hidden">
      <ol className="flex items-center gap-3 overflow-x-auto px-5 min-[400px]:gap-4">
        {steps.map((s) => (
          <li key={s.label} className="shrink-0" aria-current={s.state === "current" ? "step" : undefined}>
            {s.to && s.state === "done" ? (
              <Link to={s.to} className="inline-flex min-h-[44px] items-center text-[var(--muted)] underline decoration-[var(--rule)] underline-offset-4">
                {s.label}
              </Link>
            ) : (
              <span className={`inline-flex min-h-[44px] items-center ${s.state === "current" ? "a-spine-current text-[var(--text)]" : "text-[var(--muted)]"}`}>{s.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Menu({ open, onClose, returnTo }: { open: boolean; onClose: () => void; returnTo: { current: HTMLElement | null } }) {
  const { href, store, reduced, user, signOut, openGate } = useJourney();
  const canSearch = Boolean(useSearchAccess());
  useScrollLock(open);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else trapTab(e, panelRef.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Focus goes back to the menu button, unless a link in the menu moved to another page.
      if (returnTo.current?.isConnected) returnTo.current.focus();
    };
  }, [open, onClose, returnTo]);

  const items = [
    { label: "Start a new look", to: href("", FRESH) },
    ...(canSearch ? [{ label: "Find a piece", to: href("search", { hero: null }) }] : []),
    { label: "Saved looks", to: href("looks", { hero: null }) },
    { label: "Your wardrobe", to: href("wardrobe", { hero: null }) },
    { label: "Style DNA", to: store.dna ? href("dna", { hero: null }) : href("", { ...FRESH, gate: "dna" }) },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.45, ease: "easeInOut" }}
          className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)]"
        >
          <div className="flex h-14 items-center justify-end pr-2 lg:pr-6">
            <button type="button" aria-label="Close menu" onClick={onClose} autoFocus className="flex h-11 w-11 items-center justify-center text-[var(--text)] transition-colors duration-200 hover:text-[var(--muted)]">
              <X size={22} strokeWidth={1.5} />
            </button>
          </div>
          <nav className="flex flex-1 flex-col justify-center px-5 pb-14 lg:px-12" aria-label="Sections">
            {/* Navigation, not a headline: the serif at 26 px, with Sign in in ink so the menu reads as one list. */}
            <ul className="flex flex-col gap-1">
              {items.map((item, i) => (
                <motion.li key={item.label} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : 0.08 * i, ease: "easeOut" }}>
                  <Link
                    to={item.to}
                    onClick={() => {
                      if (item.label === "Style DNA" && !store.dna) track("style_dna_explored", { surface: "menu" });
                      onClose();
                    }}
                    className="inline-flex min-h-[48px] items-center font-[family-name:var(--font-display)] text-[26px] leading-8 text-[var(--text)] transition-colors duration-200 hover:text-[var(--muted)]"
                  >
                    {item.label}
                  </Link>
                </motion.li>
              ))}
            </ul>
            <Link to={href("data")} onClick={onClose} className="mt-6 inline-flex min-h-11 items-center self-start text-[15px] text-[var(--muted)] transition-colors duration-200 hover:text-[var(--text)]">
              Your data on this device
            </Link>
            <div className="mt-4 flex items-center gap-3 border-t border-[var(--rule)] pt-6">
              {user ? (
                <>
                  <span className="a-avatar" aria-hidden="true">
                    {user.name.charAt(0)}
                  </span>
                  <span className="text-[15px] leading-5">
                    {user.name}
                    <span className="ml-2 text-[13px] text-[var(--muted)]">{user.premium ? "Premium" : user.email}</span>
                  </span>
                  <TextButton
                    onClick={() => {
                      signOut();
                      onClose();
                    }}
                    className="ml-auto"
                  >
                    Sign out
                  </TextButton>
                </>
              ) : (
                <TextButton
                  onClick={() => {
                    onClose();
                    openGate("signin", "menu");
                  }}
                  className="-ml-2"
                  style={{ color: "var(--text)", fontSize: 16 }}
                >
                  Sign in
                </TextButton>
              )}
            </div>
          </nav>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
