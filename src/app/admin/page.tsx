"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useShop } from "@/context/ShopContext";
import { useIsAdmin } from "@/lib/admin";
import {
  createPlatformProduct,
  deleteProductAdmin,
  finalizePayoutOtp,
  releaseExpiredEscrow,
  removeProductImage,
  requestPayout,
  resetPayoutAdmin,
  resolveOrderDisputeAdmin,
  resolvePayoutReportAdmin,
  setProductStatusAdmin,
  uploadProductImage,
  useAllOrders,
  useAllProducts,
  useAllProfiles,
  useLocations,
  useOrderDisputes,
  usePayoutReports,
  usePlatformPayouts,
  useRefundPayouts,
  useSellerPayouts,
  type UploadedImage,
} from "@/lib/db";
import { formatDate, formatKes } from "@/lib/format";
import { CATEGORIES, CONDITIONS } from "@/lib/constants";
import { useNow } from "@/lib/use-now";
import LocationPicker from "@/components/LocationPicker";
import ProductGalleryModal from "@/components/ProductGalleryModal";
import type { Location, Product, ProductCategory } from "@/lib/types";

function AccessDenied() {
  const { openAuth } = useShop();
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <span className="text-5xl">🔒</span>
      <h1 className="mt-4 font-display text-3xl font-black tracking-tight">Admins only</h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
        This dashboard is restricted. Set <code className="rounded bg-sand px-1">NEXT_PUBLIC_ADMIN_UID</code>{" "}
        to your Supabase user ID (or set <code className="rounded bg-sand px-1">role: &quot;admin&quot;</code> on
        your profiles row) to view it.
      </p>
      <button
        onClick={openAuth}
        className="mt-8 rounded-full bg-accent px-8 py-3.5 text-sm font-bold uppercase tracking-wider text-white transition hover:bg-accent-deep"
      >
        Sign in
      </button>
    </section>
  );
}

export default function AdminPage() {
  const { user } = useAuth();
  const { isAdmin, checking } = useIsAdmin(user?.id ?? null);

  if (checking) {
    return (
      <section className="flex min-h-[50vh] items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-ink/20 border-t-ink" />
      </section>
    );
  }

  if (!user || !isAdmin) return <AccessDenied />;

  return <Dashboard />;
}

