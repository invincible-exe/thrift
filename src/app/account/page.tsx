"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useAuth } from "@/context/AuthContext";
import { useShop } from "@/context/ShopContext";
import {
  cancelOrderNoShow,
  confirmOrderReceipt,
  dispatchPendingPayouts,
  disputeOrder,
  fetchBanks,
  hasRatedOrder,
  releaseExpiredEscrow,
  reportPayoutMissing,
  updatePayoutSettings,
  updateProfileLocation,
  updateProfilePhone,
  usePayoutSettings,
  useProfileLocation,
  useProfilePhone,
  useUserListings,
  useUserOrders,
  useUserPayouts,
  useUserPayoutReports,
} from "@/lib/db";
import { formatDate, formatKes } from "@/lib/format";
import { BOOST_PRICE_KES, NO_SHOW_WINDOW_MS, PLATFORM_WALLET } from "@/lib/constants";
import { useIsAdmin } from "@/lib/admin";
import BoostModal from "@/components/BoostModal";
import LocationPicker from "@/components/LocationPicker";
import MeetupSafety from "@/components/MeetupSafety";
import OrderChat from "@/components/OrderChat";
import FeedbackRating from "@/components/ui/FeedbackRating";
import { useNow } from "@/lib/use-now";
import type { Listing, Location, Order, Payout } from "@/lib/types";
import Link from "next/link";

const METHOD_LABEL: Record<string, string> = {
  mpesa: "M-Pesa",
  card: "Card",
  bank: "Bank transfer",
};

function SignedOut() {
  const { openAuth } = useShop();
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <span className="text-5xl">👋</span>
      <h1 className="mt-4 font-display text-3xl font-black tracking-tight sm:text-4xl">
        Your drops, in one place
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
        Sign in to track your purchases, manage listings, and see what you&apos;ve
        earned selling on 10/10.
      </p>
      <button
        onClick={openAuth}
        className="mt-8 rounded-full bg-accent px-8 py-3.5 text-sm font-bold uppercase tracking-wider text-white transition hover:bg-accent-deep"
      >
        Sign in to continue
      </button>
    </section>
  );
}

