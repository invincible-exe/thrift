"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Modal from "./ui/Modal";
import { useShop } from "@/context/ShopContext";
import { useAuth } from "@/context/AuthContext";
import { PAYMENT_METHODS } from "@/lib/payments";
import { formatKes } from "@/lib/format";
import { MPESA_PHONE_REGEX } from "@/lib/constants";
import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import SuccessBurst from "./ui/SuccessBurst";
import FeedbackRating from "./ui/FeedbackRating";
import type { PaymentMethodId, Product } from "@/lib/types";

type Phase = "idle" | "processing" | "waiting" | "success" | "error";

function normalizePhone(phone: string): string {
  return phone.replace(/\s/g, "").replace(/^0/, "254").replace(/^\+/, "");
}

/**
 * Checkout is fully server-driven (Paystack):
 *  1. The server identifies the buyer from their session, validates the
 *     product + price against the DB, records the pending order, and starts
 *     the payment (POST /api/payments/initiate).
 *  2. M-Pesa → an STK push goes to the phone; the webhook finalizes the
 *     order. Card → the buyer is redirected to Paystack's secure page and
 *     lands back on the card callback, which verifies + finalizes.
 * This modal just drives the UI and watches the live order via Realtime.
 */
export default function CheckoutModal() {
  const { checkoutProduct, closeCheckout } = useShop();

  return (
    <Modal open={Boolean(checkoutProduct)} onClose={closeCheckout} label="Checkout">
      {checkoutProduct && (
        <CheckoutPanel key={checkoutProduct.id} product={checkoutProduct} onClose={closeCheckout} />
      )}
    </Modal>
  );
}

