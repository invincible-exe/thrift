"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { Product } from "@/lib/types";
import { formatKes } from "@/lib/format";
import { useShop } from "@/context/ShopContext";
import { useAuth } from "@/context/AuthContext";
import { openListingChat, toggleWishlist, useWishlistIds } from "@/lib/db";
import { isVideoUrl } from "@/lib/constants";
import RatingStars from "./ui/RatingStars";
import ListingChat from "./ListingChat";
import { useNow } from "@/lib/use-now";

/**
 * Public product detail page — the shareable, crawlable home for one piece.
 * The server page passes the product (already serialized) plus the canonical
 * URL (computed server-side so it is correct behind tunnels/proxies); this
 * component only adds interactivity: gallery, wishlist, checkout, share.
 */
export default function ProductDetailClient({
  product,
  canonicalUrl,
}: {
  product: Product;
  canonicalUrl: string;
}) {
  const { openCheckout, showToast, gateAction } = useShop();
  const { user } = useAuth();
  const wishlistIds = useWishlistIds(user?.id ?? null);

  const photos =
    product.imageUrls && product.imageUrls.length > 0 ? product.imageUrls : [product.imageUrl];
  const [index, setIndex] = useState(0);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  // The pre-purchase thread with the uploader — opened via RPC, rendered
  // inline below the share buttons once it exists.
  const [chatId, setChatId] = useState<string | null>(null);

  const saved = wishlistIds?.includes(product.id) ?? false;
  const isSaved = optimistic ?? saved;
  const live = product.status === "active";
  // Your own listing — the buy button is replaced with a plain label
  // (sellers can't buy their own pieces; the checkout route + SQL enforce
  // it server-side too).
  const ownsIt = Boolean(user && product.sellerId && product.sellerId === user.id);
  // Render-pure expiry check (Date.now() is never called during render).
  const now = useNow();
  const boosted =
    product.isBoosted ?? Boolean(product.boostExpiresAt && product.boostExpiresAt.getTime() > now);

  const go = (dir: 1 | -1) => setIndex((i) => (i + dir + photos.length) % photos.length);

  // Save through the auth-gated flow (same pattern as ProductCard): flip
  // optimistically, then complete (or roll back) once signed in.
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

  /** Open the pre-purchase chat with the uploader (auth-gated like save). */
  const startChat = () => {
    gateAction(() => {
      openListingChat(product.id)
        .then(setChatId)
        .catch((err: unknown) => {
          const code = err instanceof Error ? err.message : "";
          showToast(
            code === "OWN_PIECE"
              ? "That's your own piece — buyer messages land in your account inbox."
              : code === "NO_SELLER" || code === "PIECE_NOT_FOUND"
                ? "No seller to chat with for this piece."
                : "Couldn't open the chat. Try again."
          );
        });
    });
  };

  const shareText = `${product.title}: ${formatKes(product.priceKes)} · 1-of-1 on 10/10 Thrifts`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${canonicalUrl}`)}`;

  /** Share with photo (falls back to link-only on unsupported browsers). */
  const shareWithPhoto = async () => {
    if (navigator.share && navigator.canShare) {
      try {
        const res = await fetch(photos[index]);
        const blob = await res.blob();
        const isVid = isVideoUrl(photos[index]);
        const ext = isVid
          ? blob.type.includes("webm") ? ".webm" : ".mp4"
          : blob.type.includes("png") ? ".png" : ".jpg";
        const file = new File([blob], `${product.title}${ext}`, {
          type: blob.type,
        });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: product.title,
            text: shareText,
            url: canonicalUrl,
          });
          return;
        }
      } catch {
        // User cancelled or file share failed
      }
    }

    // Fallback: share text + link
    if (navigator.share) {
      try {
        await navigator.share({ title: product.title, text: shareText, url: canonicalUrl });
        return;
      } catch {
        // User cancelled
      }
    }

    // Last resort: copy
    await copyLink();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(canonicalUrl);
      setCopied(true);
      showToast("Link copied. Share it anywhere.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Couldn't copy the link.");
    }
  };

  const specs = [
    { label: "Brand", value: product.brand },
    { label: "Category", value: product.category },
    { label: "Size", value: product.size },
    { label: "Condition", value: product.condition },
    ...(product.era ? [{ label: "Era", value: product.era }] : []),
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/#drops"
        className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-ink-soft transition hover:text-ink"
      >
        ← Back to the rack
      </Link>

      <div className="mt-5 grid gap-8 lg:grid-cols-2 lg:gap-12">
        {/* Gallery */}
        <div>
          <div className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-sand">
            {isVideoUrl(photos[index]) ? (
              <video
                key={photos[index]}
                src={photos[index]}
                className="h-full w-full object-contain"
                controls
                playsInline
                preload="auto"
              />
            ) : (
              <Image
                key={photos[index]}
                src={photos[index]}
                alt={`${product.title}, photo ${index + 1}`}
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                quality={95}
                priority
                className="object-cover"
              />
            )}
            {boosted && (
              <span className="absolute left-4 top-4 rounded-full bg-amber-400 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-lime-ink shadow-sm">
                Boosted ⚡
              </span>
            )}
            <span className="absolute left-4 top-4 rounded-full bg-accent px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-white">
              1-of-1
            </span>
            {product.source === "community" && (
              <span className="absolute left-4 top-14 rounded-full bg-paper/90 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-ink backdrop-blur">
                Community
              </span>
            )}
            {photos.length > 1 && (
              <>
                <button
                  onClick={() => go(-1)}
                  aria-label="Previous photo"
                  className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-ink/50 text-lg text-white backdrop-blur transition hover:bg-ink/80 active:scale-95"
                >
                  ←
                </button>
                <button
                  onClick={() => go(1)}
                  aria-label="Next photo"
                  className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-ink/50 text-lg text-white backdrop-blur transition hover:bg-ink/80 active:scale-95"
                >
                  →
                </button>
              </>
            )}
            {photos.length > 1 && (
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
          {photos.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {photos.map((p, i) => (
                <button
                  key={p}
                  onClick={() => setIndex(i)}
                  aria-label={`View ${isVideoUrl(p) ? "video" : "photo"} ${i + 1}`}
                  className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-xl transition ${
                    i === index
                      ? "ring-2 ring-accent ring-offset-2 ring-offset-paper"
                      : "opacity-70 hover:opacity-100"
                  }`}
                >
                  {isVideoUrl(p) ? (
                    <video src={p} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                  ) : (
                    <Image src={p} alt="" fill sizes="80px" className="object-cover" />
                  )}
                  {isVideoUrl(p) && (
                    <span className="absolute bottom-0.5 left-0.5 rounded bg-ink/75 px-1 py-px text-[8px] font-bold text-cream">
                      🎬
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex flex-col">
          <p className="text-xs font-bold uppercase tracking-widest text-accent">
            {product.brand || product.category} · {product.category}
          </p>
          <h1 className="mt-1 font-display text-3xl font-black tracking-tight sm:text-4xl">
            {product.title}
          </h1>
          <p className="mt-2 font-display text-2xl font-extrabold sm:text-3xl">
            {formatKes(product.priceKes)}
          </p>

          {/* Trust signal: seller rating (community) or shop rating (platform). */}
          <div className="mt-2 flex items-center gap-2">
            <RatingStars sellerId={product.sellerId ?? null} size="md" />
            {product.sellerId && product.sellerName && (
              <Link
                href={`/seller/${product.sellerId}`}
                className="text-xs font-bold text-accent underline-offset-2 transition hover:underline"
              >
                by {product.sellerName}
              </Link>
            )}
            {product.sellerVerified && (
              <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-lime-ink">
                ✓ Verified seller
              </span>
            )}
          </div>

          {live ? (
            <>
              <div className="mt-6 flex flex-wrap gap-2">
                {ownsIt ? (
                  <div className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-sand px-6 py-4 text-sm font-bold uppercase tracking-wider text-ink-soft sm:flex-none sm:px-10">
                    This is your piece
                  </div>
                ) : (
                  <button
                    onClick={() => openCheckout(product)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-4 text-sm font-bold uppercase tracking-wider text-white transition hover:bg-accent-deep active:scale-[0.99] sm:flex-none sm:px-10"
                  >
                    Buy now · {formatKes(product.priceKes)}
                  </button>
                )}
                <button
                  onClick={handleSave}
                  aria-label={isSaved ? "Remove from saved" : "Save piece"}
                  className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl border border-line bg-paper text-xl transition hover:border-ink active:scale-95"
                >
                  {isSaved ? "❤️" : "🤍"}
                </button>
              </div>
              {!ownsIt && (
                <p className="mt-2 text-xs text-ink-soft">
                  Pay with M-Pesa STK push or card. Secured server-side. First payment wins.
                </p>
              )}

              {chatId && (
                <div className="mt-5">
                  <ListingChat conversationId={chatId} otherLabel="Seller" />
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                {product.sellerId && !ownsIt && (
                  <button
                    onClick={startChat}
                    className="rounded-full border border-line bg-paper px-4 py-2 text-xs font-bold text-ink-soft transition hover:border-ink hover:text-ink"
                  >
                    💬 Chat with seller
                  </button>
                )}
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-line px-4 py-2 text-xs font-bold text-ink-soft transition hover:border-ink hover:text-ink"
                >
                  📲 Share on WhatsApp
                </a>
                <button
                  onClick={copyLink}
                  className="rounded-full border border-line px-4 py-2 text-xs font-bold text-ink-soft transition hover:border-ink hover:text-ink"
                >
                  {copied ? "✓ Copied" : "🔗 Copy link"}
                </button>
                <button
                  onClick={shareWithPhoto}
                  className="rounded-full border border-line px-4 py-2 text-xs font-bold text-ink-soft transition hover:border-ink hover:text-ink"
                >
                  📸 Share with photo
                </button>
              </div>
            </>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-accent/40 bg-accent-soft/40 px-5 py-6 text-center">
              <span className="text-3xl">💨</span>
              <p className="mt-2 font-display text-lg font-black">This drop is claimed</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-ink-soft">
                1-of-1 pieces go fast. Someone beat you to it. Fresh drops land weekly.
              </p>
              <Link
                href="/#drops"
                className="mt-4 inline-block rounded-full bg-ink px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-cream transition hover:bg-accent"
              >
                See what&apos;s live
              </Link>
            </div>
          )}

          {/* Specs */}
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {specs.map((s) => (
              <div key={s.label} className="rounded-2xl border border-line bg-paper p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-soft">
                  {s.label}
                </p>
                <p className="mt-0.5 truncate font-display text-sm font-bold">{s.value || "None"}</p>
              </div>
            ))}
          </div>

          {product.locationLabel && (
            <div className="mt-4 flex items-start gap-2 rounded-2xl bg-sand/60 px-4 py-3">
              <span className="text-base">📍</span>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">
                  Meetup area
                </p>
                <p className="text-sm">{product.locationLabel}</p>
              </div>
            </div>
          )}

          {product.description && (
            <div className="mt-6">
              <h2 className="text-xs font-bold uppercase tracking-widest text-ink-soft">Story</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-soft">
                {product.description}
              </p>
            </div>
          )}
        </div>
      </div>

    </main>
  );
}