function SignedIn() {
  const { user } = useAuth();
  const { showToast, openSell } = useShop();
  const uid = user?.id ?? null;
  const { isAdmin } = useIsAdmin(uid);

  const orders = useUserOrders(uid);
  const listings = useUserListings(uid);
  const payouts = useUserPayouts(uid);
  const payoutReports = useUserPayoutReports(uid);
  const phone = useProfilePhone(uid);
  // Draft stays null until the user types, so we never sync server state
  // inside an effect (avoids a stale write racing the async phone fetch).
  const [phoneDraft, setPhoneDraft] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<{ id: string; text: string } | null>(null);
  const [boostTarget, setBoostTarget] = useState<Listing | null>(null);
  const now = useNow();
  const profileLocationId = useProfileLocation(uid);
  const phoneValue = phoneDraft ?? phone ?? "";

  const saveArea = async (loc: Location | null) => {
    if (!uid) return;
    try {
      await updateProfileLocation(uid, loc?.id ?? null);
      showToast(loc ? "Area saved — nearby pieces will surface." : "Area cleared.");
    } catch {
      showToast("Couldn't save your area. Try again.");
    }
  };

  // Sweep the 24h auto-resolve on load: any escrow whose window elapsed
  // flips to pending and is auto-paid. Safe for any user to trigger.
  useEffect(() => {
    if (!uid) return;
    void releaseExpiredEscrow().catch(() => {});
  }, [uid]);

  const confirmReceipt = async (orderId: string) => {
    if (confirmingId) return;
    setConfirmingId(orderId);
    setConfirmMsg(null);
    try {
      const released = await confirmOrderReceipt(orderId);
      // The seller's payout is now 'pending' — push it out immediately instead
      // of waiting for the next escrow sweep to notice it.
      void dispatchPendingPayouts().catch(() => {});
      setConfirmMsg({
        id: orderId,
        text:
          released > 0
            ? "Thanks! The seller's payout has been released. ✓"
            : "Thanks for confirming — nothing was held on this order.",
      });
    } catch (e) {
      setConfirmMsg({
        id: orderId,
        text: e instanceof Error ? e.message : "Couldn't confirm receipt. Try again.",
      });
    } finally {
      setConfirmingId(null);
    }
  };

  const savePhone = async (phone: string) => {
    if (!uid) return;
    await updateProfilePhone(uid, phone.trim());
  };

  const boostedUntil = (l: Listing): Date | undefined =>
    l.boostExpiresAt && l.boostExpiresAt.getTime() > now ? l.boostExpiresAt : undefined;

  const earned = (payouts ?? []).reduce((sum, p) => sum + p.amountKes, 0);
  const activeListings = (listings ?? []).filter((l) => l.status === "active").length;
  const initial = (user?.name || user?.email || "U").charAt(0).toUpperCase();

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-2 rounded-full border-2 border-ink px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition hover:bg-ink hover:text-cream"
      >
        ← Back to store
      </Link>
      {/* Profile card */}
      <div className="flex flex-col gap-5 rounded-3xl border border-line bg-paper p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-ink font-display text-2xl font-black text-cream">
            {initial}
          </span>
          <div>
            <h1 className="font-display text-2xl font-black">
              {user?.name || "Thrift head"}
            </h1>
            <p className="text-sm text-ink-soft">{user?.email}</p>
            <div className="mt-3 max-w-md">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-ink-soft">
                Payout details — where your earnings land
              </p>
              <PayoutDetails
                uid={uid}
                phoneValue={phoneValue}
                onPhoneChange={(v) => setPhoneDraft(v)}
                onSavePhone={savePhone}
              />
            </div>
            <div className="mt-3 max-w-sm">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-ink-soft">
                Your area — see pieces near you
              </p>
              <LocationPicker value={profileLocationId} onChange={saveArea} />
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="flex gap-6">
            <div>
              <p className="font-display text-2xl font-black">{formatKes(earned)}</p>
              <p className="text-xs uppercase tracking-widest text-ink-soft">Earned selling</p>
            </div>
            <div>
              <p className="font-display text-2xl font-black">{activeListings}</p>
              <p className="text-xs uppercase tracking-widest text-ink-soft">Live listings</p>
            </div>
          </div>
          {isAdmin && (
            <Link
              href="/admin"
              className="rounded-full border-2 border-ink px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition hover:bg-ink hover:text-cream"
            >
              Admin dashboard
            </Link>
          )}
        </div>
      </div>

      {/* Purchases */}
      <div className="mt-10">
        <h2 className="mb-4 font-display text-xl font-black">My purchases</h2>
        {orders && orders.length > 0 ? (
          <ul className="space-y-3">
            {orders.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                now={now}
                confirmingId={confirmingId}
                onConfirm={confirmReceipt}
                confirmMsg={confirmMsg}
              />
            ))}
          </ul>
        ) : orders !== null ? (
          <EmptyState text="No purchases yet. Go grab a 1-of-1." />
        ) : null}
      </div>

      {/* Closet — every piece you've added, in one rack */}
      <div id="closet" className="mt-12 scroll-mt-24">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-black">My closet</h2>
          <button
            onClick={openSell}
            className="rounded-full bg-ink px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-cream transition hover:bg-accent"
          >
            ＋ Sell a piece
          </button>
        </div>
        {listings && listings.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((l) => (
              <ClosetCard
                key={l.id}
                listing={l}
                boostedUntil={boostedUntil}
                onBoost={setBoostTarget}
              />
            ))}
          </ul>
        ) : listings !== null ? (
          <div className="rounded-2xl border border-dashed border-line bg-paper p-10 text-center">
            <p className="text-4xl">🧥</p>
            <p className="mx-auto mt-3 max-w-xs text-sm text-ink-soft">
              Your closet is empty. Add your first piece — it shows up here, then hits the feed
              once approved.
            </p>
            <button
              onClick={openSell}
              className="mt-5 rounded-full bg-ink px-6 py-3 text-sm font-bold uppercase tracking-wider text-cream transition hover:bg-accent"
            >
              Sell a piece
            </button>
          </div>
        ) : null}
      </div>

      {/* Payouts */}
      <div className="mt-10">
        <h2 className="mb-4 font-display text-xl font-black">Payouts</h2>
        {payouts && payouts.length > 0 ? (
          <ul className="space-y-3">
            {payouts.map((p) => (
              <PayoutRow
                key={p.id}
                payout={p}
                report={payoutReports?.find((r) => r.payoutId === p.id)}
              />
            ))}
          </ul>
        ) : payouts !== null ? (
          <EmptyState text="Nothing earned yet. Sales show up here." />
        ) : null}
        {!phoneValue && (
          <p className="mt-3 text-xs text-ink-soft">
            Add your M-Pesa number above so we can send your earnings.
          </p>
        )}
      </div>

      <p className="mt-10 text-center text-xs text-ink-soft">
        Wallet: <span className="font-mono font-bold">{PLATFORM_WALLET}</span> collects the
        platform commission · your share is sent via Paystack Transfers (M-Pesa or bank).
      </p>

      {boostTarget && (
        <BoostModal listing={boostTarget} initialPhone={phoneValue} onClose={() => setBoostTarget(null)} />
      )}
    </section>
  );
}

