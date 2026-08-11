"use client";

import { useRef, type ReactNode } from "react";
import { gsap, useGSAP, SplitText } from "@/lib/gsap";

/**
 * Scroll-scrubbed, word-by-word masked reveal for headings.
 *
 * Each word slides up out of its own overflow-hidden mask, driven by scroll
 * progress through the element (start "top 85%" → end "top 40%") so the text
 * keeps transitioning as you scroll. Honors prefers-reduced-motion by leaving
 * the text fully visible.
 */
export default function SplitReveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const split = SplitText.create(el, { type: "words" });

      // Wrap every word in its own overflow-hidden mask so words slide up
      // from below the line without spilling over the heading.
      split.words.forEach((word) => {
        const mask = document.createElement("span");
        // pb/-mb keeps descenders (p, g, y…) inside the overflow-hidden mask
        // on tight line-heights without shifting the line layout.
        mask.className =
          "inline-block overflow-hidden align-bottom pb-[0.12em] -mb-[0.12em]";
        word.parentNode?.insertBefore(mask, word);
        mask.appendChild(word);
      });

      gsap.timeline({
        defaults: { ease: "power3.out" },
        scrollTrigger: {
          trigger: el,
          start: "top 85%",
          end: "top 40%",
          scrub: true,
        },
      }).fromTo(
        split.words,
        { yPercent: 115, autoAlpha: 0 },
        { yPercent: 0, autoAlpha: 1, duration: 1, stagger: 0.09 }
      );

      return () => split.revert();
    },
    { scope: ref }
  );

  return (
    <h2 ref={ref} className={className}>
      {children}
    </h2>
  );
}
