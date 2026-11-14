/**
 * The wardrobe: the pieces the customer owns, kept on this device by name, type and colour, with a
 * photo only in this tab. Pieces can be added, corrected and removed here, and used in a set of looks
 * (here when the looks are open, or from Make it yours on the results). A photo's main colour is read
 * on the device to fill in the colour; the customer says what the piece is, and can change the colour.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { RECORDS_SYNCED } from "../../core/accountRecords";
import { track } from "../../core/analytics";
import { visibleTo } from "../../core/account";
import { forgetWardrobeItem, rememberWardrobeItem, setWardrobePhoto, updateWardrobeItem, wardrobeEntries, wardrobePhoto, type WardrobeEntry } from "../../core/data";
import { anonymousId } from "../../core/identity";
import { shortHash } from "../../core/ids";
import { NAMED } from "../../core/colour";
import { consentFor, IMAGE_POLICIES } from "../../core/images";
import { wardrobeRef } from "../../core/request";
import { imageServices } from "../../core/vision";
import { useJourney, type Slot } from "../lib/journeyContext";
import { fileToDataUrl, imageStats, shrinkImage } from "../lib/image";
import { SLOT_LABEL } from "../lib/looks";
import { ChoiceList, Field, PrimaryButton, TextButton } from "../ui/controls";
import { PhotoConsent, problemText, rejectFile, rejectImage } from "../ui/PhotoConsent";
import { TopBar } from "../ui/TopBar";

const SLOT_OPTIONS = (Object.keys(SLOT_LABEL) as Slot[]).map((id) => ({ id, label: SLOT_LABEL[id] }));

/** "Top, navy" under a piece's name; an example piece says so. */
export function pieceLine(e: Pick<WardrobeEntry, "slot" | "colour" | "source">): string {
  return [SLOT_LABEL[e.slot], e.colour?.toLowerCase(), e.source === "sample" ? "an example" : null].filter(Boolean).join(", ");
}

/** The piece's picture: its photo while this tab has it, else a swatch of its colour, so every piece has a face. */
function PieceTile({ photo, label, colour }: { photo: string | null; label: string; colour?: string }) {
  if (photo) return <img src={photo} alt={`Your photo of ${label}`} className="a-piece-tile object-cover" />;
  const named = colour ? NAMED.find((n) => n.name.toLowerCase() === colour.toLowerCase()) : undefined;
  return <span aria-hidden="true" className="a-piece-tile" style={named ? { background: `rgb(${named.rgb.join(" ")})` } : undefined} />;
}

const defaultName = (slot: Slot) => `Your own ${SLOT_LABEL[slot].toLowerCase()}`;

interface Draft {
  slot: Slot | null;
  label: string;
  colour: string;
  photo: string | null;
}