function CheckoutPanel({ product, onClose }: { product: Product; onClose: () => void }) {
  const { showToast } = useShop();
  const { user } = useAuth();

  const [method, setMethod] = useState<PaymentMethodId>("mpesa");
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [providerRef, setProviderRef] = useState("");
  const [liveOrderId, setLiveOrderId] = useState<string | null>(null);
  const [rated, setRated] = useState(false);

  // Auto-close shortly after a successful purchase — but only once the
  // buyer has rated their experience, so the rating card is actually seen.
  useEffect(() => {
    if (phase === "success" && rated) {
      const t = setTimeout(onClose, 1600);
      return () => clearTimeout(t);
    }
  }, [phase, rated, onClose]);

  // Fallback: never trap the buyer. If they skip the rating, still close the
  // modal after a generous window (backdrop/Esc also work).
  useEffect(() => {
    if (phase !== "success") return;
    const t = setTimeout(onClose, 30000);
    return () => clearTimeout(t);
  }, [phase, onClose]);

  // Live payment: watch the server-created order until it's finalized by the
  // webhook (real-time postgres_changes).
  useEffect(() => {
    if (!liveOrderId) return;
    const client = getBrowserClient();
    if (!client) return;
    let active = true;

    const handleRow = (row: Record<string, unknown>) => {
      if (row.status === "completed") {
        setProviderRef(String(row.provider_ref ?? row.mpesa_receipt ?? ""));
        setPhase("success");
        showToast("Piece secured, it's yours 🎉");
      } else if (row.status === "failed") {
        setPhase("error");
        setMessage(String(row.failure_reason ?? "The payment failed or was cancelled."));
        setLiveOrderId(null);
      }
    };

    client
      .from("orders")
      .select("*")
      .eq("id", liveOrderId)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) handleRow(data as unknown as Record<string, unknown>);
      });

    const channel = client
      .channel(`order-${liveOrderId}:${Date.now().toString(36)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${liveOrderId}` },
        (payload) => {
          if (active) handleRow(payload.new as Record<string, unknown>);
        }
      )
      .subscribe();

    return () => {
      active = false;
      client.removeChannel(channel);
    };
  }, [liveOrderId, showToast]);

  // Time out a live M-Pesa wait (STK push expires after ~2 min).
  useEffect(() => {
    if (phase !== "waiting") return;
    const t = setTimeout(() => {
      setPhase("error");
      setMessage("No confirmation yet. Check your phone for the STK push, then try again.");
      setLiveOrderId(null);
    }, 150000);
    return () => clearTimeout(t);
  }, [phase]);

  const handleClose = () => {
    if (phase === "processing" || phase === "waiting") return;
    onClose();
  };

  const FRIENDLY_ERRORS: Record<string, string> = {
    PIECE_SOLD: "Someone just grabbed this piece. Keep scrolling — new drops land weekly.",
    PIECE_BEING_CHECKED_OUT: "Someone is already checking this piece out. Try again shortly.",
    CANNOT_BUY_OWN: "You can't buy your own piece.",
    AUTH_REQUIRED: "Please sign in again, then retry the checkout.",
    INVALID_PHONE: "Enter a valid M-Pesa number, e.g. 0712 345 678.",
    PAYMENT_KEYS_MISSING: "Checkout is paused while payments are being configured. Please try again later.",
    PAYMENT_PROVIDER_ERROR: "The payment couldn't be started. Try again.",
  };

  const friendlyError = (data: { error?: string; message?: string }) =>
    (data.error ? FRIENDLY_ERRORS[data.error] : undefined) ??
    data.message ??
    "The payment couldn't be started. Try again.";

  async function handlePay() {
    if (!user || phase === "processing" || phase === "waiting") return;
    if (!isSupabaseConfigured) {
      setPhase("error");
      setMessage("Connect Supabase to enable checkout. See the README for setup.");
      return;
    }
    // Sellers can't buy their own pieces — also enforced server-side, but
    // a saved checkout intent (surviving an OAuth round-trip) could land
    // here with the user now signed in as the piece's owner.
    if (product.sellerId && product.sellerId === user.id) {
      setPhase("error");
      setMessage("You can't buy your own piece.");
      return;
    }

    if (method === "mpesa") {
      const normalized = normalizePhone(phone);
      if (!MPESA_PHONE_REGEX.test(normalized)) {
        setPhase("error");
        setMessage("Enter a valid M-Pesa number, e.g. 0712 345 678.");
        return;
      }
      setPhase("processing");
      setMessage("");
      try {
        const res = await fetch("/api/payments/initiate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "mpesa", phone: normalized, productId: product.id }),
        });
        const data = await res.json();
        if (res.ok && data.orderId && data.kind === "stk") {
          setLiveOrderId(data.orderId);
          setPhase("waiting");
          return;
        }
        setPhase("error");
        setMessage(friendlyError(data as { error?: string; message?: string }));
      } catch {
        setPhase("error");
        setMessage("Something went wrong starting the payment. Try again.");
      }
      return;
    }

    // Card: the server initializes the Paystack checkout; we send the buyer
    // there and the card callback (which verifies + finalizes) brings them
    // back to the store with ?paid=1.
    setPhase("processing");
    setMessage("");
    try {
      const res = await fetch("/api/payments/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "card", productId: product.id }),
      });
      const data = await res.json();
      if (res.ok && data.kind === "redirect" && data.authorizationUrl) {
        window.location.href = String(data.authorizationUrl);
        return;
      }
      setPhase("error");
      setMessage(friendlyError(data as { error?: string; message?: string }));
    } catch {
      setPhase("error");
      setMessage("Something went wrong starting the payment. Try again.");
    }
  }

  const busy = phase === "processing" || phase === "waiting";

  return (
    <div className="p-6 sm:p-8">
      {phase === "success" ? (
        <div className="relative">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-5 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-soft transition hover:bg-sand hover:text-ink"
          >
            ✕
          </button>
          <SuccessBurst product={product} providerRef={providerRef} />
          <div className="mt-2 pb-2">
            <FeedbackRating orderId={liveOrderId} onSubmitted={() => setRated(true)} />
          </div>
        </div>
      ) : (
        <>
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-black tracking-tight">Checkout</h2>
              <p className="mt-1 text-sm text-ink-soft">1-of-1 piece. First payment wins.</p>
            </div>
            <button
              onClick={handleClose}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-soft transition hover:bg-sand hover:text-ink"
            >
              ✕
            </button>
          </div>

          <div className="mb-6 flex items-center gap-4 rounded-2xl border border-line bg-sand/60 p-3">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-sand">
              <Image src={product.imageUrl} alt={product.title} fill sizes="64px" className="object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-bold">{product.title}</p>
              <p className="text-xs text-ink-soft">
                {product.brand} · {product.size} · {product.condition}
              </p>
              <p className="mt-0.5 font-display text-lg font-extrabold">{formatKes(product.priceKes)}</p>
            </div>
          </div>

          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-ink-soft">Pay with</p>
          <div className="mb-5 grid grid-cols-2 gap-2.5">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMethod(m.id);
                  setMessage("");
                }}
                disabled={busy}
                aria-pressed={method === m.id}
                className={`rounded-2xl border-2 p-3.5 text-left transition disabled:opacity-60 ${
                  method === m.id
                    ? "border-ink bg-paper shadow-sm"
                    : "border-line bg-paper/60 hover:border-ink/40"
                }`}
              >
                <span className="text-xl">{m.id === "mpesa" ? "📱" : "💳"}</span>
                <p className="mt-1 font-display text-sm font-bold">{m.name}</p>
                <p className="text-[11px] leading-snug text-ink-soft">{m.description}</p>
              </button>
            ))}
          </div>

          {method === "mpesa" && (
            <div className="mb-5">
              <label
                htmlFor="mpesa-phone"
                className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-ink-soft"
              >
                M-Pesa number
              </label>
              <input
                id="mpesa-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0712 345 678"
                inputMode="tel"
                disabled={busy}
                className="w-full rounded-2xl border border-line bg-paper px-4 py-3 text-sm outline-none transition focus:border-ink disabled:opacity-60"
              />
              <p className="mt-1.5 text-xs text-ink-soft">
                We&apos;ll send an STK push to this number for {formatKes(product.priceKes)}.
              </p>
            </div>
          )}

          {phase === "waiting" && (
            <div className="mb-5 rounded-2xl border border-line bg-sand/60 p-5 text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-ink/20 border-t-accent" />
              </span>
              <p className="mt-3 font-display text-base font-bold">STK push sent</p>
              <p className="mt-1 text-sm text-ink-soft">
                Approve the payment on your phone for{" "}
                <span className="font-bold">{formatKes(product.priceKes)}</span>. This page updates
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
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-4 text-sm font-bold uppercase tracking-wider text-white transition hover:bg-accent-deep disabled:opacity-60"
          >
            {phase === "processing" ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Processing {formatKes(product.priceKes)}…
              </>
            ) : phase === "waiting" ? (
              "Waiting for confirmation…"
            ) : (
              `Pay ${formatKes(product.priceKes)}`
            )}
          </button>
          <p className="mt-3 text-center text-xs text-ink-soft">
            {method === "mpesa"
              ? "M-Pesa STK push, secured server-side. Approve the prompt on your phone."
              : "You'll finish on Paystack's secure card page, then land back here."}
          </p>
        </>
      )}
    </div>
  );
}
