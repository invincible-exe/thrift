"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import Image from "next/image";
import { useAuth } from "@/context/AuthContext";
import { useShop } from "@/context/ShopContext";
import {
  addDisputeProof,
  cancelOrderNoShow,
  confirmOrderReceipt,
  dispatchPendingPayouts,
  disputeOrder,
  fetchBanks,
  hasRatedOrder,
  releaseExpiredEscrow,
  reportPayoutMissing,
  requestSellerVerification,
  updatePayoutSettings,
  updateProfileLocation,
  updateProfilePhone,
  uploadProductImage,
  useConversationPreviews,
  useMyConversations,
  type ConversationPreview,
  useOpenDispute,
  usePayoutSettings,
  useProfileLocation,
  useProfilePhone,
  useSellerVerification,
  useUserListings,
  useUserOrders,
  useUserPayouts,
  useUserPayoutReports,
} from "@/lib/db";
import { formatDate, formatKes } from "@/lib/format";
import { BOOST_PRICE_KES, NO_SHOW_WINDOW_MS, PLATFORM_WALLET, isVideoUrl } from "@/lib/constants";
import { useIsAdmin } from "@/lib/admin";
import BoostModal from "@/components/BoostModal";
import LocationPicker from "@/components/LocationPicker";
import MeetupSafety from "@/components/MeetupSafety";
import OrderChat from "@/components/OrderChat";
import ListingChat from "@/components/ListingChat";
import FeedbackRating from "@/components/ui/FeedbackRating";
import { useNow } from "@/lib/use-now";
import type { Listing, ListingConversation, Location, Order, Payout } from "@/lib/types";
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
  const { user, updateUserName } = useAuth();
  const { showToast, openSell } = useShop();
  const uid = user?.id ?? null;
  const { isAdmin } = useIsAdmin(uid);

  const orders = useUserOrders(uid);
  const listings = useUserListings(uid);
  const payouts = useUserPayouts(uid);
  const payoutReports = useUserPayoutReports(uid);
  const conversations = useMyConversations(uid);
  const previews = useConversationPreviews(conversations?.map((c) => c.id) ?? null);
  const verification = useSellerVerification(uid);
  const phone = useProfilePhone(uid);
  // Draft stays null until the user types, so we never sync server state
  // inside an effect (avoids a stale write racing the async phone fetch).
  const [phoneDraft, setPhoneDraft] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
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
      showToast(loc ? "Area saved. Nearby pieces will surface." : "Area cleared.");
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
            : "Thanks for confirming. Nothing was held on this order.",
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

  const saveName = async () => {
    const trimmed = (nameDraft ?? "").trim();
    if (!trimmed) {
      showToast("Name can't be empty.");
      return;
    }
    setNameSaving(true);
    try {
      await updateUserName(trimmed);
      setNameDraft(null);
      showToast("Name updated.");
    } catch {
      showToast("Couldn't update name. Try again.");
    } finally {
      setNameSaving(false);
    }
  };

  const boostedUntil = (l: Listing): Date | undefined =>
    l.boostExpiresAt && l.boostExpiresAt.getTime() > now ? l.boostExpiresAt : undefined;

  const earned = (payouts ?? []).reduce((sum, p) => sum + p.amountKes, 0);
  const activeListings = (listings ?? []).filter((l) => l.status === "active").length;
  const displayName = nameDraft ?? user?.name ?? "";
  const initial = displayName.charAt(0).toUpperCase() || "U";

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-2 rounded-full border-2 border-ink px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition hover:bg-ink hover:text-cream"
      >
        ← Back to store
      </Link>
      {/* Profile card */}
      <div className="grid gap-5 rounded-3xl border border-line bg-paper p-6 sm:grid-cols-3 sm:p-8">
        <div className="sm:col-span-2">
          <div className="flex items-center gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-ink font-display text-2xl font-black text-cream">
              {initial}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <input
                  value={nameDraft ?? user?.name ?? ""}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onFocus={() => {
                    if (nameDraft === null) setNameDraft(user?.name ?? "");
                  }}
                  onBlur={() => {
                    const trimmed = (nameDraft ?? "").trim();
                    if (trimmed && trimmed !== user?.name) saveName();
                    else setNameDraft(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="font-display text-2xl font-black bg-sand border-b-2 border-line px-3 py-1 -mx-3 rounded-lg outline-none transition focus:border-accent w-full max-w-xs"
                  placeholder="Your name"
                  maxLength={40}
                />
                {nameDraft !== null && nameDraft.trim() !== (user?.name ?? "") && (
                  <button
                    onClick={saveName}
                    disabled={nameSaving || !nameDraft.trim()}
                    className="shrink-0 rounded-full bg-accent px-3 py-1 text-[11px] font-bold text-white transition hover:bg-accent-deep disabled:opacity-50"
                  >
                    {nameSaving ? "Saving…" : "Save"}
                  </button>
                )}
              </div>
              <p className="text-sm text-ink-soft">{user?.email}</p>
              <p className="mt-0.5 text-[11px] text-ink-soft">Click the name above to edit it</p>
              <div className="mt-3 max-w-md">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-ink-soft">
                  Payout details: where your earnings land
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
                  Your area: see pieces near you
                </p>
                <LocationPicker value={profileLocationId} onChange={saveArea} />
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 justify-end sm:flex-row sm:items-center sm:justify-end">
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

      {/* Seller verification — the ✓ badge + the first-payout gate */}
      <div className="mt-5">
        <SellerVerificationCard verification={verification} />
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

      {/* Messages — pre-purchase chats on your pieces (both sides) */}
      <div className="mt-12">
        <h2 className="mb-4 font-display text-xl font-black">Messages</h2>
        {conversations && conversations.length > 0 ? (
          <ul className="space-y-3">
            {conversations.map((c) => (
              <ConversationRow key={c.id} conv={c} me={uid} preview={previews?.[c.id] ?? null} />
            ))}
          </ul>
        ) : conversations !== null ? (
          <EmptyState text="No chats yet. Buyers can message you straight from any of your pieces." />
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
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-line bg-paper/60">
                <svg className="h-7 w-7 text-ink-soft" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 19.5A4.5 4.5 0 0 1 11.5 15H7A6 6 0 0 1 13 7.5v-2A4.5 4.5 0 0 1 16 10.5A4.5 4.5 0 0 1 20.5 15 4.5 4.5 0 0 1 16 19.5Z"/>
                  <path d="M8 19.5A4.5 4.5 0 0 0 12.5 15H17"/>
                </svg>
              </div>
              <p className="max-w-xs text-sm text-ink-soft">
                Your closet is empty. Add your first piece. It shows up here, then hits the feed once approved.
              </p>
            </div>
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
 * Seller verification card: the ✓ badge + the first-payout gate. Every
 * seller can request verification; the owner approves it from the admin
 * dashboard. Until verified, earnings sit in 'pending' instead of going
 * out automatically.
 */
function SellerVerificationCard({
  verification,
}: {
  verification: { sellerVerified: boolean; verificationRequestedAt: Date | null } | null;
}) {
  const { showToast } = useShop();
  const [busy, setBusy] = useState(false);
  // Local copy so the card flips to "under review" instantly after
  // requesting, without waiting for a refetch.
  const [requestedAt, setRequestedAt] = useState<Date | null>(null);

  if (!verification) return null;

  if (verification.sellerVerified) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-lime/60 bg-lime/15 p-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lime text-sm font-black text-lime-ink">
          ✓
        </span>
        <div>
          <p className="font-display text-sm font-extrabold">Verified seller</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            Your pieces carry the ✓ badge and your payouts go out automatically.
          </p>
        </div>
      </div>
    );
  }

  const pending = Boolean(verification.verificationRequestedAt ?? requestedAt);

  const request = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const at = await requestSellerVerification();
      setRequestedAt(at);
      showToast("Verification requested. The owner will review your account.");
    } catch (e) {
      showToast(
        e instanceof Error
          ? /PAYOUT_DETAILS_REQUIRED/i.test(e.message)
            ? "Add your payout details (M-Pesa number or bank) above first."
            : e.message
          : "Couldn't request verification."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-sand/40 p-4">
      <p className="font-display text-sm font-extrabold">
        {pending ? "⏳ Verification under review" : "Get verified as a seller"}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        {pending
          ? "The owner reviews your payout details before your first payout goes out."
          : "Verified sellers get the ✓ badge and their payouts go out automatically. Add your payout details above, then request review."}
      </p>
      {!pending && (
        <button
          onClick={request}
          disabled={busy}
          className="mt-3 rounded-full bg-ink px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-cream transition hover:bg-accent disabled:opacity-50"
        >
          {busy ? "Requesting…" : "Request verification"}
        </button>
      )}
    </div>
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
          <div className="rounded-2xl border border-line bg-paper p-4">
        <div className="grid grid-cols-2 gap-2">
          {(["mpesa", "bank"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`rounded-xl border px-3 py-2 text-xs font-bold transition sm:py-2.5 ${
                method === m
                  ? "border-ink bg-ink text-cream shadow"
                  : "border-line bg-paper text-ink-soft hover:border-ink hover:text-ink"
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                {m === "mpesa" ? "M-Pesa" : "Bank"}
                {method === m && <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8"/></svg>}
              </span>
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <select
            value={bankCode}
            onChange={(e) => setBankCode(e.target.value)}
            aria-label="Your bank"
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
        </div>
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

/** One shared status pill used by every payout row, the order card edge
 *  cases and the no-show banner. Dark charcoal text on an amber fill is
 *  AA (≥7:1); on lime it's also fine. */
function statusCls(s: string): string {
  switch (s) {
    case "paid":
      return "bg-lime text-lime-ink";
    case "failed":
      return "bg-sand text-ink-soft";
    case "escrow":
      return "bg-amber-400 text-amber-ink";
    case "processing":
      return "bg-amber-400 text-amber-ink";
    case "cancelled":
      return "bg-sand text-ink-soft";
    default:
      return "bg-sand text-ink-soft";
  }
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
      showToast("Report filed. The team is on it.");
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
            <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-soft">
              <svg className="h-3.5 w-3.5 text-ink-soft" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
              Held in escrow until the buyer confirms delivery
              {p.escrowReleaseAt ? ` · auto-releases ${formatDate(p.escrowReleaseAt)}` : "."}
            </p>
          )}
          {p.status === "paid" && p.paidAt && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-soft">
              Received {formatDate(p.paidAt)}
              {p.providerRef ? <span className="text-ink-soft/70">· Receipt {p.providerRef}</span> : ""}
            </p>
          )}
          {p.failureReason && <p className="mt-0.5 text-xs text-accent">{p.failureReason}</p>}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${statusCls(p.status)}
        `}
        >
          {p.status === "paid"
            ? "Paid ✓"
            : p.status === "failed"
              ? "Failed"
              : p.status === "escrow"
                ? "Escrow"
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
              ⏳ Reported. We&apos;re looking into this payout.
            </p>
          )}
          {report?.status === "resolved" && (
            <p className="rounded-xl bg-lime/20 px-3 py-2 text-xs font-semibold text-ink">
              ✓ Report resolved
              {report.adminNote ? `: ${report.adminNote}` : report.reason ? `: ${report.reason}` : ""}.
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
      <div className="relative aspect-square overflow-hidden bg-paper">
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
                ? "bg-lime text-lime-ink"
                : l.status === "pending"
                  ? "bg-amber-400 text-amber-ink"
                  : "bg-paper/90 text-ink backdrop-blur"
            }`}
          >
            {l.status === "sold" ? "Sold ✓" : l.status === "pending" ? "Pending review" : "Live"}
          </span>
          {boosted && (
            <span
              title={`Pinned to the top of the feed until ${formatDate(boosted)}`}
              className="rounded-full bg-amber-400 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-ink"
            >
              Boosted ⚡
            </span>
          )}
        </div>
        {/* Fallback frame when the cover is still the seeded placeholder.
            Keeps the card grid looking even on mobile before the real photo
            loads. */}
        {!l.imageUrl || !/^https?:\/\//.test(l.imageUrl) ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl border border-line bg-ink/5">
            <svg className="h-6 w-6 text-ink-soft" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="M21 15l-5-5L5 21"/>
            </svg>
          </div>
        ) : null}
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
          <p className="mt-1.5 text-[11px] text-ink-soft"><svg className="h-3.5 w-3.5 inline-block mr-1 text-ink-soft" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-6.5 7-11a7 7 0 0 0-14 0c0 4.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>Meet near {l.locationLabel}</p>
        )}
        {l.status === "sold" && l.orderId && (
          <div className="mt-3 space-y-3 border-t border-line pt-3">
            <SellerDisputeNotice orderId={l.orderId} />
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
  const [proofBusy, setProofBusy] = useState(false);
  // The open dispute on this order (buyer can read it; lets us attach evidence).
  const dispute = useOpenDispute(order.id);

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



  const submitDispute = async () => {
    if (disputeBusy) return;
    setDisputeBusy(true);
    setDisputeMsg(null);
    try {
      await disputeOrder(order.id, disputeReason.trim() || undefined);
      setDisputeOpen(false);
      setDisputeReason("");
      showToast("Dispute filed. The team will review it.");
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
      showToast("Order cancelled. Your refund is on the way.");
    } catch (e) {
      setCancelMsg(e instanceof Error ? e.message : "Couldn't cancel the order.");
      setCancelArm(false);
    } finally {
      setCancelBusy(false);
    }
  };

  // Attach delivery evidence to the open dispute (proof photo for the owner).
  const attachProof = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uid || proofBusy || !dispute) return;
    setProofBusy(true);
    try {
      const up = await uploadProductImage(uid, file);
      await addDisputeProof(dispute.id, up.url);
      showToast("Evidence attached. The owner can now review it.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't attach the evidence.");
    } finally {
      setProofBusy(false);
      e.target.value = "";
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
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-paper">
          {imgValid ? (
            <Image
              src={imgSrc}
              alt={order.productSnapshot.title}
              fill
              sizes="56px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-lg border border-line bg-ink/5">
              <svg className="h-5 w-5 text-ink-soft" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 19.5A4.5 4.5 0 0 1 11.5 15H7A6 6 0 0 1 13 7.5v-2A4.5 4.5 0 0 1 16 10.5A4.5 4.5 0 0 1 20.5 15 4.5 4.5 0 0 1 16 19.5Z"/>
                <path d="M8 19.5A4.5 4.5 0 0 0 12.5 15H17"/>
              </svg>
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
          {/* eslint-disable-next-line react/jsx-key */}
          <span
            className={
              "rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider " +
              statusCls(
                order.status === "pending" ? "pending"
                : order.status === "completed" ? "paid"
                : order.status === "failed" ? "failed"
                : "pending"
              )
            }
          >
            {order.status === "completed" ? "Paid ✓" : order.status === "pending" ? "Pending" : "Failed"}
          </span>
        </div>
      </div>

      {!order.cancelledAt && paid && (
                  <div className="mt-4 space-y-3 border-t border-line pt-3">
          <div className="flex items-start gap-2 rounded-xl bg-sand/60 px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-paper text-ink-soft">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21s7-6.5 7-11a7 7 0 0 0-14 0c0 4.5 7 11 7 11Z"/>
                <circle cx="12" cy="10" r="2.5"/>
              </svg>
            </span>
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
                className="rounded-full bg-lime px-4 py-1.5 text-[11px] font-bold text-lime-ink transition hover:brightness-95 disabled:opacity-50"
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
                      : "Seller didn't show. Cancel"}
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
                <p className="text-xs font-semibold text-ink-soft">⭐ Rated. Thanks for the feedback!</p>
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
          {order.disputedAt && (
            <div className="rounded-xl bg-accent-soft/40 px-3 py-2.5">
              <p className="text-xs font-bold text-accent">Dispute in review</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">
                Attach evidence (like a delivery photo) to help the owner resolve it fairly.
              </p>
              {dispute?.proofUrl ? (
                <a
                  href={dispute.proofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block overflow-hidden rounded-xl"
                >
                  <Image
                    src={dispute.proofUrl}
                    alt="Delivery evidence"
                    width={160}
                    height={160}
                    className="h-20 w-20 object-cover"
                  />
                </a>
              ) : (
                <label className="mt-2 inline-block cursor-pointer rounded-full border border-accent px-3 py-1 text-[11px] font-bold text-accent transition hover:bg-accent hover:text-white">
                  {proofBusy ? "Uploading…" : <><svg className="h-3.5 w-3.5 inline-block mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8l3 2"/></svg>Attach delivery evidence</>}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={attachProof}
                    disabled={proofBusy}
                  />
                </label>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** One pre-purchase thread in the Messages inbox (buyer or seller side). */
function ConversationRow({
  conv,
  me,
  preview,
}: {
  conv: ListingConversation;
  me: string | null;
  preview: ConversationPreview | null;
}) {
  const [open, setOpen] = useState(false);
  const iAmSeller = conv.sellerId === me;
  const other = iAmSeller ? conv.buyerName || "Buyer" : conv.sellerName || "Seller";
  const cover = conv.listingImage;
  return (
    <li className="rounded-2xl border border-line bg-paper p-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-sand">
          {cover &&
            (isVideoUrl(cover) ? (
              <video
                src={cover}
                className="h-full w-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              <Image src={cover} alt="" fill sizes="48px" className="object-cover" />
            ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">
            {iAmSeller ? `Chat with ${other}` : `“${conv.listingTitle}”`}
          </span>
          {preview && (
            <span className="block truncate text-xs italic text-ink-soft">
              {preview.senderId === me ? "You: " : ""}
              {preview.body}
            </span>
          )}
          <span className="block truncate text-xs text-ink-soft">
            {iAmSeller
              ? `About “${conv.listingTitle}” · ${formatDate(conv.createdAt)}`
              : `with ${other} · ${formatDate(conv.createdAt)}`}
          </span>
        </span>
        <span className="shrink-0 text-xs font-bold text-accent">{open ? "Hide" : "Open"}</span>
      </button>
      {open && (
        <div className="mt-3">
          <ListingChat
            conversationId={conv.id}
            otherLabel={iAmSeller ? "Buyer" : "Seller"}
            header={
              iAmSeller
                ? "A buyer is asking about your piece"
                : "Ask before you buy — fit, condition, meetup spot"
            }
          />
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

/**
 * Dispute notice on the seller's sold listing: if the buyer filed "I didn't
 * receive it", the seller sees it here and can attach delivery proof for the
 * owner's review (same evidence the buyer can add on their side).
 */
function SellerDisputeNotice({ orderId }: { orderId: string }) {
  const { user } = useAuth();
  const { showToast } = useShop();
  const dispute = useOpenDispute(orderId);
  const [busy, setBusy] = useState(false);

  if (!dispute || dispute.status !== "open") return null;

  const attachProof = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || busy) return;
    setBusy(true);
    try {
      const up = await uploadProductImage(user.id, file);
      await addDisputeProof(dispute.id, up.url);
      showToast("Delivery proof attached. The owner can now review it.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't attach the proof.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  return (
    <div className="rounded-xl bg-accent-soft/40 px-3 py-2.5">
      <p className="text-xs font-bold text-accent">⚠ Dispute in review</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">
        The buyer says they didn&apos;t receive this piece. Attach delivery proof to help the owner
        resolve it fairly.
      </p>
      {dispute.proofUrl ? (
        <a
          href={dispute.proofUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block overflow-hidden rounded-xl"
        >
          <Image
            src={dispute.proofUrl}
            alt="Delivery proof"
            width={160}
            height={160}
            className="h-20 w-20 object-cover"
          />
        </a>
      ) : (
        <label className="mt-2 inline-block cursor-pointer rounded-full border border-accent px-3 py-1 text-[11px] font-bold text-accent transition hover:bg-accent hover:text-white">
          {busy ? "Uploading…" : <><svg className="h-3.5 w-3.5 inline-block mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8l3 2"/></svg>Attach delivery proof</>}
          <input type="file" accept="image/*" className="sr-only" onChange={attachProof} disabled={busy} />
        </label>
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