/** Adding a piece, or correcting one. A photo can only be added with a new piece. */
function PieceForm({ initial, editing, onSave, onCancel }: { initial: Draft; editing: boolean; onSave: (d: Draft) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const prefix = editing ? "edit" : "add";

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const refused = rejectFile(file, "wardrobe_garment");
    if (refused) return setError(problemText(refused));
    try {
      const original = await fileToDataUrl(file);
      const problem = await rejectImage(original, "wardrobe_garment");
      if (problem) return setError(problemText(problem));
      const photo = await shrinkImage(original);
      setReading(true);
      const stats = await imageStats(photo);
      // The recognition service may suggest the type and colour; the customer's own words always win.
      const seen = await imageServices().recogniseGarment({ ref: photo, category: "wardrobe_garment", width: stats.width, height: stats.height, consentVersion: IMAGE_POLICIES.wardrobe_garment.consentVersion });
      setReading(false);
      setDraft((d) => ({
        ...d,
        photo,
        slot: d.slot ?? (seen.slot?.source === "model" ? seen.slot.value : null),
        colour: d.colour || (seen.colour?.source === "model" ? seen.colour.value : ""),
      }));
    } catch {
      setReading(false);
      setError("I couldn’t read that photo. Try another one.");
    }
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.slot) return setError("Choose what kind of piece it is.");
        onSave(draft);
      }}
    >
      <div>
        <p className="a-label mb-3 text-[var(--muted)]">What kind of piece</p>
        <ChoiceList label="What kind of piece" options={SLOT_OPTIONS} value={draft.slot} columns={2} onChange={(slot) => (setError(null), setDraft((d) => ({ ...d, slot })))} />
      </div>
      <div className="flex flex-col gap-4 sm:flex-row">
        <Field id={`${prefix}-name`} label="What you call it" value={draft.label} onChange={(label) => setDraft((d) => ({ ...d, label }))} placeholder={draft.slot ? defaultName(draft.slot) : "Navy overshirt"} autoComplete="off" />
        <Field id={`${prefix}-colour`} label="Colour (optional)" value={draft.colour} onChange={(colour) => setDraft((d) => ({ ...d, colour }))} placeholder="Navy" autoComplete="off" />
      </div>

      {!editing && (
        <div className="flex flex-col gap-3">
          {draft.photo ? (
            <div className="flex items-center gap-4">
              <img src={draft.photo} alt="Your photo of the piece" className="h-20 w-20 object-cover" style={{ borderRadius: 2 }} />
              <TextButton onClick={() => setDraft((d) => ({ ...d, photo: null }))}>Remove photo</TextButton>
            </div>
          ) : asking ? (
            <PhotoConsent
              category="wardrobe_garment"
              declineLabel="Add it without a photo"
              onAgree={() => {
                setAsking(false);
                fileRef.current?.click();
              }}
              onDecline={() => setAsking(false)}
            />
          ) : (
            <TextButton className="-ml-2 self-start" onClick={() => (consentFor("wardrobe_garment") ? fileRef.current?.click() : setAsking(true))}>
              Add a photo (optional)
            </TextButton>
          )}
          {reading && <p className="text-[13px] leading-5 text-[var(--muted)]">Looking at the photo…</p>}
          <p className="max-w-[48ch] text-[13px] leading-5 text-[var(--muted)]">With a photo, I fill in the colour, read here on your device. You tell me what the piece is. The photo stays in this tab.</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="sr-only"
            tabIndex={-1}
            aria-label="Upload a photo of the piece"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-[15px] text-[var(--error)]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton type="submit" disabled={reading}>
          {editing ? "Save changes" : "Add to my wardrobe"}
        </PrimaryButton>
        <TextButton onClick={onCancel}>Cancel</TextButton>
      </div>
    </form>
  );
}