/**
 * Payout destination editor: M-Pesa (phone) or bank (Paystack bank code +
 * account number + name). Saving persists the method + details so the admin
 * payout flow pays the seller where they asked.
 */
function PayoutDetails({
  uid,
  phoneValue,
  onPhoneChange,
  onSavePhone,
}: {
  uid: string | null;
  phoneValue: string;
  onPhoneChange: (v: string) => void;
  onSavePhone: (phone: string) => Promise<void>;
}) {
  const { showToast } = useShop();
  const settings = usePayoutSettings(uid);
  const [method, setMethod] = useState<"mpesa" | "bank">("mpesa");
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [banks, setBanks] = useState<{ code: string; name: string }[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Seed the form from the profile once it loads (render-time adjustment).
  const [seed, setSeed] = useState("idle");
  const seedValue = settings ? "loaded" : "loading";
  if (seedValue !== seed) {
    setSeed(seedValue);
    if (settings) {
      setMethod(settings.payoutMethod);
      setBankCode(settings.bankCode);
      setAccountNumber(settings.bankAccountNumber);
      setAccountName(settings.bankAccountName);
    }
  }

  // Load the Paystack KES bank list lazily when bank mode is first opened.
  useEffect(() => {
    if (method !== "bank" || banks !== null) return;
    let active = true;
    void fetchBanks()
      .then((b) => {
        if (active) setBanks(b);
      })
      .catch(() => {
        if (active) setBanks([]);
      });
    return () => {
      active = false;
    };
  }, [method, banks]);

  const save = async () => {
    if (!uid || saving) return;
    if (method === "bank" && (!bankCode || !accountNumber.trim() || !accountName.trim())) {
      showToast("Add the bank, account number and account name.");
      return;
    }
    if (method === "mpesa" && !/^(\+?254|0)?7\d{8}$/.test(phoneValue.replace(/\s/g, ""))) {
      showToast("Add a valid M-Pesa payout number.");
      return;
    }
    setSaving(true);
    try {
      await Promise.all([
        updatePayoutSettings(uid, {
          payoutMethod: method,
          bankCode,
          bankAccountNumber: accountNumber,
          bankAccountName: accountName,
        }),
        method === "mpesa" ? onSavePhone(phoneValue) : Promise.resolve(),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      showToast("Couldn't save your payout details. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm outline-none transition focus:border-ink disabled:opacity-60";

  return (
    <div className="space-y-2.5 rounded-2xl border border-line bg-sand/40 p-3">
      <div className="grid grid-cols-2 gap-1 rounded-full border border-line bg-paper p-1">
        {(["mpesa", "bank"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={`rounded-full py-1.5 text-xs font-bold transition ${
              method === m ? "bg-ink text-cream shadow" : "text-ink-soft hover:text-ink"
            }`}
          >
            {m === "mpesa" ? "📱 M-Pesa" : "🏦 Bank"}
          </button>
        ))}
      </div>

      {method === "mpesa" ? (
        <input
          value={phoneValue}
          onChange={(e) => onPhoneChange(e.target.value)}
          placeholder="M-Pesa number for payouts"
          inputMode="tel"
          className={inputCls}
        />
      ) : (
        <>
          <select
            value={bankCode}
            onChange={(e) => setBankCode(e.target.value)}
            className={inputCls}
            disabled={banks === null}
          >
            <option value="">{banks === null ? "Loading banks…" : "Your bank"}</option>
            {(banks ?? []).map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="Account number"
            inputMode="numeric"
            className={inputCls}
          />
          <input
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Account name"
            className={inputCls}
          />
        </>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="w-full rounded-full bg-ink px-4 py-2 text-xs font-bold uppercase tracking-wider text-cream transition hover:bg-accent disabled:opacity-50"
      >
        {saving ? "Saving…" : saved ? "Saved ✓" : "Save payout details"}
      </button>
    </div>
  );
}

/** One payout row: shows receipt when paid, and a "never received it?"
 *  report form for any payout that hasn't landed yet. */
function PayoutRow({
  payout: p,
  report,
}: {
  payout: Payout;
  report?: { status: "open" | "resolved"; reason: string; adminNote?: string } | undefined;
}) {
  const { showToast } = useShop();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await reportPayoutMissing(p.id, reason.trim() || undefined);
      setReporting(false);
      setReason("");
      showToast("Report filed — the team is on it.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't file the report. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-2xl border border-line bg-paper p-4">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-extrabold">{formatKes(p.amountKes)}</p>
          <p className="text-xs text-ink-soft">{formatDate(p.createdAt)}</p>
          {p.status === "escrow" && (
            <p className="mt-0.5 text-xs text-ink-soft">
              🔒 Held in escrow until the buyer confirms delivery
              {p.escrowReleaseAt
                ? ` (auto-releases ${formatDate(p.escrowReleaseAt)})`
                : ""}.
            </p>
          )}
          {p.status === "paid" && p.paidAt && (
            <p className="mt-0.5 text-xs text-ink-soft">
              Received {formatDate(p.paidAt)}
              {p.providerRef ? ` · Receipt ${p.providerRef}` : ""}
            </p>
          )}
          {p.failureReason && <p className="mt-0.5 text-xs text-accent">{p.failureReason}</p>}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
            p.status === "paid"
              ? "bg-lime text-ink"
              : p.status === "failed"
                ? "bg-sand text-ink-soft"
                : p.status === "escrow"
                  ? "bg-accent-soft text-accent"
                  : "bg-sand text-ink-soft"
          }`}
        >
          {p.status === "paid"
            ? "Paid ✓"
            : p.status === "failed"
              ? "Failed"
              : p.status === "escrow"
                ? "Escrow 🔒"
                : p.status === "processing"
                  ? "Sending…"
                  : "Pending"}
        </span>
      </div>

      {/* Report status + file-a-report flow for anything not yet received.
          Escrow payouts haven't been sent yet, so they're not reportable. */}
      {p.status !== "failed" && p.status !== "escrow" && (
        <div className="mt-3 border-t border-line pt-3">
          {report?.status === "open" && (
            <p className="rounded-xl bg-accent-soft px-3 py-2 text-xs font-semibold text-accent">
              ⏳ Reported — we&apos;re looking into this payout.
            </p>
          )}
          {report?.status === "resolved" && (
            <p className="rounded-xl bg-lime/20 px-3 py-2 text-xs font-semibold text-ink">
              ✓ Report resolved
              {report.adminNote ? ` — ${report.adminNote}` : report.reason ? ` — ${report.reason}` : ""}.
            </p>
          )}
          {!report && !reporting && (
            <button
              onClick={() => setReporting(true)}
              className="text-xs font-bold text-accent underline-offset-2 transition hover:underline"
            >
              Didn&apos;t receive this? Report it
            </button>
          )}
          {reporting && !report && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Tell us what happened (optional)"
                disabled={busy}
                className="flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm outline-none transition focus:border-ink disabled:opacity-60"
              />
              <div className="flex gap-2">
                <button
                  onClick={submit}
                  disabled={busy}
                  className="shrink-0 rounded-full bg-ink px-4 py-2 text-xs font-bold text-cream transition hover:bg-accent disabled:opacity-50"
                >
                  {busy ? "Sending…" : "File report"}
                </button>
                <button
                  onClick={() => setReporting(false)}
                  disabled={busy}
                  className="shrink-0 rounded-full border border-line px-4 py-2 text-xs font-bold text-ink-soft transition hover:border-ink disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {error && <p className="mt-2 text-xs font-medium text-accent">{error}</p>}
        </div>
      )}
    </li>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-line bg-paper p-6 text-center text-sm text-ink-soft">
      {text}
    </p>
  );
}

/**
 * One piece in the seller's closet rack: cover photo, price, status, boost
 * state, and (once sold) the chat + meetup-safety toggles.
 */
function ClosetCard({
  listing: l,
  boostedUntil,
  onBoost,
}: {
  listing: Listing;
  boostedUntil: (l: Listing) => Date | undefined;
  onBoost: (l: Listing) => void;
}) {
  const boosted = boostedUntil(l);
  return (
    <li className="group overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="relative aspect-square overflow-hidden bg-sand">
        <Image
          src={l.imageUrl}
          alt={l.title}
          fill
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          quality={95}
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
        />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
              l.status === "sold"
                ? "bg-lime text-ink"
                : l.status === "pending"
                  ? "bg-accent-soft text-accent"
                  : "bg-paper/90 text-ink backdrop-blur"
            }`}
          >
            {l.status === "sold" ? "Sold ✓" : l.status === "pending" ? "Pending review" : "Live"}
          </span>
          {boosted && (
            <span
              title={`Pinned to the top of the feed until ${formatDate(boosted)}`}
              className="rounded-full bg-amber-400 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-ink"
            >
              Boosted ⚡
            </span>
          )}
        </div>
      </div>
      <div className="p-4">
        <p className="truncate font-display text-sm font-bold">{l.title}</p>
        <p className="mt-0.5 text-xs text-ink-soft">
          {l.brand} · {l.size} · Listed {formatDate(l.createdAt)}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <p className="whitespace-nowrap font-display text-base font-extrabold">{formatKes(l.priceKes)}</p>
          {l.status === "active" &&
            (boosted ? (
              <span className="text-[11px] font-bold text-ink-soft">Until {formatDate(boosted)}</span>
            ) : (
              <button
                onClick={() => onBoost(l)}
                className="rounded-full border border-ink px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition hover:bg-ink hover:text-cream"
              >
                Boost · {formatKes(BOOST_PRICE_KES)}
              </button>
            ))}
        </div>
        {l.status === "active" && l.locationLabel && (
          <p className="mt-1.5 text-[11px] text-ink-soft">📍 Meet near {l.locationLabel}</p>
        )}
        {l.status === "sold" && l.orderId && (
          <div className="mt-3 space-y-3 border-t border-line pt-3">
            <SellerChat orderId={l.orderId} />
            <SellerSafety orderId={l.orderId} />
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * One purchase with the full meetup flow: meeting point, buyer↔seller chat,
 * and the buyer's delivery actions (confirm received / file a dispute /
 * cancel a no-show after the seller's 24h window).
 */
function OrderCard({
  order,
  now,
  confirmingId,
  onConfirm,
  confirmMsg,
}: {
  order: Order;
  now: number;
  confirmingId: string | null;
  onConfirm: (id: string) => void;
  confirmMsg: { id: string; text: string } | null;
}) {
  const { showToast } = useShop();
  const { user } = useAuth();
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [ratedAlready, setRatedAlready] = useState<boolean | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [disputeMsg, setDisputeMsg] = useState<string | null>(null);
  const [cancelArm, setCancelArm] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelMsg, setCancelMsg] = useState<string | null>(null);

  const uid = user?.id ?? null;

  // Past purchases can be rated here even if the buyer skipped the checkout
  // success screen — check once whether they already rated this order.
  useEffect(() => {
    if (!uid) return;
    let active = true;
    hasRatedOrder(uid, order.id).then((yes) => {
      if (active) setRatedAlready(yes);
    });
    return () => {
      active = false;
    };
  }, [uid, order.id]);

  const held = Boolean(order.escrowHeldAt && !order.receiptConfirmedAt && !order.cancelledAt);
  // Never-paid orders (abandoned checkout / payment failed / listing removed)
  // get NO meetup UI — no chat prompt, no pickup spot, no actions.
  const paid = Boolean(order.completedAt || order.escrowHeldAt || order.receiptConfirmedAt);
  const noShowReady = Boolean(
    held &&
      !order.disputedAt &&
      order.completedAt &&
      now >= order.completedAt.getTime() + NO_SHOW_WINDOW_MS
  );
  const status = order.cancelledAt
    ? { label: "Cancelled", cls: "bg-sand text-ink-soft" }
    : order.disputedAt
      ? { label: "Dispute under review", cls: "bg-accent-soft text-accent" }
      : order.receiptConfirmedAt
        ? { label: "Received ✓", cls: "bg-lime text-ink" }
        : held
          ? { label: "Awaiting pickup", cls: "bg-amber-400 text-ink" }
          : order.status === "failed"
            ? { label: "Payment failed", cls: "bg-sand text-ink-soft" }
            : order.status === "pending"
              ? { label: "Payment not completed", cls: "bg-sand text-ink-soft" }
              : { label: "Paid", cls: "bg-sand text-ink-soft" };

  const submitDispute = async () => {
    if (disputeBusy) return;
    setDisputeBusy(true);
    setDisputeMsg(null);
    try {
      await disputeOrder(order.id, disputeReason.trim() || undefined);
      setDisputeOpen(false);
      setDisputeReason("");
      showToast("Dispute filed — the team will review it.");
    } catch (e) {
      setDisputeMsg(e instanceof Error ? e.message : "Couldn't file the dispute.");
    } finally {
      setDisputeBusy(false);
    }
  };

  const cancel = async () => {
    if (cancelBusy) return;
    setCancelBusy(true);
    setCancelMsg(null);
    try {
      await cancelOrderNoShow(order.id);
      setCancelArm(false);
      showToast("Order cancelled — your refund is on the way.");
    } catch (e) {
      setCancelMsg(e instanceof Error ? e.message : "Couldn't cancel the order.");
      setCancelArm(false);
    } finally {
      setCancelBusy(false);
    }
  };

  const meetupPoint = order.productSnapshot.meetupPoint;
  // Snapshots can hold a missing/placeholder image URL (pending orders start
  // with {} and get filled at finalize). <Image> throws on any src that isn't
  // a valid URL, which would crash the buyer's whole account page — fall back
  // to a plain tile instead of rendering an image.
  const imgSrc = order.productSnapshot.imageUrl;
  const imgValid =
    typeof imgSrc === "string" && /^https?:\/\//i.test(imgSrc);

  return (
    <li className="rounded-2xl border border-line bg-paper p-4">
      <div className="flex items-center gap-4">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-sand">
          {imgValid ? (
            <Image
              src={imgSrc}
              alt={order.productSnapshot.title}
              fill
              sizes="56px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xl">
              🧵
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-bold">{order.productSnapshot.title}</p>
          <p className="text-xs text-ink-soft">
            {METHOD_LABEL[order.method] ?? order.method} · {formatDate(order.createdAt)}
            {order.productSnapshot.sellerName ? ` · by ${order.productSnapshot.sellerName}` : ""}
          </p>
          {confirmMsg?.id === order.id && (
            <p
              className={`mt-0.5 text-[11px] font-semibold ${
                confirmMsg.text.startsWith("Thanks") ? "text-lime" : "text-accent"
              }`}
            >
              {confirmMsg.text}
            </p>
          )}
          {disputeMsg && <p className="mt-0.5 text-[11px] font-semibold text-accent">{disputeMsg}</p>}
          {cancelMsg && <p className="mt-0.5 text-[11px] font-semibold text-accent">{cancelMsg}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <p className="whitespace-nowrap font-display text-sm font-extrabold">{formatKes(order.amountKes)}</p>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${status.cls}`}
          >
            {status.label}
          </span>
        </div>
      </div>

      {!order.cancelledAt && paid && (
        <div className="mt-4 space-y-3 border-t border-line pt-3">
          <div className="flex items-start gap-2 rounded-xl bg-sand/60 px-3 py-2.5">
            <span className="text-base">📍</span>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Meetup point</p>
              <p className="text-sm">
                {meetupPoint ? `Near ${meetupPoint}` : "Agree on a public spot in the chat below"}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-soft">
                Meet in a busy, public place. Never pay outside the app.
              </p>
            </div>
          </div>

          <OrderChat orderId={order.id} />

          {held && <MeetupSafety orderId={order.id} />}

          {held && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onConfirm(order.id)}
                disabled={confirmingId === order.id}
                className="rounded-full bg-lime px-4 py-1.5 text-[11px] font-bold text-ink transition hover:brightness-95 disabled:opacity-50"
              >
                {confirmingId === order.id ? "Confirming…" : "I received it ✓"}
              </button>
              {!order.disputedAt && (
                <button
                  onClick={() => setDisputeOpen((o) => !o)}
                  className="rounded-full border border-accent px-4 py-1.5 text-[11px] font-bold text-accent transition hover:bg-accent hover:text-white"
                >
                  I didn&apos;t receive it
                </button>
              )}
              {noShowReady && (
                <button
                  onClick={() => (cancelArm ? void cancel() : setCancelArm(true))}
                  disabled={cancelBusy}
                  className="rounded-full bg-ink px-4 py-1.5 text-[11px] font-bold text-cream transition hover:bg-accent disabled:opacity-50"
                >
                  {cancelBusy
                    ? "Cancelling…"
                    : cancelArm
                      ? "Confirm cancel & refund"
                      : "Seller didn't show — cancel"}
                </button>
              )}
            </div>
          )}
          {/* Post-purchase rating — the trust signal shown on sellers' pieces.
              Offered on any live or received order (skipped when cancelled or
              disputed) until the buyer has rated it once. */}
          {!order.cancelledAt && !order.disputedAt && (held || order.receiptConfirmedAt) && (
            <div className="border-t border-line pt-3">
              {ratedAlready === true ? (
                <p className="text-xs font-semibold text-ink-soft">⭐ Rated — thanks for the feedback!</p>
              ) : rateOpen ? (
                <FeedbackRating
                  orderId={order.id}
                  onSubmitted={() => setRatedAlready(true)}
                />
              ) : (
                <button
                  onClick={() => setRateOpen(true)}
                  className="rounded-full border border-line px-4 py-1.5 text-[11px] font-bold text-ink-soft transition hover:border-ink hover:text-ink"
                >
                  ⭐ How was this drop?
                </button>
              )}
            </div>
          )}
          {disputeOpen && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="Tell the team what happened (optional)"
                disabled={disputeBusy}
                className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm outline-none transition focus:border-ink disabled:opacity-60"
              />
              <div className="flex gap-2">
                <button
                  onClick={submitDispute}
                  disabled={disputeBusy}
                  className="rounded-full bg-accent px-4 py-2 text-xs font-bold text-white transition hover:bg-accent-deep disabled:opacity-50"
                >
                  {disputeBusy ? "Filing…" : "File dispute"}
                </button>
                <button
                  onClick={() => setDisputeOpen(false)}
                  className="rounded-full border border-line px-4 py-2 text-xs font-bold text-ink-soft transition hover:border-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {held && !noShowReady && !order.disputedAt && order.completedAt && (
            <p className="text-[11px] text-ink-soft">
              If the seller doesn&apos;t show, you can cancel and get a refund after{" "}
              {formatDate(new Date(order.completedAt.getTime() + NO_SHOW_WINDOW_MS))}.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Chat entry point on the seller's side (their sold listings). */
function SellerChat({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-bold text-accent underline-offset-2 transition hover:underline"
      >
        {open ? "Hide chat" : "💬 Chat with buyer"}
      </button>
      {open && (
        <div className="mt-2">
          <OrderChat orderId={orderId} isSeller />
        </div>
      )}
    </div>
  );
}

/** Meetup safety (check-in + live location) on the seller's side. */
function SellerSafety({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-bold text-accent underline-offset-2 transition hover:underline"
      >
        {open ? "Hide meetup safety" : "🛡 Meetup safety"}
      </button>
      {open && (
        <div className="mt-2">
          <MeetupSafety orderId={orderId} isSeller />
        </div>
      )}
    </div>
  );
}

export default function AccountPage() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <section className="flex min-h-[50vh] items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-ink/20 border-t-ink" />
      </section>
    );
  }

  return user ? <SignedIn /> : <SignedOut />;
}
