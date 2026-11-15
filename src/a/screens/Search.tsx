/**
 * Find a piece: a few words or a photo of a piece, and the closest pieces in the stores' catalogues,
 * each as its cut-out with its store, price and sizes, and a link to the store's own page.
 *
 * Only shown when the catalogue is open to this visitor (useSearchAccess). The words and the photo go to
 * this app's own server for this one search and aren't kept; analytics records only how the search was
 * asked and how many pieces came back.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { track } from "../../core/analytics";
import { MAX_SEARCH_TEXT, priceText, searchCatalogue, SearchError, type FoundPiece, type SearchQuery } from "../../core/catalogueSearch";
import { useJourney } from "../lib/journeyContext";
import { fileToDataUrl, shrinkImage } from "../lib/image";
import { useSearchAccess } from "../lib/searchAccess";
import { Caption, LinkButton, PrimaryButton, QuietButton } from "../ui/controls";
import { TopBar } from "../ui/TopBar";

/** A photo is shrunk to this before it is sent: enough for the model, small enough to send quickly. */
const PHOTO_EDGE = 768;
const EXAMPLES = ["navy blazer", "white leather sneakers", "brown leather belt"];

type State = { kind: "idle" } | { kind: "searching" } | { kind: "done"; pieces: FoundPiece[]; understood?: string; asked: string } | { kind: "error"; message: string };

function sizesText(sizes: string[]): string {
  if (sizes.length === 0) return "";
  return sizes.length <= 4 ? `Sizes ${sizes.join(", ")}` : `${sizes.length} sizes in stock`;
}

export function Search() {
  const { href } = useJourney();
  const access = useSearchAccess();
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);
  const running = useRef<AbortController | null>(null);

  useEffect(() => () => running.current?.abort(), []);

  const run = async (query: SearchQuery, asked: string) => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setState({ kind: "searching" });
    try {
      const answer = await searchCatalogue(query, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setState({ kind: "done", pieces: answer.pieces, understood: answer.understood, asked });
      track("catalogue_searched", { mode: "text" in query ? "words" : "photo", results: answer.pieces.length, ...(answer.understood ? { kind: answer.understood } : {}) });
    } catch (e) {
      if (controller.signal.aborted) return;
      setState({ kind: "error", message: e instanceof SearchError ? e.message : "The search couldn't be run just now. Try again." });
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const words = text.trim();
    if (words) void run({ text: words }, `“${words}”`);
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setState({ kind: "error", message: "Choose a JPEG, PNG or WebP photo." });
      return;
    }
    try {
      const image = await shrinkImage(await fileToDataUrl(file), PHOTO_EDGE);
      void run({ image }, "your photo");
    } catch {
      setState({ kind: "error", message: "I couldn't read that photo. Try another one." });
    }
  };

  if (access === undefined) {
    return (
      <div className="a-stage">
        <TopBar back={href("")} wordmark />
      </div>
    );
  }

  if (access === null) {
    return (
      <div className="a-stage">
        <TopBar back={href("")} wordmark />
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 pb-16 text-center lg:px-12">
          <h1 className="a-display">Find a piece is coming soon.</h1>
          <p className="max-w-[36ch] leading-6 text-[var(--muted)]">It opens once our partner stores are connected. Until then, start with a look.</p>
          <LinkButton to={href("")} variant="primary">
            Start a new look
          </LinkButton>
        </div>
      </div>
    );
  }

  const busy = state.kind === "searching";
  return (
    <div className="a-stage">
      <TopBar back={href("")} wordmark />
      <div className="a-search flex min-h-0 flex-col overflow-y-auto px-5 pb-16 pt-6 lg:px-12 lg:pt-8">
        <h1 className="a-display">Find a piece</h1>
        <p className="mt-1 max-w-[52ch] text-[15px] leading-6 text-[var(--muted)]">Describe it in a few words, or show me a photo of it, and I’ll find the closest pieces in stock.</p>
        {access === "test" ? <Caption className="mt-1">Test stores only: customers don’t see this yet.</Caption> : null}

        <form onSubmit={onSubmit} role="search" aria-label="Find a piece" className="mt-6 flex max-w-[640px] flex-col gap-3 sm:flex-row sm:items-end">
          <label htmlFor="search-words" className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-[13px] leading-5 text-[var(--muted)]">What are you looking for?</span>
            <input id="search-words" type="search" enterKeyHint="search" autoComplete="off" maxLength={MAX_SEARCH_TEXT} placeholder="For example, navy blazer" value={text} onChange={(e) => setText(e.target.value)} className="a-input" />
          </label>
          <div className="flex gap-2">
            <PrimaryButton type="submit" disabled={busy || !text.trim()}>
              Search
            </PrimaryButton>
            <QuietButton onClick={() => fileRef.current?.click()} disabled={busy}>
              Use a photo
            </QuietButton>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-label="Photo of a piece"
            onChange={(e) => {
              void onPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </form>
        <Caption className="mt-2">A photo is used for this search only and isn’t kept.</Caption>

        <div aria-live="polite" className="mt-6">
          {state.kind === "idle" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] leading-5 text-[var(--muted)]">Try</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="a-control a-secondary a-search-example"
                  onClick={() => {
                    setText(ex);
                    void run({ text: ex }, `“${ex}”`);
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          ) : null}
          {state.kind === "searching" ? <p className="text-[15px] leading-6 text-[var(--muted)]">Looking…</p> : null}
          {state.kind === "error" ? (
            <p role="alert" className="text-[15px] leading-6">
              {state.message}
            </p>
          ) : null}
          {state.kind === "done" && state.pieces.length === 0 ? <p className="text-[15px] leading-6">Nothing close is in stock for {state.asked}. Try other words or another photo.</p> : null}
          {state.kind === "done" && state.pieces.length > 0 ? (
            <>
              <p className="text-[13px] leading-5 text-[var(--muted)]">
                {state.pieces.length} {state.pieces.length === 1 ? "piece" : "pieces"} for {state.asked}
                {state.understood ? `, closest ${state.understood} first` : ""}
              </p>
              <ul className="a-search-results mt-4 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4" aria-label="Pieces found">
                {state.pieces.map((p, i) => (
                  <li key={p.productId} className="a-found flex min-w-0 flex-col">
                    <span className="a-found-image block">
                      <img src={p.cutoutUrl} alt={p.title} loading="lazy" draggable={false} className="h-full w-full object-contain" />
                    </span>
                    <span className="a-label mt-3 block truncate text-[var(--muted)]">{p.retailer}</span>
                    <span className="mt-1 block font-[family-name:var(--font-display)] text-[17px] leading-6">{p.title}</span>
                    <span className="mt-1 flex items-baseline justify-between gap-2 text-[13px] leading-5">
                      <span className="text-[var(--muted)]">{sizesText(p.sizes)}</span>
                      <span className="tabular-nums">{priceText(p)}</span>
                    </span>
                    {p.productUrl ? (
                      <a href={p.productUrl} target="_blank" rel="noopener noreferrer" className="a-found-link mt-2 self-start text-[13px] leading-5 underline underline-offset-4" onClick={() => track("search_piece_opened", { productId: p.productId, rank: i + 1 })}>
                        View at {p.retailer}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
