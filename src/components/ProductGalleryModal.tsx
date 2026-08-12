"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import Modal from "./ui/Modal";
import type { Product } from "@/lib/types";
import { formatKes } from "@/lib/format";

/**
 * Full photo gallery for a piece — every uploaded shot, not just the cover.
 * Prev/next arrows, dot indicators, a thumbnail strip, keyboard arrow keys,
 * and swipe. Opened from the product card (click the photo / the "N photos"
 * badge); the buyer can also tap through the thumbnails before checking out.
 */
export default function ProductGalleryModal({
  product,
  initialIndex = 0,
  onClose,
}: {
  product: Product;
  initialIndex?: number;
  onClose: () => void;
}) {
  const photos = product.imageUrls && product.imageUrls.length > 0 ? product.imageUrls : [product.imageUrl];
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), photos.length - 1));
  const [touchX, setTouchX] = useState<number | null>(null);

  // Clamp when photos change under the modal (e.g. realtime edit).
  const key = `${product.id}:${photos.length}`;
  const [clampedKey, setClampedKey] = useState(key);
  if (key !== clampedKey) {
    setClampedKey(key);
    setIndex((i) => Math.min(i, photos.length - 1));
  }

  const go = (dir: 1 | -1) => setIndex((i) => (i + dir + photos.length) % photos.length);

  // Keyboard: arrows navigate, Escape is handled by Modal.
  useEffect(() => {
    if (photos.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length]);

  const single = photos.length === 1;

  return (
    <Modal open onClose={onClose} label={`${product.title} photos`} wide>
      <div className="p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-xl font-black tracking-tight">{product.title}</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              {photos.length > 1 ? `${index + 1} / ${photos.length} photos` : "1 photo"} ·{" "}
              {formatKes(product.priceKes)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close gallery"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-ink-soft transition hover:bg-sand hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* Stage — swipeable main photo */}
        <div
          className="relative aspect-[4/5] w-full touch-pan-y select-none overflow-hidden rounded-2xl bg-sand"
          onPointerDown={(e) => setTouchX(e.clientX)}
          onPointerUp={(e) => {
            if (touchX === null || single) return;
            const dx = e.clientX - touchX;
            if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
            setTouchX(null);
          }}
          onPointerCancel={() => setTouchX(null)}
          onPointerLeave={() => setTouchX(null)}
        >
          <Image
            key={photos[index]}
            src={photos[index]}
            alt={`${product.title}, photo ${index + 1}`}
            fill
            sizes="(min-width: 768px) 48rem, 100vw"
            quality={95}
            className="object-cover"
            priority
          />

          {!single && (
            <>
              <button
                onClick={() => go(-1)}
                aria-label="Previous photo"
                className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-ink/60 text-lg text-white backdrop-blur transition hover:bg-ink/80 active:scale-95"
              >
                ←
              </button>
              <button
                onClick={() => go(1)}
                aria-label="Next photo"
                className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-ink/60 text-lg text-white backdrop-blur transition hover:bg-ink/80 active:scale-95"
              >
                →
              </button>
            </>
          )}

          {/* Dots */}
          {!single && (
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
              {photos.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIndex(i)}
                  aria-label={`Go to photo ${i + 1}`}
                  className={`h-2 rounded-full transition-all ${
                    i === index ? "w-5 bg-white" : "w-2 bg-white/50 hover:bg-white/80"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Thumbnail strip */}
        {photos.length > 1 && (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <button
                key={p}
                onClick={() => setIndex(i)}
                aria-label={`View photo ${i + 1}`}
                className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl transition ${
                  i === index
                    ? "ring-2 ring-accent ring-offset-2 ring-offset-paper"
                    : "opacity-70 hover:opacity-100"
                }`}
              >
                <Image src={p} alt="" fill sizes="64px" className="object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
