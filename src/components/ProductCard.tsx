"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import type { Product } from "@/lib/types";
import { formatKes } from "@/lib/format";
import { useShop } from "@/context/ShopContext";
import { useAuth } from "@/context/AuthContext";
import { toggleWishlist, useWishlistIds } from "@/lib/db";
import { gsap, useGSAP } from "@/lib/gsap";
import SellerClosetModal from "./SellerClosetModal";
import ProductGalleryModal from "./ProductGalleryModal";

export default function ProductCard({ product }: { product: Product }) {
  const { openCheckout, gateAction, authOpen } = useShop();
  const { user } = useAuth();
  const wishlistIds = useWishlistIds(user?.id ?? null);
  const artRef = useRef<HTMLDivElement>(null);

  // Subtle 3D tilt following the pointer — makes cards feel alive. Skipped
  // for touch pointers (would fight page scrolling) and reduced motion.
  useGSAP(
    () => {
      const card = artRef.current;
      if (!card) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.set(card, { transformPerspective: 800 });
      const rotX = gsap.quickTo(card, "rotationX", { duration: 0.45, ease: "power2.out" });
      const rotY = gsap.quickTo(card, "rotationY", { duration: 0.45, ease: "power2.out" });

      const onMove = (e: PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        rotY(px * 8);
        rotX(-py * 6);
      };
      const onLeave = () => {
        rotX(0);
        rotY(0);
      };
      card.addEventListener("pointermove", onMove);
      card.addEventListener("pointerleave", onLeave);
      return () => {
        card.removeEventListener("pointermove", onMove);
        card.removeEventListener("pointerleave", onLeave);
      };
    },
    { scope: artRef }
  );

  const saved = wishlistIds?.includes(product.id) ?? false;
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [resetKey, setResetKey] = useState("");
  const [closetOpen, setClosetOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);

  // Drop the optimistic state when the product changes or a pending
  // sign-in (for saving) is cancelled — render-time adjustment, no effect.
  const key = `${product.id}:${authOpen}`;
  if (key !== resetKey) {
    setResetKey(key);
    setOptimistic(null);
  }
  const isSaved = optimistic ?? saved;

  const handleSave = () => {
    const next = !isSaved;
    setOptimistic(next);
    gateAction(
      (u) => {
        toggleWishlist(u.id, product.id, next).catch(() => setOptimistic(null));
      },
      { type: "wishlist", productId: product.id, next }
    );
  };

  return (
    <article className="group relative">
      <div
        ref={artRef}
        onClick={() => setGalleryOpen(true)}
        className="relative aspect-[4/5] cursor-zoom-in overflow-hidden rounded-2xl bg-sand"
      >
        <Image
          src={product.imageUrl}
          alt={product.title}
          fill
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          quality={95}
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white">
            1-of-1
          </span>
          {product.isNewDrop && (
            <span className="rounded-full bg-lime px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-ink">
              New
            </span>
          )}
          {product.isBoosted && (
            <span className="rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-ink shadow-sm">
              Boosted ⚡
            </span>
          )}
          {product.source === "community" && (
            <span className="rounded-full bg-paper/90 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-ink backdrop-blur">
              Community
            </span>
          )}
          {product.imageUrls && product.imageUrls.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setGalleryOpen(true);
              }}
              className="rounded-full bg-paper/90 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-ink backdrop-blur transition hover:bg-paper"
            >
              📷 {product.imageUrls.length} photos
            </button>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            handleSave();
          }}
          aria-label={isSaved ? "Remove from saved" : "Save piece"}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-paper/85 text-lg backdrop-blur transition hover:scale-110 active:scale-95"
        >
          {isSaved ? "❤️" : "🤍"}
        </button>

        {product.imageUrls && product.imageUrls.length > 1 && (
          <div className="absolute left-3 top-14 flex flex-col gap-1">
            {product.imageUrls.slice(0, 4).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-colors ${
                  i === 0 ? "w-3.5 bg-lime" : "w-1.5 bg-paper/70"
                }`}
              />
            ))}
          </div>
        )}

        <div className="absolute inset-x-3 bottom-3 translate-y-3 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openCheckout(product);
            }}
            className="w-full rounded-full bg-ink/90 py-3 text-sm font-bold uppercase tracking-wider text-cream backdrop-blur transition hover:bg-accent"
          >
            Buy now · {formatKes(product.priceKes)}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink-soft">
            {product.brand} · {product.category}
          </p>
          <h3 className="mt-0.5 truncate font-display text-base font-bold">{product.title}</h3>
          <p className="mt-0.5 text-xs text-ink-soft">
            {product.size} · {product.condition}
            {product.era ? ` · ${product.era}` : ""}
          </p>
          {product.sellerId && product.sellerName && (
            <button
              onClick={() => setClosetOpen(true)}
              className="mt-1.5 text-[11px] font-bold text-accent underline-offset-2 transition hover:underline"
            >
              View {product.sellerName}&apos;s closet
            </button>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <p className="whitespace-nowrap font-display text-lg font-extrabold">{formatKes(product.priceKes)}</p>
          <button
            onClick={() => openCheckout(product)}
            className="rounded-full bg-ink px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-cream transition hover:bg-accent md:hidden"
          >
            Buy
          </button>
        </div>
      </div>

      {closetOpen && product.sellerId && (
        <SellerClosetModal
          sellerId={product.sellerId}
          sellerName={product.sellerName ?? null}
          excludeProductId={product.id}
          onClose={() => setClosetOpen(false)}
          onPick={(p) => {
            setClosetOpen(false);
            openCheckout(p);
          }}
        />
      )}

      {galleryOpen && (
        <ProductGalleryModal product={product} onClose={() => setGalleryOpen(false)} />
      )}
    </article>
  );
}
