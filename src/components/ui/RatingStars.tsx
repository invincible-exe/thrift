"use client";

import { useRatingSummary } from "@/lib/db";

/**
 * ★ Trust signal for a seller (or the whole shop when sellerId is null).
 * Renders nothing until the summary loads, and hides entirely when there
 * are no ratings yet — a bare 0.0/0 would read as a negative signal, so a
 * new seller simply shows no stars until their first buyer rates them.
 */
export default function RatingStars({
  sellerId,
  size = "sm",
  showCount = true,
  className = "",
}: {
  /** null → the shop-wide rating (used for platform pieces). */
  sellerId: string | null;
  size?: "xs" | "sm" | "md";
  showCount?: boolean;
  className?: string;
}) {
  const summary = useRatingSummary(sellerId);

  if (!summary || summary.total === 0 || summary.average == null) return null;

  const starCls =
    size === "md" ? "text-base leading-none" : size === "xs" ? "text-[10px] leading-none" : "text-xs leading-none";
  const countCls =
    size === "md" ? "text-sm" : size === "xs" ? "text-[10px]" : "text-[11px]";

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      role="img"
      aria-label={`Rated ${summary.average} out of 5 from ${summary.total} ${
        summary.total === 1 ? "rating" : "ratings"
      }`}
    >
      <span className={`inline-flex ${starCls}`} aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => {
          const fill = Math.max(0, Math.min(1, summary.average! - i));
          return (
            <span key={i} className="relative inline-block">
              <span className="text-ink/15">★</span>
              <span
                className="absolute inset-0 overflow-hidden text-accent"
                style={{ width: `${fill * 100}%` }}
              >
                ★
              </span>
            </span>
          );
        })}
      </span>
      {showCount && (
        <span className={`font-semibold text-ink-soft ${countCls}`}>
          {summary.average}
          <span className="text-ink-soft/60"> ({summary.total})</span>
        </span>
      )}
    </span>
  );
}
