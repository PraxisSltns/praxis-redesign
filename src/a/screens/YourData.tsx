/**
 * What Praxis keeps in this browser, in plain words, with a way to delete the photos one by one and
 * everything at once. Reached from the menu and from Style DNA. Nothing here is sent anywhere.
 */
import { useState } from "react";
import { track } from "../../core/analytics";
import { AUTH_MODE } from "../../core/config";
import { deleteLocalData, wardrobeEntries, wardrobePhoto } from "../../core/data";
import { feedbackStore } from "../../core/feedback";
import { visibleTo } from "../../core/account";
import { anonymousId, resetIdentityCache } from "../../core/identity";
import { deleteImages, withdrawConsent } from "../../core/images";
import { requestHistory } from "../../core/service";
import { readTryOnPhoto, writeTryOnPhoto } from "../../core/tryon";
import { useJourney } from "../lib/journeyContext";
import { Link } from "react-router-dom";
import { PrimaryButton, TextButton } from "../ui/controls";
import { TopBar } from "../ui/TopBar";

function Line({ label, value, action }: { label: string; value: string; action?: React.ReactNode }) {
  return (
    <div className="a-piece" role="listitem">
      <span>
        <span className="block text-[15px] leading-6">{label}</span>
        <span className="block text-[13px] leading-5 text-[var(--muted)]">{value}</span>
      </span>
      {action ?? <span />}
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function YourData() {
  const { href, store, faceImage, setFaceImage, ownedItem, setOwnedItem, base, user } = useJourney();
  const [confirming, setConfirming] = useState(false);
  const [tryOnPhoto, setTryOnPhoto] = useState(() => readTryOnPhoto());
  // Only what belongs to the person here is counted; another account's records stay out of view.
  const anon = anonymousId();
  const mine = (owner: { anonymousSessionId: string; userId?: string }) => visibleTo({ owner }, user?.id, anon);
  const wardrobe = wardrobeEntries().filter((e) => mine(e.owner));
  const feedback = feedbackStore.all().filter((r) => mine(r));
  const history = requestHistory.all().filter((e) => mine(e.request));
  const [hasPiecePhotos, setHasPiecePhotos] = useState(() => wardrobe.some((e) => wardrobePhoto(e.wardrobeItemId)));

  const deletePhoto = (which: "face" | "item" | "tryon") => {
    if (which === "tryon") {
      writeTryOnPhoto(null);
      setTryOnPhoto(null);
      track("photo_deleted", { category: "try_on" });
    } else if (which === "face") {
      setFaceImage(null);
      deleteImages("face_colour");
      track("photo_deleted", { category: "face_colour" });
    } else {
      if (ownedItem) setOwnedItem({ ...ownedItem, image: null });
      deleteImages("wardrobe_garment");
      setHasPiecePhotos(false);
      track("photo_deleted", { category: "wardrobe_garment" });
    }
  };

  const deleteAll = () => {
    withdrawConsent("face_colour");
    withdrawConsent("wardrobe_garment");
    withdrawConsent("try_on");
    deleteLocalData();
    resetIdentityCache();
    // The first event of a clean slate, under a new anonymous id.
    track("local_data_deleted", {});
    window.location.assign(base || "/");
  };

  return (
    <div className="min-h-[100dvh] bg-[var(--bg)]">
      <TopBar back={href("")} />
      <main className="mx-auto flex max-w-[640px] flex-col gap-8 px-5 pb-16 pt-4 lg:px-10">
        <div>
          <h1 className="a-display">Your data on this device</h1>
          <p className="mt-4 max-w-[48ch] leading-6 text-[var(--muted)]">
            {AUTH_MODE === "magic-link" && user
              ? "Praxis keeps these in this browser. Your saved looks are also kept with your account, so they follow you when you sign in elsewhere. Photos stay in this tab and are gone when you close it."
              : "Praxis keeps these in this browser only. Nothing is sent to a server yet. Photos stay in this tab and are gone when you close it."}
          </p>
        </div>

        <div role="list">
          <Line label="Saved looks" value={store.looks.length ? plural(store.looks.length, "look", "looks") : "None"} />
          <Line label="Style DNA" value={store.dna ? "Saved, without your photo" : "None"} />
          <Line
            label="Pieces you own"
            value={wardrobe.length ? `${plural(wardrobe.length, "piece", "pieces")}, by name, type and colour` : "None"}
            action={wardrobe.length ? <Link to={href("wardrobe")} aria-label="Open your wardrobe" className="a-control a-tertiary">Open</Link> : undefined}
          />
          <Line label="Your feedback on looks" value={feedback.length ? plural(feedback.length, "note", "notes") : "None"} />
          <Line label="Looks you asked for" value={history.length ? `The last ${plural(history.length, "request", "requests")}, kept for 90 days` : "None"} />
          <Line
            label="Your Style DNA photo"
            value={faceImage ? "In this tab" : "None"}
            action={faceImage ? <TextButton onClick={() => deletePhoto("face")}>Delete</TextButton> : undefined}
          />
          <Line
            label="Your See it on me photo"
            value={tryOnPhoto ? "In this tab" : "None"}
            action={tryOnPhoto ? <TextButton onClick={() => deletePhoto("tryon")}>Delete</TextButton> : undefined}
          />
          <Line
            label="Photos of your pieces"
            value={ownedItem?.image || hasPiecePhotos ? "In this tab" : "None"}
            action={ownedItem?.image || hasPiecePhotos ? <TextButton onClick={() => deletePhoto("item")}>Delete</TextButton> : undefined}
          />
        </div>

        {confirming ? (
          <div className="flex flex-col gap-4 border-t border-[var(--rule)] pt-6">
            <p className="max-w-[44ch] leading-6">This deletes your saved looks, Style DNA, feedback, pieces and photos from this browser, and signs you out. It can’t be undone.</p>
            <div className="flex flex-wrap items-center gap-2">
              <PrimaryButton onClick={deleteAll}>Delete everything</PrimaryButton>
              <TextButton onClick={() => setConfirming(false)}>Keep it</TextButton>
            </div>
          </div>
        ) : (
          <div className="border-t border-[var(--rule)] pt-6">
            <TextButton className="-ml-2" onClick={() => setConfirming(true)}>
              Delete everything on this device
            </TextButton>
          </div>
        )}
      </main>
    </div>
  );
}
