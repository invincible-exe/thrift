"use client";

import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap";
import type { Product } from "@/lib/types";

const COLORS = ["#ff4d00", "#d9f24d", "#16130f", "#5b544a", "#f3eee7", "#e04300"];
const CONFETTI_COUNT = 26;

/** Confetti burst + elastic checkmark pop shown when a purchase completes. */
export default function SuccessBurst({
  product,
  providerRef,
}: {
  product: Product;
  providerRef?: string;
}) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const scope = root.current;
      if (!scope) return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set(scope.querySelectorAll(".sb-confetti"), { autoAlpha: 0 });
        return;
      }

      const pieces = gsap.utils.toArray<HTMLElement>(scope.querySelectorAll(".sb-confetti"));
      pieces.forEach((piece, i) => {
        const angle = (i / pieces.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
        const dist = 70 + Math.random() * 110;
        gsap.fromTo(
          piece,
          { x: 0, y: 0, rotation: 0, autoAlpha: 1, scale: 1 },
          {
            x: Math.cos(angle) * dist,
            y: Math.sin(angle) * dist - 40,
            rotation: (Math.random() - 0.5) * 560,
            autoAlpha: 0,
            scale: 0.6,
            duration: 0.9 + Math.random() * 0.6,
            delay: 0.1 + Math.random() * 0.25,
            ease: "power2.out",
          }
        );
      });

      gsap.fromTo(
        scope.querySelector(".sb-ring"),
        { scale: 0.5, autoAlpha: 0.7 },
        { scale: 2, autoAlpha: 0, duration: 0.9, ease: "power2.out", delay: 0.05 }
      );
      gsap.fromTo(
        scope.querySelector(".sb-check"),
        { scale: 0.3, autoAlpha: 0 },
        { scale: 1, autoAlpha: 1, duration: 0.75, ease: "elastic.out(1, 0.55)", delay: 0.05 }
      );
      gsap.fromTo(
        scope.querySelectorAll(".sb-text"),
        { autoAlpha: 0, y: 16 },
        { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.09, delay: 0.45, ease: "power3.out" }
      );
    },
    { scope: root }
  );

  return (
    <div ref={root} className="relative flex flex-col items-center py-10 text-center">
      {Array.from({ length: CONFETTI_COUNT }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className="sb-confetti pointer-events-none absolute left-1/2 top-20 h-2.5 w-1.5 -ml-[3px] rounded-sm"
          style={{ backgroundColor: COLORS[i % COLORS.length] }}
        />
      ))}

      <div className="relative">
        <span className="sb-ring pointer-events-none absolute inset-0 rounded-full bg-lime/70" />
        <span className="sb-check relative flex h-20 w-20 items-center justify-center rounded-full bg-lime text-4xl text-ink">
          ✓
        </span>
      </div>

      <h2 className="sb-text mt-4 font-display text-3xl font-black">You got it.</h2>
      <p className="sb-text mt-2 max-w-xs text-sm text-ink-soft">
        <span className="font-semibold text-ink">{product.title}</span> is reserved, tracked in{" "}
        <a href="/account" className="font-bold text-accent underline-offset-2 hover:underline">
          My Account
        </a>
        . We&apos;ll confirm dispatch within 24h.
      </p>
      {providerRef && (
        <p className="sb-text mt-3 rounded-full bg-sand px-4 py-1.5 text-xs font-semibold text-ink-soft">
          Ref {providerRef}
        </p>
      )}
    </div>
  );
}
