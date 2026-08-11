"use client";

import { useRef, type ReactNode } from "react";
import { gsap, useGSAP, ScrollTrigger } from "@/lib/gsap";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// One debounced re-measure shared by every Reveal (fonts settle, async
// content lands) instead of an rAF refresh per instance.
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleTriggerRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    ScrollTrigger.refresh();
  }, 200);
}

/**
 * Scroll-triggered reveal. Without `stagger` it fades/rises the wrapper;
 * with `stagger` it animates the wrapper's direct children one by one.
 * Honors prefers-reduced-motion by leaving content fully visible.
 */
export default function Reveal({
  children,
  className,
  stagger = false,
  delay = 0,
  y = 28,
}: {
  children: ReactNode;
  className?: string;
  stagger?: boolean;
  delay?: number;
  y?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || prefersReducedMotion()) return;

      const targets = stagger ? Array.from(el.children) : [el];
      gsap.fromTo(
        targets,
        { autoAlpha: 0, y },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.9,
          delay,
          ease: "power3.out",
          stagger: stagger ? 0.08 : 0,
          scrollTrigger: { trigger: el, start: "top 88%", once: true },
        }
      );

      // Re-measure after fonts/layout settle so triggers created while the
      // page was still settling fire at the right spot.
      scheduleTriggerRefresh();
    },
    { scope: ref }
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
