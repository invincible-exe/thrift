"use client";

import Link from "next/link";
import { useState } from "react";
import type { SellerProfile } from "@/app/seller/[id]/page";
import type { Product } from "@/lib/types";
import { formatDate } from "@/lib/format";
import RatingStars from "./ui/RatingStars";
import ProductCard from "./ProductCard";

/**
 * Public seller profile — the persistent home for a seller's reputation,
 * since every piece they sell is 1-of-1 and deleted from the catalog on
 * purchase. Shows their rating (the trust signal), sales count, and the
 * pieces currently on their rack.
 */
export default function SellerProfileClient({
  sellerId,
  profile,
  products,
  canonicalUrl,
}: {
  sellerId: string;
  profile: SellerProfile;
  products: Product[];
  canonicalUrl: string;
}) {
  const name = profile.name.trim() || "This seller";
  const initial = (name.charAt(0) || "S").toUpperCase();
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(canonicalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — nothing to do; the URL is in the address bar.
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/#drops"
        className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-ink-soft transition hover:text-ink"
      >
        ← Back to the rack
      </Link>

      {/* Profile header */}
      <div className="mt-5 flex flex-col gap-6 rounded-3xl border border-line bg-paper p-6 sm:flex-row sm:items-center sm:gap-8 sm:p-8">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-ink font-display text-3xl font-black text-cream">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl font-black tracking-tight">{name}&apos;s closet</h1>
          {profile.sellerVerified && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-lime px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-lime-ink">
              ✓ Verified seller
            </span>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <RatingStars sellerId={sellerId} size="md" />
            {profile.locationLabel && (
              <span className="text-xs text-ink-soft">📍 {profile.locationLabel}</span>
            )}
          </div>
          <p className="mt-2 text-sm text-ink-soft">
            {profile.sales > 0
              ? `${profile.sales} sale${profile.sales === 1 ? "" : "s"} · every piece 1-of-1`
              : "New on the rack · every piece 1-of-1"}
            {profile.memberSince ? ` · on 10/10 since ${formatDate(profile.memberSince)}` : ""}
          </p>
        </div>
        <button
          onClick={copyLink}
          className="shrink-0 self-start rounded-full border border-line px-4 py-2 text-xs font-bold text-ink-soft transition hover:border-ink hover:text-ink sm:self-auto"
        >
          {copied ? "✓ Copied" : "🔗 Share this seller"}
        </button>
      </div>

      {/* Their rack */}
      <section className="mt-10">
        <h2 className="font-display text-xl font-black tracking-tight sm:text-2xl">
          On the rack now
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          {products.length > 0
            ? `${products.length} live piece${products.length === 1 ? "" : "s"}: 1-of-1, so they go fast.`
            : "Nothing live right now. Sellers restock weekly."}
        </p>

        {products.length > 0 ? (
          <div className="mt-6 grid grid-cols-2 gap-5 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-3xl border border-dashed border-line bg-paper p-12 text-center">
            <span className="text-4xl">🧺</span>
            <p className="mt-3 font-display text-lg font-bold">The rack is empty right now</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
              {name} has {profile.sales > 0 ? `sold ${profile.sales} piece${profile.sales === 1 ? "" : "s"} and ` : ""}
              restocks with fresh 1-of-1 pieces regularly. Check back soon.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
