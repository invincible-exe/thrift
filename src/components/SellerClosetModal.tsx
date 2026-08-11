"use client";

import Image from "next/image";
import Modal from "./ui/Modal";
import { useSellerPieces } from "@/lib/db";
import { formatKes } from "@/lib/format";
import type { Product } from "@/lib/types";

/**
 * A seller's public closet — every other live piece they're selling.
 *
 * Opened from a product card ("View seller's closet"). Tapping a piece
 * hands it back to the buyer flow (checkout) via onPick, so a buyer can
 * browse one seller's whole rack and buy straight from it.
 */
export default function SellerClosetModal({
  sellerId,
  sellerName,
  excludeProductId,
  onClose,
  onPick,
}: {
  sellerId: string;
  sellerName: string | null;
  /** The piece the modal was opened from — not shown again. */
  excludeProductId?: string;
  onClose: () => void;
  onPick: (product: Product) => void;
}) {
  const pieces = useSellerPieces(sellerId, excludeProductId);
  const name = sellerName?.trim() || "This seller";

  return (
    <Modal open onClose={onClose} label={`${name}'s closet`}>
      <div className="p-6 sm:p-8">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-black tracking-tight">
              {name}&apos;s closet
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {pieces === null
                ? "Loading their rack…"
                : pieces.length === 0
                  ? "Nothing else on the rack right now."
                  : `${pieces.length} more piece${pieces.length === 1 ? "" : "s"} they're selling.`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-soft transition hover:bg-sand hover:text-ink"
          >
            ✕
          </button>
        </div>

        {pieces && pieces.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {pieces.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => onPick(p)}
                  className="group block w-full overflow-hidden rounded-2xl border border-line bg-paper text-left transition hover:border-ink/40"
                >
                  <div className="relative aspect-square overflow-hidden bg-sand">
                    <Image
                      src={p.imageUrl}
                      alt={p.title}
                      fill
                      sizes="(min-width: 640px) 25vw, 50vw"
                      quality={95}
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    {p.isBoosted && (
                      <span className="absolute left-2 top-2 rounded-full bg-amber-400 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-ink shadow-sm">
                        Boosted ⚡
                      </span>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-xs font-bold">{p.title}</p>
                    <p className="mt-0.5 font-display text-sm font-extrabold">{formatKes(p.priceKes)}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : pieces !== null ? (
          <div className="rounded-2xl border border-dashed border-line bg-paper p-10 text-center">
            <p className="text-4xl">🧺</p>
            <p className="mt-3 text-sm text-ink-soft">This seller&apos;s closet is empty right now.</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