export function Wardrobe() {
  const { href, go, user, answers, setOwnedItem } = useJourney();
  const anon = anonymousId();
  const [version, setVersion] = useState(0);
  /* A sync with the account brought pieces added, changed or removed on another device. */
  useEffect(() => {
    const onSynced = () => setVersion((v) => v + 1);
    window.addEventListener(RECORDS_SYNCED, onSynced);
    return () => window.removeEventListener(RECORDS_SYNCED, onSynced);
  }, []);
  const pieces = useMemo(() => wardrobeEntries().filter((e) => visibleTo({ owner: e.owner }, user?.id, anon)), [version, user?.id, anon]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [removed, setRemoved] = useState<WardrobeEntry | null>(null);
  const [failed, setFailed] = useState(false);
  /* Came here from a set of looks: a piece can go straight into them. */
  const fromLooks = Boolean(answers.occasion && answers.venue && answers.time && answers.vibe && answers.spend);
  const refresh = (ok: boolean) => {
    setFailed(!ok);
    setVersion((v) => v + 1);
  };

  const add = (d: Draft) => {
    if (!d.slot) return;
    const label = d.label.trim() || defaultName(d.slot);
    const ref = wardrobeRef(d.slot, label, d.photo ? "upload" : "described", d.photo ? shortHash(d.photo) : new Date().toISOString());
    if (d.colour.trim()) ref.colour = d.colour.trim().slice(0, 30);
    rememberWardrobeItem({ ...ref, label: label.slice(0, 60) }, { anonymousSessionId: anon, userId: user?.id });
    if (d.photo) setWardrobePhoto(ref.wardrobeItemId, d.photo);
    track("wardrobe_item_added", { slot: d.slot, source: d.photo ? "upload" : "described", surface: "wardrobe" });
    setAdding(false);
    refresh(wardrobeEntries().some((e) => e.wardrobeItemId === ref.wardrobeItemId));
  };

  const save = (e: WardrobeEntry, d: Draft) => {
    const next = updateWardrobeItem(e.wardrobeItemId, { label: d.label, slot: d.slot ?? e.slot, colour: d.colour });
    if (next) track("wardrobe_item_edited", { slot: next.slot });
    setEditing(null);
    refresh(Boolean(next));
  };

  const remove = (e: WardrobeEntry) => {
    const ok = forgetWardrobeItem(e.wardrobeItemId);
    if (ok) track("wardrobe_item_removed", { slot: e.slot });
    setRemoved(ok ? e : null);
    refresh(ok);
  };

  const undo = () => {
    if (!removed) return;
    const { addedAt: _a, updatedAt: _u, owner, ...ref } = removed;
    rememberWardrobeItem(ref, owner);
    setRemoved(null);
    refresh(true);
  };

  const use = (e: WardrobeEntry) => {
    setOwnedItem({ slot: e.slot, name: e.label, image: wardrobePhoto(e.wardrobeItemId), wardrobeItemId: e.wardrobeItemId, source: e.source, colour: e.colour });
    track("wardrobe_item_used", { slot: e.slot });
    go("moment/build", { item: e.slot, hero: null });
  };

  return (
    <div className="min-h-[100dvh] bg-[var(--bg)]">
      <TopBar back={fromLooks ? href("moment/results", { hero: null }) : href("")} />
      <main className="mx-auto flex max-w-[640px] flex-col gap-8 px-5 pb-16 pt-4 lg:px-10">
        <div>
          <h1 className="a-display">Your wardrobe</h1>
          <p className="mt-4 max-w-[48ch] leading-6 text-[var(--muted)]">The pieces you own. I build looks around them and never price them.</p>
          <p className="mt-2 max-w-[48ch] text-[13px] leading-5 text-[var(--muted)]">
            {user ? "Kept under your name on this device" : "No account needed. Kept on this device"}; a photo stays in this tab only.{!fromLooks && pieces.length > 0 ? " To style one, choose a moment, then Use something I own." : ""}
          </p>
        </div>

        {!adding && (
          <div>
            <PrimaryButton onClick={() => (setEditing(null), setRemoved(null), setAdding(true))}>Add a piece</PrimaryButton>
          </div>
        )}
        {adding && (
          <section aria-label="Add a piece" className="border-t border-[var(--rule)] pt-6">
            <h2 className="mb-6 text-[17px] leading-6">Add a piece</h2>
            <PieceForm editing={false} initial={{ slot: null, label: "", colour: "", photo: null }} onSave={add} onCancel={() => setAdding(false)} />
          </section>
        )}

        {pieces.length > 0 ? (
          <ul aria-label="Pieces you own" className="border-t border-[var(--rule)]">
            {pieces.map((e) => {
              const photo = wardrobePhoto(e.wardrobeItemId);
              return (
                <li key={e.wardrobeItemId} className="border-b border-[var(--rule)] py-4">
                  {editing === e.wardrobeItemId ? (
                    <PieceForm editing initial={{ slot: e.slot, label: e.label, colour: e.colour ?? "", photo: null }} onSave={(d) => save(e, d)} onCancel={() => setEditing(null)} />
                  ) : (
                    <>
                      <div className="flex items-center gap-4">
                        <PieceTile photo={photo} label={e.label} colour={e.colour} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[17px] leading-6">{e.label}</p>
                          <p className="text-[13px] leading-5 text-[var(--muted)]">{pieceLine(e)}</p>
                        </div>
                      </div>
                      <div className="-ml-2 mt-1 flex flex-wrap items-center">
                        {fromLooks && (
                          <TextButton onClick={() => use(e)} aria-label={`Use ${e.label} in my looks`} style={{ color: "var(--text)" }}>
                            Use in my looks
                          </TextButton>
                        )}
                        <TextButton onClick={() => (setAdding(false), setEditing(e.wardrobeItemId))} aria-label={`Edit ${e.label}`}>
                          Edit
                        </TextButton>
                        <TextButton onClick={() => remove(e)} aria-label={`Remove ${e.label}`}>
                          Remove
                        </TextButton>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          !adding && <p className="max-w-[44ch] leading-6">Nothing here yet. Add the pieces you own and I’ll build looks around them.</p>
        )}

        {removed && (
          <p role="status" className="-mt-4 flex flex-wrap items-center gap-2 text-[15px]">
            {removed.label} removed.
            <TextButton onClick={undo}>Undo</TextButton>
          </p>
        )}
        {failed && (
          <p role="alert" className="-mt-4 text-[15px] text-[var(--error)]">
            I couldn’t save that on this device. Storage may be full or blocked.
          </p>
        )}
      </main>
    </div>
  );
}
