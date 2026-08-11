"use client";

import { useState } from "react";
import Modal from "./ui/Modal";
import LocationPicker from "./LocationPicker";
import { updateProfileLocation, useProfileLocation } from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { useShop } from "@/context/ShopContext";
import type { Location } from "@/lib/types";

/**
 * Post-sign-in area prompt. The moment a user is signed in and hasn't set
 * the area they live in (profiles.location_id unset), this modal appears and
 * invites them to pick one — so the feed can suggest pieces meeting nearby.
 *
 * - Reuses the same county → area picker as the Sell flow and My Account.
 * - "Not now" silences it for the rest of the session (sessionStorage), but
 *   it returns next session until the area is actually set — it's the only
 *   thing powering "Near you", so it deserves a second ask.
 * - Saving updates the profile row, which the realtime profiles subscription
 *   (0012_profiles_realtime.sql) pushes straight into the open feed.
 */
const DISMISS_KEY = "thrift-location-prompt-dismissed";

export default function LocationOnboarding() {
  const { user } = useAuth();
  const {
    authOpen,
    checkoutProduct,
    sellOpen,
    locationPromptOpen,
    closeLocationPrompt,
    showToast,
  } = useShop();
  const uid = user?.id ?? null;
  // null = still loading, "" = loaded and unset, else the chosen location id.
  const profileLocationId = useProfileLocation(uid);

  // Dismissed this session? Seeded once from sessionStorage (safe: Modal
  // renders nothing before mount, so no hydration mismatch).
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1"
  );

  const [loc, setLoc] = useState<Location | null>(null);
  const [saving, setSaving] = useState(false);
  // True once the save succeeds — closes the modal immediately, without
  // waiting on the realtime round-trip (which also keeps the feed in sync).
  const [saved, setSaved] = useState(false);

  // Show only once the profile row has actually loaded (profileLocationId
  // === "") — never while it's null (loading) — and never on top of the
  // auth/checkout/sell modals, which can legitimately open right after login
  // (e.g. a sign-in intent that drains into the checkout modal).
  const needsLocation =
    Boolean(user && profileLocationId === "" && !dismissed && !saved && !authOpen && !checkoutProduct && !sellOpen);

  // The feed's "Set my area" card opens the same prompt on demand — that
  // explicit request bypasses the session-dismiss flag.
  const open = needsLocation || locationPromptOpen;

  const close = () => {
    if (typeof window !== "undefined") sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
    closeLocationPrompt();
  };

  const save = async () => {
    if (!uid || !loc || saving) return;
    setSaving(true);
    try {
      await updateProfileLocation(uid, loc.id);
      setSaved(true);
      closeLocationPrompt();
      showToast(`Done — pieces near ${loc.city} will surface first.`);
      // If the feed is visible underneath, glide down to the new
      // "Near you — {county}" section once it renders.
      setTimeout(() => {
        document.getElementById("near-you")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 600);
    } catch {
      showToast("Couldn't save your area. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={close} label="Where do you live?">
      <div className="p-4 sm:p-6">
        <div className="mb-5 rounded-2xl bg-gradient-to-br from-accent via-amber-500 to-lime p-[1px]">
          <div className="rounded-2xl bg-paper px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-widest text-accent">
              📍 One quick thing
            </p>
            <h3 className="mt-1 font-display text-2xl font-black tracking-tight">
              Where do you live?
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">
              Tell us your area and we&apos;ll surface pieces meeting near you —
              same county first, your exact area at the top of the rack.
            </p>
          </div>
        </div>

        <LocationPicker value={null} onChange={setLoc} />

        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={save}
            disabled={!loc || saving}
            className="rounded-full bg-ink px-6 py-3 text-sm font-bold uppercase tracking-wider text-cream transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? (
              <span className="mx-auto block h-4 w-4 animate-spin rounded-full border-2 border-cream/30 border-t-cream" />
            ) : loc ? (
              `Save ${loc.city}${loc.area ? ` · ${loc.area}` : ""}`
            ) : (
              "Pick your county to continue"
            )}
          </button>
          <button
            onClick={close}
            className="rounded-full border border-line px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-ink-soft transition hover:border-ink hover:text-ink"
          >
            Not now
          </button>
          <p className="mt-1 text-center text-[11px] text-ink-soft">
            You can change this anytime in My Account.
          </p>
        </div>
      </div>
    </Modal>
  );
}
