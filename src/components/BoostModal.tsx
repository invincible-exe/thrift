"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Modal from "./ui/Modal";
import { useShop } from "@/context/ShopContext";
import { initiateBoost } from "@/lib/db";
import { formatDate, formatKes } from "@/lib/format";
import { BOOST_DURATION_DAYS, BOOST_PRICE_KES, MPESA_PHONE_REGEX } from "@/lib/constants";
import { useNow } from "@/lib/use-now";
import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Listing } from "@/lib/types";

type Phase = "idle" | "processing" | "waiting" | "success" | "error";

function normalizePhone(phone: string): string {
  return phone.replace(/\s/g, "").replace(/^0/, "254").replace(/^\+/, "");
}

/**
 * Self-serve boosted listings: the seller pays BOOST_PRICE_KES with the same
 * M-Pesa STK push used at checkout, and the piece is pinned to the top of the
 * feed for 7 days. The server validates ownership + pushes the STK; the
 * webhook flips the pending boost to paid (setting boost_expires_at) — this
 * modal just drives the UI and watches the boost row via Realtime.
 */
export default function BoostModal({
  listing,
  initialPhone,
  onClose,
}: {
  listing: Listing;
  initialPhone?: string;
  onClose: () => void;
}) {
  const { showToast } = useShop();
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [liveBoostId, setLiveBoostId] = useState<string | null>(null);

  const now = useNow();
  const alreadyBoosted =
    Boolean(listing.boostExpiresAt) && listing.boostExpiresAt!.getTime() > now;

  // Live M-Pesa: watch the server-created boost until the callback webhook
  // finalizes it (real-time postgres_changes), exactly like checkout.
  useEffect(() => {
    if (!liveBoostId) return;
    const client = getBrowserClient();
    if (!client) return;
    let active = true;

    const handleRow = (row: Record<string, unknown>) => {
      if (row.status === "paid") {
        setPhase("success");
        showToast("Piece boosted. It's pinned to the top of the feed ⚡");
      } else if (row.status === "failed") {
        setPhase("error");
        setMessage("The payment failed or was cancelled. You can try again.");
        setLiveBoostId(null);
      }
    };

    // Initial state — in case the webhook already finalized the boost.
    client
      .from("boosts")
      .select("*")
      .eq("id", liveBoostId)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) handleRow(data as unknown as Record<string, unknown>);
      });

    // Unique suffix: Supabase caches channels by name and StrictMode mounts
    // effects twice, so a fixed name could hit an already-subscribed channel.
    const channel = client
      .channel(`boost-${liveBoostId}:${Date.now().toString(36)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "boosts", filter: `id=eq.${liveBoostId}` },
        (payload) => {
          if (active) handleRow(payload.new as unknown as Record<string, unknown>);
        }
      )
      .subscribe();

    return () => {
      active = false;
      client.removeChannel(channel);
    };
  }, [liveBoostId, showToast]);

  // Time out a live M-Pesa wait (STK push expires after ~2 min).
  useEffect(() => {
    if (phase !== "waiting") return;
    const t = setTimeout(() => {
      setPhase("error");
      setMessage("No confirmation yet. Check your phone for the STK push, then try again.");
      setLiveBoostId(null);
    }, 150000);
    return () => clearTimeout(t);
  }, [phase]);

  const handleClose = () => {
    if (phase === "processing" || phase === "waiting") return;
    onClose();
  };

  const FRIENDLY_ERRORS: Record<string, string> = {
    NOT_YOUR_PIECE: "You can only boost pieces you listed.",
    PIECE_NOT_ACTIVE: "This piece is no longer live, so it can't be boosted.",
    BOOST_IN_FLIGHT: "A boost payment for this piece is already pending on your phone.",
    INVALID_PHONE: "Enter a valid M-Pesa number, e.g. 0712 345 678.",
    AUTH_REQUIRED: "Please sign in again, then retry.",
    PAYMENT_KEYS_MISSING: "Boosting is paused while payments are being configured. Try again later.",
    PAYMENT_PROVIDER_ERROR: "The boost payment couldn't be started. Try again.",
  };

  const friendlyError = (data: { error?: string; message?: string }) =>
    (data.error ? FRIENDLY_ERRORS[data.error] : undefined) ??
    data.message ??
    "The payment couldn't be started. Try again.";

  async function handlePay() {
    if (phase === "processing" || phase === "waiting") return;
    if (!isSupabaseConfigured) {
      setPhase("error");
      setMessage("Connect Supabase to enable boosts. See the README for setup.");
      return;
    }

    const normalized = normalizePhone(phone);
    if (!MPESA_PHONE_REGEX.test(normalized)) {
      setPhase("error");
      setMessage("Enter a valid M-Pesa number, e.g. 0712 345 678.");
      return;
    }

    setPhase("processing");
    setMessage("");

    // The server does everything: validates ownership + live status, pushes
    // the STK (or a dev-only simulation), and records the pending boost.
    // This modal then watches that row until the webhook flips it to paid.
    try {
      const { boostId } = await initiateBoost(listing.productId, normalized);
      setLiveBoostId(boostId);
      setPhase("waiting");
    } catch (err) {
      setPhase("error");
      // initiateBoost attaches the server's error code to the thrown Error,
      // so map by code first (friendly copy), then fall back to its message.
      const e = err as Error & { code?: string };
      setMessage(
        e?.code
          ? friendlyError({ error: e.code, message: e.message })
          : e?.message || "Something went wrong starting the payment. Try again."
      );
    }
  }

  const busy = phase === "processing" || phase === "waiting";

  return (
    <Modal open onClose={handleClose} label="Boost a piece">
      <div className="p-6 sm:p-8">
        {phase === "success" ? (
          <div className="flex flex-col items-center py-10 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-400 text-4xl">
              ⚡
            </span>
            <h2 className="mt-4 font-display text-3xl font-black">Piece boosted.</h2>
            <p className="mt-2 max-w-xs text-sm text-ink-soft">
              &ldquo;{listing.title}&rdquo; is pinned to the top of the feed for{" "}
              {BOOST_DURATION_DAYS} days. It&apos;ll carry a{" "}
              <span className="font-bold text-ink">Boosted</span> tag until then.
            </p>
            <button
              onClick={onClose}
              className="mt-6 rounded-full bg-ink px-7 py-3 text-sm font-bold text-cream transition hover:bg-black"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h2 className="font-display text-2xl font-black tracking-tight">Boost this piece</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {formatKes(BOOST_PRICE_KES)} pins it to the top of the feed for{" "}
                  {BOOST_DURATION_DAYS} days.
                </p>
              </div>
              <button
                onClick={handleClose}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-soft transition hover:bg-sand hover:text-ink"
              >
                ✕
              </button>
            </div>

            <div className="mb-5 flex items-center gap-4 rounded-2xl border border-line bg-sand/60 p-3">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-sand">
                <Image src={listing.imageUrl} alt={listing.title} fill sizes="64px" className="object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-base font-bold">{listing.title}</p>
                <p className="text-xs text-ink-soft">
                  {listing.brand} · {listing.size} · {formatKes(listing.priceKes)}
                </p>
                {alreadyBoosted && listing.boostExpiresAt ? (
                  <p className="mt-0.5 text-xs font-semibold text-ink">
                    Boosted until {formatDate(listing.boostExpiresAt)}. This payment extends it by{" "}
                    {BOOST_DURATION_DAYS} more days.
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-ink-soft">Top of the feed · &ldquo;Boosted ⚡&rdquo; tag</p>
                )}
              </div>
            </div>

            <div className="mb-5">
              <label
                htmlFor="boost-phone"
                className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-ink-soft"
              >
                M-Pesa number
              </label>
              <input
                id="boost-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0712 345 678"
                inputMode="tel"
                disabled={busy}
                className="w-full rounded-2xl border border-line bg-paper px-4 py-3 text-sm outline-none transition focus:border-ink disabled:opacity-60"
              />
              <p className="mt-1.5 text-xs text-ink-soft">
                We&apos;ll send an STK push to this number for {formatKes(BOOST_PRICE_KES)}.
              </p>
            </div>

            {phase === "waiting" && (
              <div className="mb-5 rounded-2xl border border-line bg-sand/60 p-5 text-center">
                <span className="mx-auto flex h-10 w-10 items-center justify-center">
                  <span className="h-8 w-8 animate-spin rounded-full border-2 border-ink/20 border-t-amber-400" />
                </span>
                <p className="mt-3 font-display text-base font-bold">STK push sent</p>
                <p className="mt-1 text-sm text-ink-soft">
                  Approve the payment on your phone for{" "}
                  <span className="font-bold">{formatKes(BOOST_PRICE_KES)}</span>. This page updates
                  automatically.
                </p>
              </div>
            )}

            {phase === "error" && (
              <p className="mb-5 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm font-medium">
                {message}
              </p>
            )}

            <button
              onClick={handlePay}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 py-4 text-sm font-bold uppercase tracking-wider text-ink transition hover:bg-amber-300 disabled:opacity-60"
            >
              {phase === "processing" ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
                  Processing {formatKes(BOOST_PRICE_KES)}…
                </>
              ) : phase === "waiting" ? (
                "Waiting for confirmation…"
              ) : (
                `Pay ${formatKes(BOOST_PRICE_KES)} to boost`
              )}
            </button>
            <p className="mt-3 text-center text-xs text-ink-soft">
              M-Pesa STK push, secured server-side. Approve the prompt on your phone.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