function Dashboard() {
  const products = useAllProducts();
  const wallet = usePlatformPayouts();
  const now = useNow();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Inline rejection-note panel: which piece is open, and the note draft.
  const [rejectOpenId, setRejectOpenId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  // Full photo gallery for the piece being reviewed (pending queue + all
  // pieces) — clicking the thumbnail opens every uploaded shot, so the
  // moderation call is made with the actual photos in front of you.
  const [gallery, setGallery] = useState<{ product: Product; index: number } | null>(null);

  // 24h auto-resolve sweep: escrowed seller payouts whose window elapsed flip
  // to pending and are auto-paid. Safe for any user, runs on load.
  useEffect(() => {
    void releaseExpiredEscrow().catch(() => {});
  }, []);

  const platformTotal = (wallet?.payouts ?? []).reduce((s, p) => s + p.amountKes, 0);
  const pending = (products ?? []).filter((p) => p.status === "pending");
  const live = (products ?? []).filter((p) => p.status === "active");
  const communityListings = (products ?? []).filter((p) => p.source === "community").length;
  const sellerPayouts = useSellerPayouts();
  const pendingPayouts = (sellerPayouts ?? []).filter((p) => p.status === "pending");
  const [payoutBusyId, setPayoutBusyId] = useState<string | null>(null);
  const [payoutMsg, setPayoutMsg] = useState("");
  const [otpFor, setOtpFor] = useState<string | null>(null);
  const [otpValue, setOtpValue] = useState("");
  const allOrders = useAllOrders();
  const orderDisputes = useOrderDisputes();
  const refundPayouts = useRefundPayouts();
  const orderById = new Map((allOrders ?? []).map((o) => [o.id, o]));
  const openDisputes = (orderDisputes ?? []).filter((d) => d.status === "open");
  const [disputeBusyId, setDisputeBusyId] = useState<string | null>(null);
  const [disputeMsg, setDisputeMsg] = useState("");
  const payoutReports = usePayoutReports();
  const openReports = (payoutReports ?? []).filter((r) => r.status === "open");
  const [reportBusyId, setReportBusyId] = useState<string | null>(null);
  const [reportNote, setReportNote] = useState<Record<string, string>>({});
  const [reportMsg, setReportMsg] = useState("");

  async function handlePayout(id: string) {
    setPayoutBusyId(id);
    setPayoutMsg("");
    const res = await requestPayout(id);
    if (res.otpRequired) {
      setOtpFor(id);
      setOtpValue("");
      setPayoutMsg(res.message);
    } else {
      setPayoutMsg(res.message);
    }
    setPayoutBusyId(null);
  }

  // Paystack OTP-gated transfers need a confirmation step before release.
  async function handleConfirmOtp() {
    if (!otpFor) return;
    setPayoutBusyId(otpFor);
    setPayoutMsg("");
    const res = await finalizePayoutOtp(otpFor, otpValue);
    setPayoutMsg(res.message);
    if (res.ok) {
      setOtpFor(null);
      setOtpValue("");
    }
    setPayoutBusyId(null);
  }

  // A seller flagged a payout as never received. If Paystack already shows it as
  // paid but the seller disagrees, the owner can re-send it (or investigate).
  async function handleResolveReport(id: string) {
    setReportBusyId(id);
    setReportMsg("");
    try {
      await resolvePayoutReportAdmin(id, reportNote[id]?.trim() || undefined);
    } catch {
      setReportMsg("Couldn't resolve that report. Try again.");
    } finally {
      setReportBusyId(null);
    }
  }

  async function handleResolveDispute(
    disputeId: string,
    outcome: "release" | "fail" | "cancel",
    note?: string
  ) {
    setDisputeBusyId(disputeId);
    setDisputeMsg("");
    try {
      await resolveOrderDisputeAdmin(disputeId, outcome, note);
      setDisputeMsg("Dispute resolved.");
    } catch {
      setDisputeMsg("Couldn't resolve that dispute. Try again.");
    } finally {
      setDisputeBusyId(null);
    }
  }

  // For report rows, resolve the linked payout so the owner knows what to act on.
  const payoutById = new Map((sellerPayouts ?? []).map((p) => [p.id, p]));
  async function handleReportedPayout(payoutId: string) {
    setPayoutMsg("");
    const res = await requestPayout(payoutId);
    if (res.otpRequired) {
      setOtpFor(payoutId);
      setOtpValue("");
    }
    setPayoutMsg(res.message);
  }

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
    } finally {
      setBusyId(null);
    }
  }

  // Locations & coverage: where buyers live vs. where pieces meet. Aggregates
  // the profiles + products the admin can read (RLS lets admins see all) up
  // to county · area rows, plus the counties that have buyers but no pieces.
  const locations = useLocations();
  const profiles = useAllProfiles();
  const locationStats = useMemo(() => {
    const locById = new Map((locations ?? []).map((l) => [l.id, l]));
    const live = (products ?? []).filter((p) => p.status === "active");

    const buyersByArea = new Map<string, number>();
    for (const p of profiles ?? []) {
      if (!p.locationId) continue;
      buyersByArea.set(p.locationId, (buyersByArea.get(p.locationId) ?? 0) + 1);
    }

    const piecesByArea = new Map<string, number>();
    // Distinct sellers per area (one seller with 3 pieces counts once).
    const sellersByArea = new Map<string, Set<string>>();
    for (const p of live) {
      if (!p.locationId) continue;
      piecesByArea.set(p.locationId, (piecesByArea.get(p.locationId) ?? 0) + 1);
      if (p.source === "community" && p.sellerId) {
        const s = sellersByArea.get(p.locationId) ?? new Set<string>();
        s.add(p.sellerId);
        sellersByArea.set(p.locationId, s);
      }
    }

    // Roll the catalog's landmark rows up to county · area (one row per area).
    const byArea = new Map<
      string,
      { city: string; area: string; buyers: number; pieces: number; sellers: number }
    >();
    for (const loc of locations ?? []) {
      const key = `${loc.city}|${loc.area}`;
      const e = byArea.get(key) ?? { city: loc.city, area: loc.area, buyers: 0, pieces: 0, sellers: 0 };
      e.buyers += buyersByArea.get(loc.id) ?? 0;
      e.pieces += piecesByArea.get(loc.id) ?? 0;
      e.sellers += sellersByArea.get(loc.id)?.size ?? 0;
      byArea.set(key, e);
    }
    const rows = [...byArea.values()]
      .filter((r) => r.buyers > 0 || r.pieces > 0)
      .sort(
        (a, b) =>
          b.buyers - a.buyers || b.pieces - a.pieces || a.city.localeCompare(b.city) || a.area.localeCompare(b.area)
      );

    // County rollups for the headline cards + gap analysis.
    const countyBuyers = new Map<string, number>();
    for (const [locId, n] of buyersByArea) {
      const city = locById.get(locId)?.city;
      if (city) countyBuyers.set(city, (countyBuyers.get(city) ?? 0) + n);
    }
    const countyPieces = new Map<string, number>();
    for (const p of live) {
      const city = p.locationId ? locById.get(p.locationId)?.city : undefined;
      if (city) countyPieces.set(city, (countyPieces.get(city) ?? 0) + 1);
    }

    return {
      rows,
      totalBuyers: [...buyersByArea.values()].reduce((s, n) => s + n, 0),
      countiesWithBuyers: countyBuyers.size,
      countiesWithPieces: countyPieces.size,
      totalCounties: new Set((locations ?? []).map((l) => l.city)).size,
      gaps: [...countyBuyers.entries()]
        .filter(([city]) => !countyPieces.has(city))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    };
  }, [locations, profiles, products]);

  // Approve a pending community piece. The in-app bell + seller email are
  // triggered by the SQL function itself (admin_set_product_status fires a
  // pg_net webhook), so the browser only calls the RPC — the email still
  // sends even if this tab closes mid-action.
  function approveListing(p: { id: string }) {
    return setProductStatusAdmin(p.id, "active");
  }

  // Deletes a product. When it's a pending community piece, the SQL function
  // (admin_delete_product) notifies the seller (bell + email webhook) before
  // the row is deleted. Used by both the Reject button (always a pending
  // community piece) and the All-pieces Remove button.
  function removeProduct(p: { id: string }, note?: string) {
    return deleteProductAdmin(p.id, note);
  }

  const card = "rounded-3xl border border-line bg-paper p-6";

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-accent">Admin</p>
          <h1 className="mt-1 font-display text-3xl font-black tracking-tight sm:text-4xl">
            The back room
          </h1>
        </div>
        <Link
          href="/"
          className="rounded-full border-2 border-ink px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition hover:bg-ink hover:text-cream"
        >
          ← Back to store
        </Link>
      </div>

      {/* Overview */}
      <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className={card}>
          <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Platform wallet</p>
          <p className="mt-2 font-display text-3xl font-black">{formatKes(platformTotal)}</p>
          <p className="mt-1 text-xs text-ink-soft">commissions + revenue (10%, min 50 KES)</p>
        </div>
        <div className={card}>
          <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Live pieces</p>
          <p className="mt-2 font-display text-3xl font-black">{live.length}</p>
          <p className="mt-1 text-xs text-ink-soft">on the public feed</p>
        </div>
        <div className={card}>
          <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Pending review</p>
          <p className={`mt-2 font-display text-3xl font-black ${pending.length ? "text-accent" : ""}`}>
            {pending.length}
          </p>
          <p className="mt-1 text-xs text-ink-soft">user pieces awaiting your call</p>
        </div>
        <div className={card}>
          <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Community listings</p>
          <p className="mt-2 font-display text-3xl font-black">{communityListings}</p>
          <p className="mt-1 text-xs text-ink-soft">sold by users</p>
        </div>
      </div>

      {wallet?.denied && (
        <div className="mb-8 rounded-2xl border border-accent/30 bg-accent-soft p-4 text-sm">
          <p className="font-bold">Wallet totals need elevated access</p>
          <p className="mt-1 text-ink-soft">
            Set <code className="rounded bg-paper px-1">role: &quot;admin&quot;</code> on your profiles row
            (or set <code className="rounded bg-paper px-1">NEXT_PUBLIC_ADMIN_UID</code>) to read the
            platform payout ledger.
          </p>
        </div>
      )}

      {/* Pending review — moderation queue */}
      {pending.length > 0 && (
        <div className="mb-10">
          <h2 className="mb-4 font-display text-xl font-black">
            Pending review <span className="text-accent">({pending.length})</span>
          </h2>
          <ul className="space-y-3">
            {pending.map((p) => (
              <li
                key={p.id}
                className="rounded-2xl border border-accent/40 bg-accent-soft/50 p-3"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => setGallery({ product: p, index: 0 })}
                    disabled={!isValidPhotoUrl(p.imageUrl)}
                    aria-label={`View photos of ${p.title}`}
                    title="View photos"
                    className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-sand transition hover:ring-2 hover:ring-accent disabled:cursor-default disabled:hover:ring-0"
                  >
                    {isValidPhotoUrl(p.imageUrl) ? (
                      <Image src={p.imageUrl} alt={p.title} fill sizes="56px" className="object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-xl">🧵</span>
                    )}
                    {photoCount(p) > 1 && (
                      <span className="absolute bottom-0 right-0 rounded-tl-lg bg-ink/75 px-1.5 py-0.5 text-[9px] font-extrabold leading-none text-cream">
                        📷 {photoCount(p)}
                      </span>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{p.title}</p>
                    <p className="text-xs text-ink-soft">
                      by {p.sellerName ?? "user"} · {p.category} · {formatKes(p.priceKes)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => run(p.id, () => approveListing(p))}
                      disabled={busyId === p.id}
                      className="rounded-full bg-lime px-4 py-1.5 text-xs font-bold text-ink transition hover:brightness-95 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        setRejectOpenId(rejectOpenId === p.id ? null : p.id);
                        setRejectNote("");
                      }}
                      disabled={busyId === p.id}
                      className="rounded-full border border-accent px-4 py-1.5 text-xs font-bold text-accent transition hover:bg-accent hover:text-white disabled:opacity-50"
                    >
                      {rejectOpenId === p.id ? "Cancel" : "Reject"}
                    </button>
                  </div>
                </div>

                {/* Rejection note — why it wasn't accepted (shown to the seller) */}
                {rejectOpenId === p.id && (
                  <div className="mt-3 rounded-xl border border-accent/25 bg-paper p-3">
                    <label
                      htmlFor={`reject-note-${p.id}`}
                      className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-ink-soft"
                    >
                      Why not?{" "}
                      <span className="normal-case">(shown to the seller so they can fix it)</span>
                    </label>
                    <textarea
                      id={`reject-note-${p.id}`}
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      maxLength={300}
                      rows={3}
                      autoFocus
                      placeholder="e.g. Photos too blurry. Retake in daylight against a plain background"
                      className="w-full resize-none rounded-xl border border-line bg-cream px-3 py-2 text-sm outline-none transition focus:border-accent"
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] text-ink-soft">
                        {rejectNote.trim()
                          ? `${rejectNote.trim().length}/300`
                          : "Optional. You can reject without a note."}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setRejectOpenId(null);
                            setRejectNote("");
                          }}
                          className="rounded-full border border-line px-4 py-1.5 text-xs font-bold text-ink-soft transition hover:border-ink hover:text-ink"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() =>
                            run(p.id, () => removeProduct(p, rejectNote.trim() || undefined))
                          }
                          disabled={busyId === p.id}
                          className="rounded-full bg-accent px-4 py-1.5 text-xs font-bold text-white transition hover:bg-accent-deep disabled:opacity-50"
                        >
                          {busyId === p.id ? "Rejecting…" : "Confirm rejection"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Add a piece (owner) */}
      <AddPieceForm />

      {/* Locations & coverage — where buyers live vs. where pieces meet */}
      <div className="mb-10">
        <h2 className="mb-4 font-display text-xl font-black">Locations &amp; coverage</h2>
        {locations === null || profiles === null ? (
          <p className="rounded-2xl border border-dashed border-line bg-paper p-6 text-center text-sm text-ink-soft">
            Loading location data…
          </p>
        ) : (
          <>
            <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className={card}>
                <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Buyers with an area</p>
                <p className="mt-2 font-display text-3xl font-black">{locationStats.totalBuyers}</p>
                <p className="mt-1 text-xs text-ink-soft">of {(profiles ?? []).length} profiles</p>
              </div>
              <div className={card}>
                <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Counties with buyers</p>
                <p className="mt-2 font-display text-3xl font-black">
                  {locationStats.countiesWithBuyers} / {locationStats.totalCounties}
                </p>
                <p className="mt-1 text-xs text-ink-soft">of the 47-county catalog</p>
              </div>
              <div className={card}>
                <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Counties with live pieces</p>
                <p className="mt-2 font-display text-3xl font-black">{locationStats.countiesWithPieces}</p>
                <p className="mt-1 text-xs text-ink-soft">where sellers meet</p>
              </div>
              <div className={card}>
                <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Areas with activity</p>
                <p className="mt-2 font-display text-3xl font-black">{locationStats.rows.length}</p>
                <p className="mt-1 text-xs text-ink-soft">buyers or live pieces</p>
              </div>
            </div>

            {locationStats.gaps.length > 0 && (
              <div className="mb-4 rounded-2xl border border-accent/30 bg-accent-soft/50 p-4 text-sm">
                <p className="font-bold">Seed pieces here 🎯</p>
                <p className="mt-1 leading-relaxed text-ink-soft">
                  {locationStats.gaps.map(([city, n], i) => (
                    <span key={city}>
                      {i > 0 && " · "}
                      <span className="font-bold text-ink">{city}</span> ({n} buyer{n === 1 ? "" : "s"}, no live
                      pieces)
                    </span>
                  ))}{" "}
                  These counties have buyers but no drops meeting there yet.
                </p>
              </div>
            )}

            {locationStats.rows.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-[11px] font-bold uppercase tracking-widest text-ink-soft">
                      <th className="px-4 py-3">County</th>
                      <th className="px-4 py-3">Area</th>
                      <th className="px-4 py-3 text-right">Buyers</th>
                      <th className="px-4 py-3 text-right">Live pieces</th>
                      <th className="px-4 py-3 text-right">Sellers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locationStats.rows.map((r) => (
                      <tr
                        key={`${r.city}|${r.area}`}
                        className="border-b border-line/60 transition hover:bg-sand/40 last:border-0"
                      >
                        <td className="px-4 py-2.5 font-bold">{r.city}</td>
                        <td className="px-4 py-2.5 text-ink-soft">{r.area}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{r.buyers}</td>
                        <td className={`px-4 py-2.5 text-right font-semibold ${r.pieces === 0 ? "text-accent" : ""}`}>
                          {r.pieces === 0 ? "0" : r.pieces}
                        </td>
                        <td className="px-4 py-2.5 text-right text-ink-soft">{r.sellers || "0"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-line bg-paper p-6 text-center text-sm text-ink-soft">
                No location activity yet. Set an area on your profile and seed a few pieces to get
                the map going.
              </p>
            )}
          </>
        )}
      </div>

      {/* Payout reports — sellers flag payouts they never received */}
      {payoutReports !== null && payoutReports.length > 0 && (
        <div className="mb-10">
          <h2 className="mb-4 font-display text-xl font-black">
            Payout reports{" "}
            {openReports.length > 0 && <span className="text-accent">({openReports.length} open)</span>}
          </h2>
          {reportMsg && (
            <p className="mb-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm font-medium">
              {reportMsg}
            </p>
          )}
          <ul className="space-y-3">
            {payoutReports.map((r) => {
              const linked = payoutById.get(r.payoutId);
              return (
                <li
                  key={r.id}
                  className={`rounded-2xl border p-3 ${
                    r.status === "open" ? "border-accent/40 bg-accent-soft/50" : "border-line bg-paper"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">
                        {linked ? formatKes(linked.amountKes) : "Payout"}
                        {r.status === "open" ? " · unconfirmed" : " · resolved"}{" "}
                        · {formatDate(r.createdAt)}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-soft">
                        Seller {r.userId.slice(0, 8)}…{r.status === "open" ? " reported" : ""}: {r.reason}
                      </p>
                      {r.status === "resolved" && r.adminNote && (
                        <p className="mt-0.5 text-xs text-ink-soft">Owner note: {r.adminNote}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                        r.status === "open" ? "bg-accent-soft text-accent" : "bg-lime text-ink"
                      }`}
                    >
                      {r.status === "open" ? "Open" : "Resolved"}
                    </span>
                  </div>
                  {r.status === "open" && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-accent/20 pt-2.5">
                      {linked && linked.status === "pending" && (
                        <button
                          onClick={() => handleReportedPayout(linked.id)}
                          disabled={payoutBusyId === linked.id}
                          className="rounded-full bg-ink px-4 py-1.5 text-xs font-bold text-cream transition hover:bg-accent disabled:opacity-50"
                        >
                          {payoutBusyId === linked.id ? "Sending…" : "Re-send payout"}
                        </button>
                      )}
                      <input
                        value={reportNote[r.id] ?? ""}
                        onChange={(e) => setReportNote((n) => ({ ...n, [r.id]: e.target.value }))}
                        placeholder="Owner note (optional)"
                        className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-1.5 text-xs outline-none transition focus:border-ink"
                      />
                      <button
                        onClick={() => handleResolveReport(r.id)}
                        disabled={reportBusyId === r.id}
                        className="rounded-full border border-line bg-paper px-4 py-1.5 text-xs font-bold text-ink-soft transition hover:border-ink hover:text-ink disabled:opacity-50"
                      >
                        {reportBusyId === r.id ? "Resolving…" : "Mark resolved"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Settlements — pay the sellers' up-to-90% via Paystack Transfer */}
      <div className="mb-10">
        <h2 className="mb-4 font-display text-xl font-black">
          Settlements{" "}
          {pendingPayouts.length > 0 && (
            <span className="text-accent">({pendingPayouts.length} to pay out)</span>
          )}
        </h2>
        {payoutMsg && (
          <p className="mb-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm font-medium">
            {payoutMsg}
          </p>
        )}
        {otpFor && (
          <div className="mb-3 rounded-2xl border border-accent/30 bg-accent-soft p-4">
            <p className="text-sm font-bold">
              Enter the OTP Paystack sent to the business phone
            </p>
            <p className="mt-0.5 text-xs text-ink-soft">
              Transfers that need OTP confirmation stay pending until you confirm.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={otpValue}
                onChange={(e) => setOtpValue(e.target.value)}
                placeholder="6-digit OTP"
                inputMode="numeric"
                className="w-40 rounded-xl border border-line bg-paper px-3 py-2 text-sm outline-none transition focus:border-ink"
              />
              <button
                onClick={handleConfirmOtp}
                disabled={payoutBusyId === otpFor || otpValue.trim().length < 4}
                className="rounded-full bg-ink px-4 py-1.5 text-xs font-bold text-cream transition hover:bg-accent disabled:opacity-50"
              >
                {payoutBusyId === otpFor ? "Confirming…" : "Confirm transfer"}
              </button>
              <button
                onClick={() => {
                  setOtpFor(null);
                  setOtpValue("");
                }}
                className="rounded-full border border-line px-4 py-1.5 text-xs font-bold text-ink-soft transition hover:border-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {sellerPayouts && sellerPayouts.length > 0 ? (
          <ul className="space-y-3">
            {sellerPayouts.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-paper p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">
                    {formatKes(p.amountKes)} · {formatDate(p.createdAt)}
                  </p>
                  {p.failureReason && <p className="text-xs text-ink-soft">{p.failureReason}</p>}
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
                {p.status === "escrow" && (
                  <span
                    title="Held until the buyer confirms delivery (or the 24h window auto-releases it)."
                    className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-bold text-ink-soft"
                  >
                    Awaiting delivery
                  </span>
                )}
                {p.status === "pending" && (
                  <button
                    onClick={() => handlePayout(p.id)}
                    disabled={payoutBusyId === p.id}
                    className="shrink-0 rounded-full bg-ink px-4 py-1.5 text-xs font-bold text-cream transition hover:bg-accent disabled:opacity-50"
                  >
                    {payoutBusyId === p.id ? "Sending…" : "Pay out"}
                  </button>
                )}
                {p.status === "processing" && (
                  <button
                    onClick={() => run(p.id, () => resetPayoutAdmin(p.id))}
                    disabled={busyId === p.id}
                    title="Callback never arrived. Verify with Safaricom, then mark failed to free the queue."
                    className="shrink-0 rounded-full border border-line px-4 py-1.5 text-xs font-bold text-ink-soft transition hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    Mark failed
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : sellerPayouts !== null ? (
          <p className="rounded-2xl border border-dashed border-line bg-paper p-6 text-center text-sm text-ink-soft">
            No seller payouts yet. They appear here the moment a community piece sells.
          </p>
        ) : null}
      </div>

      {/* Order disputes — buyers who never received their piece */}
      <div className="mb-10">
        <h2 className="mb-4 font-display text-xl font-black">
          Order disputes{" "}
          {openDisputes.length > 0 && <span className="text-accent">({openDisputes.length} open)</span>}
        </h2>
        {disputeMsg && (
          <p className="mb-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm font-medium">
            {disputeMsg}
          </p>
        )}
        {orderDisputes && orderDisputes.length > 0 ? (
          <ul className="space-y-3">
            {orderDisputes.map((d) => {
              const linked = orderById.get(d.orderId);
              const open = d.status === "open";
              return (
                <li
                  key={d.id}
                  className={`rounded-2xl border p-3 ${
                    open ? "border-accent/40 bg-accent-soft/50" : "border-line bg-paper"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">
                        {linked ? linked.productSnapshot.title : "Order"} ·{" "}
                        {linked ? formatKes(linked.amountKes) : "N/A"} · {formatDate(d.createdAt)}
                      </p>
                      {d.reason && <p className="mt-0.5 text-xs text-ink-soft">Buyer says: {d.reason}</p>}
                      {!open && d.adminNote && (
                        <p className="mt-0.5 text-xs text-ink-soft">Owner note: {d.adminNote}</p>
                      )}
                      {open && linked?.escrowHeldAt && (
                        <p className="mt-0.5 text-[11px] text-ink-soft">Seller payout is held in escrow.</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                        open ? "bg-accent-soft text-accent" : "bg-lime text-ink"
                      }`}
                    >
                      {open ? "Open" : "Resolved"}
                    </span>
                  </div>
                  {open && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-accent/20 pt-2.5">
                      <button
                        onClick={() => handleResolveDispute(d.id, "release", "Seller delivered")}
                        disabled={disputeBusyId === d.id}
                        className="rounded-full bg-lime px-4 py-1.5 text-xs font-bold text-ink transition hover:brightness-95 disabled:opacity-50"
                      >
                        Seller delivered. Release
                      </button>
                      <button
                        onClick={() => handleResolveDispute(d.id, "cancel", "Buyer never received it")}
                        disabled={disputeBusyId === d.id}
                        className="rounded-full bg-accent px-4 py-1.5 text-xs font-bold text-white transition hover:bg-accent-deep disabled:opacity-50"
                      >
                        Cancel &amp; refund buyer
                      </button>
                      <button
                        onClick={() => handleResolveDispute(d.id, "fail", "Seller not paid")}
                        disabled={disputeBusyId === d.id}
                        className="rounded-full border border-line px-4 py-1.5 text-xs font-bold text-ink-soft transition hover:border-accent hover:text-accent disabled:opacity-50"
                      >
                        Fail seller payout
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : orderDisputes !== null ? (
          <p className="rounded-2xl border border-dashed border-line bg-paper p-6 text-center text-sm text-ink-soft">
            No disputes. Everyone&apos;s happy.
          </p>
        ) : null}
      </div>

      {/* Refunds — money owed back to buyers after cancellations */}
      <div className="mb-10">
        <h2 className="mb-4 font-display text-xl font-black">
          Refunds{" "}
          {(refundPayouts ?? []).length > 0 && (
            <span className="text-accent">({(refundPayouts ?? []).length})</span>
          )}
        </h2>
        {refundPayouts && refundPayouts.length > 0 ? (
          <ul className="space-y-3">
            {refundPayouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-paper p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">
                    {formatKes(p.amountKes)} refund
                    {p.refundPhone ? ` → ${p.refundPhone}` : ""}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {formatDate(p.createdAt)}
                    {p.status === "paid" && p.providerRef ? ` · paid (${p.providerRef})` : ""}
                    {p.failureReason ? ` · ${p.failureReason}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                    p.status === "paid"
                      ? "bg-lime text-ink"
                      : p.status === "failed"
                        ? "bg-sand text-ink-soft"
                        : "bg-accent-soft text-accent"
                  }`}
                >
                  {p.status === "paid"
                    ? "Paid ✓"
                    : p.status === "failed"
                      ? "Failed"
                      : p.status === "processing"
                        ? "Sending…"
                        : "Pending"}
                </span>
                {p.status === "pending" && (
                  <button
                    onClick={() => handlePayout(p.id)}
                    disabled={payoutBusyId === p.id}
                    className="shrink-0 rounded-full bg-ink px-4 py-1.5 text-xs font-bold text-cream transition hover:bg-accent disabled:opacity-50"
                  >
                    {payoutBusyId === p.id ? "Sending…" : "Pay refund"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : refundPayouts !== null ? (
          <p className="rounded-2xl border border-dashed border-line bg-paper p-6 text-center text-sm text-ink-soft">
            No refunds owed right now.
          </p>
        ) : null}
      </div>

      {/* Products */}
      <div>
        <h2 className="mb-4 font-display text-xl font-black">All pieces</h2>
        {products && products.length > 0 ? (
          <ul className="space-y-3">
            {products.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-2xl border border-line bg-paper p-3">
                <button
                  onClick={() => setGallery({ product: p, index: 0 })}
                  disabled={!isValidPhotoUrl(p.imageUrl)}
                  aria-label={`View photos of ${p.title}`}
                  title="View photos"
                  className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-sand transition hover:ring-2 hover:ring-accent disabled:cursor-default disabled:hover:ring-0"
                >
                  {isValidPhotoUrl(p.imageUrl) ? (
                    <Image src={p.imageUrl} alt={p.title} fill sizes="56px" className="object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-xl">🧵</span>
                  )}
                  {photoCount(p) > 1 && (
                    <span className="absolute bottom-0 right-0 rounded-tl-lg bg-ink/75 px-1.5 py-0.5 text-[9px] font-extrabold leading-none text-cream">
                      📷 {photoCount(p)}
                    </span>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{p.title}</p>
                  <p className="text-xs text-ink-soft">
                    {p.source === "community" ? `by ${p.sellerName ?? "user"}` : "platform"} ·{" "}
                    {formatKes(p.priceKes)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                    p.status === "pending"
                      ? "bg-accent-soft text-accent"
                      : p.source === "community"
                        ? "bg-lime text-ink"
                        : "bg-sand text-ink-soft"
                  }`}
                >
                  {p.status === "pending" ? "Pending" : p.source === "community" ? "Community" : "Platform"}
                </span>
                {p.status === "active" && p.boostExpiresAt && p.boostExpiresAt.getTime() > now && (
                  <span
                    title={`Boosted until ${formatDate(p.boostExpiresAt)}`}
                    className="shrink-0 rounded-full bg-amber-400 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-ink"
                  >
                    Boosted ⚡
                  </span>
                )}
                <button
                  onClick={() => run(p.id, () => removeProduct(p))}
                  disabled={busyId === p.id}
                  className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-bold text-ink-soft transition hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : products !== null ? (
          <p className="rounded-2xl border border-dashed border-line bg-paper p-6 text-center text-sm text-ink-soft">
            No products yet. Add your first platform piece below.
          </p>
        ) : null}
      </div>

      {/* Full photo gallery for the piece under review */}
      {gallery && (
        <ProductGalleryModal
          product={gallery.product}
          initialIndex={gallery.index}
          onClose={() => setGallery(null)}
        />
      )}
    </section>
  );
}

/** Number of uploaded photos for a product (1 = just the cover). */
function photoCount(p: Product): number {
  return p.imageUrls && p.imageUrls.length > 0 ? p.imageUrls.length : 1;
}

/** Guard so a missing/placeholder URL renders a tile instead of crashing <Image>. */
function isValidPhotoUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

const EMPTY_PIECE = {
  title: "",
  brand: "",
  category: "Tops" as ProductCategory,
  size: "",
  condition: "Very good",
  priceKes: "",
  description: "",
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Owner-only form: drops a platform piece straight onto the live feed. */
function AddPieceForm() {
  const { user } = useAuth();
  const { showToast } = useShop();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_PIECE);
  const [photo, setPhoto] = useState<{ file: File; previewUrl: string } | null>(null);
  const [meetup, setMeetup] = useState<Location | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // Keep the latest photo in a ref so the unmount cleanup can revoke the
  // preview URL without a stale closure.
  const photoRef = useRef(photo);
  useEffect(() => {
    photoRef.current = photo;
  });
  useEffect(() => {
    return () => {
      if (photoRef.current) URL.revokeObjectURL(photoRef.current.previewUrl);
    };
  }, []);

  const set = <K extends keyof typeof EMPTY_PIECE>(key: K, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const price = Number(form.priceKes);

  const inputCls =
    "w-full rounded-2xl border border-line bg-paper px-4 py-3 text-sm outline-none transition focus:border-ink";
  const labelCls = "mb-1.5 block text-xs font-bold uppercase tracking-widest text-ink-soft";

  const handlePhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES) {
      setMessage("Use an image file under 5 MB.");
      return;
    }
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setPhoto({ file, previewUrl: URL.createObjectURL(file) });
    setMessage("");
  };

  const clearPhoto = () => {
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setPhoto(null);
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user || busy) return;
    if (!Number.isFinite(price) || price <= 0) {
      setMessage("Enter a valid price in KES.");
      return;
    }
    if (!photo) {
      setMessage("Add a photo of the piece.");
      return;
    }
    if (!meetup) {
      setMessage("Pick a meetup location. Platform pieces need one so buyers know where to find them.");
      return;
    }
    setBusy(true);
    setMessage("");
    let uploaded: UploadedImage | null = null;
    try {
      uploaded = await uploadProductImage(user.id, photo.file);
      await createPlatformProduct({
        item: {
          title: form.title,
          brand: form.brand || "Unknown",
          category: form.category,
          size: form.size || "Various",
          condition: form.condition,
          priceKes: price,
          imageUrl: uploaded.url,
          description: form.description || undefined,
          locationId: meetup.id,
          locationLabel: meetup ? `${meetup.city} · ${meetup.area}` : null,
        },
      });
      clearPhoto();
      setMeetup(null);
      setForm(EMPTY_PIECE);
      setOpen(false);
      showToast("Piece added to the feed ✨");
    } catch {
      if (uploaded) await removeProductImage(uploaded.path);
      setMessage("Couldn't add the piece. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-10">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-full bg-ink px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-cream transition hover:bg-accent"
      >
        {open ? "− Close" : "＋ Add a piece"}
      </button>
      {open && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-4 rounded-3xl border border-line bg-paper p-6">
          <p className="text-sm text-ink-soft">
            Adds a <span className="font-bold text-ink">platform</span> piece straight to the feed.
            100% of its sale goes to your wallet (no commission split).
          </p>
          <div>
            <label className={labelCls} htmlFor="piece-title">Title</label>
            <input
              id="piece-title"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              required
              placeholder="e.g. Vintage Levi's Denim Jacket"
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="piece-brand">Brand</label>
              <input
                id="piece-brand"
                value={form.brand}
                onChange={(e) => set("brand", e.target.value)}
                placeholder="Levi's"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="piece-size">Size</label>
              <input
                id="piece-size"
                value={form.size}
                onChange={(e) => set("size", e.target.value)}
                placeholder="M / 42 / One size"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="piece-category">Category</label>
              <select
                id="piece-category"
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                className={inputCls}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="piece-condition">Condition</label>
              <select
                id="piece-condition"
                value={form.condition}
                onChange={(e) => set("condition", e.target.value)}
                className={inputCls}
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="piece-price">Price (KES)</label>
            <input
              id="piece-price"
              type="number"
              min={1}
              value={form.priceKes}
              onChange={(e) => set("priceKes", e.target.value)}
              required
              placeholder="1200"
              className={inputCls}
            />
          </div>
          <div>
            <span className={labelCls}>
              Where will you hand over the piece? <span className="text-accent">*</span>
            </span>
            <LocationPicker value={meetup?.id ?? null} onChange={setMeetup} />
            {meetup ? (
              <p className="mt-1.5 text-xs text-lime">
                ✓ Meet area locked: {meetup.city} · {meetup.area}
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-ink-soft">
                Required. Buyers see this as the area you meet in when the piece sells. You can
                agree on the exact spot in the order chat.
              </p>
            )}
          </div>
          <div>
            <span className={labelCls}>Photo</span>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line bg-paper px-4 py-6 text-center transition hover:border-accent hover:bg-sand/60">
              {photo ? (
                <div className="relative h-36 w-full overflow-hidden rounded-xl bg-sand">
                  <Image
                    src={photo.previewUrl}
                    alt="Preview"
                    fill
                    sizes="100%"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              ) : (
                <>
                  <span className="text-2xl">📸</span>
                  <span className="mt-1.5 text-xs font-bold text-ink">Tap to choose a photo</span>
                </>
              )}
              <input type="file" accept="image/*" className="sr-only" onChange={handlePhoto} />
            </label>
            {photo && (
              <button
                type="button"
                onClick={clearPhoto}
                className="mt-1.5 text-xs font-bold text-accent underline-offset-2 hover:underline"
              >
                Remove photo
              </button>
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="piece-desc">Description</label>
            <textarea
              id="piece-desc"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              placeholder="Era, flaws, why it's a 10/10…"
              className={inputCls}
            />
          </div>
          {message && (
            <p className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm font-medium">
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-sm font-bold uppercase tracking-wider text-white transition hover:bg-accent-deep disabled:opacity-60"
          >
            {busy ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              "Add to the feed"
            )}
          </button>
        </form>
      )}
    </div>
  );
}
