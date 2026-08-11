"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useShop } from "@/context/ShopContext";
import { useProducts, useWishlistIds } from "@/lib/db";
import ProductCard from "@/components/ProductCard";

function SignedOutWishlist() {
  const { openAuth } = useShop();
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <span className="text-5xl">🤍</span>
      <h1 className="mt-4 font-display text-3xl font-black tracking-tight sm:text-4xl">
        Your saved fits
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
        Sign in to save 1-of-1 pieces and get first dibs before they sell.
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

export default function WishlistPage() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const wishlistIds = useWishlistIds(uid);
  const products = useProducts();

  if (!user) return <SignedOutWishlist />;

  if (wishlistIds === null || products === null) {
    return (
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="h-8 w-40 animate-pulse rounded-full bg-sand" />
        <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-sand" />
          ))}
        </div>
      </section>
    );
  }

  const savedProducts = products.filter((p) => wishlistIds.includes(p.id));
  const soldOutIds = wishlistIds.filter((id) => !products.some((p) => p.id === id));

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-accent">Saved pieces</p>
          <h1 className="mt-1 font-display text-3xl font-black tracking-tight sm:text-4xl">
            Your wishlist
          </h1>
        </div>
        <Link
          href="/#drops"
          className="rounded-full border-2 border-ink px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition hover:bg-ink hover:text-cream"
        >
          Browse drops
        </Link>
      </div>

      {savedProducts.length === 0 && soldOutIds.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-paper p-10 text-center text-sm text-ink-soft">
          Nothing saved yet. Tap the 🤍 on any piece to keep it here.
        </p>
      ) : (
        <>
          {savedProducts.length > 0 && (
            <div className="grid grid-cols-2 gap-5 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
              {savedProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}

          {soldOutIds.length > 0 && (
            <div className="mt-10">
              <h2 className="mb-4 font-display text-lg font-black">
                Sold out {soldOutIds.length > 1 ? `(${soldOutIds.length})` : ""}
              </h2>
              <div className="grid grid-cols-2 gap-5 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
                {soldOutIds.map((id) => (
                  <div
                    key={id}
                    className="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-sand/50 p-6 text-center"
                  >
                    <span className="text-3xl">✕</span>
                    <p className="font-display text-sm font-bold">This 1-of-1 sold out</p>
                    <p className="text-xs text-ink-soft">
                      It&apos;s gone for good. New drops land weekly.
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <p className="mt-10 text-center text-xs text-ink-soft">
        Saved pieces stay here even after they sell. First dibs to buy when a drop lands.
      </p>
    </section>
  );
}
