"use client";

import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap";

/**
 * Route transition wrapper — Next.js re-mounts this on every navigation.
 * Resets the scroll position before paint and plays a quick fade/rise
 * entrance for the incoming page.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;

      // Start the new page from the top (layout effect → before paint, so no
      // flicker of the previous scroll position).
      window.scrollTo(0, 0);

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.fromTo(
        el,
        { autoAlpha: 0, y: 24 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.6,
          ease: "power3.out",
          clearProps: "all",
        }
      );
    },
    { scope: root }
  );

  return <div ref={root}>{children}</div>;
}
