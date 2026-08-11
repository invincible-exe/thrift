"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import ErrorBoundary from "./ui/ErrorBoundary";
import { gsap, useGSAP, SplitText } from "@/lib/gsap";

const CyberCard = dynamic(() => import("./CyberCard"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse">
      <div className="h-64 w-64 rounded-full bg-sand blur-2xl" />
    </div>
  ),
});

// Last-resort fallback for the hero card: if the 3D card itself throws on a
// device, show a calm static panel instead of letting the whole app unmount.
function CyberCardFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-3xl border border-line bg-paper/60">
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <div className="h-16 w-16 rounded-full bg-gradient-to-br from-lime/40 to-accent/30 blur-xl" />
        <p className="font-display text-lg font-black tracking-tight">Fresh Drops</p>
        <p className="text-xs text-ink-soft">Hand-picked 1-of-1s land weekly.</p>
      </div>
    </div>
  );
}

export default function Hero() {
  const root = useRef<HTMLElement>(null);
  const blobA = useRef<HTMLDivElement>(null);
  const blobB = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const scope = root.current;
      if (!scope || typeof window === "undefined") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const ease = gsap.parseEase("M0,0 C0.22,1 0.36,1 1,1");
      const headline = scope.querySelector("h1");
      const sub = scope.querySelector(".hero-sub");
      const split = headline ? SplitText.create(headline, { type: "words" }) : null;
      const splitSub = sub ? SplitText.create(sub, { type: "words" }) : null;

      const tl = gsap.timeline({ defaults: { ease } });
      tl.fromTo(
        ".hero-blob",
        { autoAlpha: 0.5, scale: 0.92 },
        { autoAlpha: 1, scale: 1, duration: 1.6, ease: "power2.out", stagger: 0.15 },
        0
      )
        .fromTo(
          split?.words ?? headline,
          { autoAlpha: 0, yPercent: 110 },
          { autoAlpha: 1, yPercent: 0, duration: 0.9, stagger: 0.05 },
          0.15
        )
        .fromTo(
          ".hero-3d",
          { autoAlpha: 0, scale: 0.94 },
          { autoAlpha: 1, scale: 1, duration: 1 },
          0.3
        )
        .fromTo(
          splitSub?.words ?? sub,
          { autoAlpha: 0, yPercent: 40 },
          { autoAlpha: 1, yPercent: 0, duration: 0.8, stagger: 0.03 },
          0.7
        )
        .fromTo(
          ".hero-cta",
          { autoAlpha: 0, y: 20 },
          { autoAlpha: 1, y: 0, duration: 0.6 },
          0.9
        );

      // Slow parallax drift on the decorative blobs as the page scrolls.
      gsap.to([blobA.current, blobB.current], {
        y: 90,
        ease: "none",
        scrollTrigger: {
          trigger: scope,
          start: "top top",
          end: "bottom top",
          scrub: 1.2,
        },
      });

      // As the hero scrolls out, its words (and the CTA) drift upward at
      // staggered rates so the text keeps transitioning with the page.
      const words = [...(split?.words ?? []), ...(splitSub?.words ?? [])];
      if (words.length > 0) {
        gsap.to([...words, ".hero-cta"], {
          yPercent: -60,
          autoAlpha: 0.1,
          ease: "none",
          stagger: 0.04,
          immediateRender: false,
          overwrite: "auto",
          scrollTrigger: {
            trigger: scope,
            start: "top top",
            end: "bottom top",
            scrub: 1,
          },
        });
      }

      return () => {
        split?.revert();
        splitSub?.revert();
      };
    },
    { scope: root }
  );

  return (
    <section ref={root} className="relative overflow-hidden">
      <div
        ref={blobA}
        className="hero-blob pointer-events-none absolute -left-40 top-10 h-96 w-96 rounded-full bg-accent-soft blur-3xl"
      />
      <div
        ref={blobB}
        className="hero-blob pointer-events-none absolute -right-32 bottom-0 h-[28rem] w-[28rem] rounded-full bg-lime/40 blur-3xl"
      />

      <div className="relative mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:px-8 lg:py-20">
        <div>
          <h1 className="font-display text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl xl:text-7xl">
            Premium fits.
            <br />
            <span className="text-accent">Zero</span> hassle.
          </h1>
          <p className="hero-sub mt-6 max-w-md text-lg leading-relaxed text-ink-soft">
            Every piece is hand-picked, graded 10/10, and sold as 1-of-1. No queues, no
            digging, just classy clothes at thrift prices.
          </p>
          <div className="hero-cta mt-8 flex flex-wrap items-center gap-4">
            <a
              href="#drops"
              className="group inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3.5 text-sm font-bold uppercase tracking-wider text-white transition hover:bg-accent-deep"
            >
              Browse drops
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </a>
          </div>
        </div>

        <div className="hero-3d relative h-[420px] sm:h-[520px] lg:h-[620px]">
          <ErrorBoundary fallback={<CyberCardFallback />}>
            <CyberCard />
          </ErrorBoundary>
        </div>
      </div>
    </section>
  );
}
