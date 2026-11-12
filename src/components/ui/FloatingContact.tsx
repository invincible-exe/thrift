"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap, useGSAP } from "@/lib/gsap";
import { CustomBounce } from "gsap/CustomBounce";
import { CustomWiggle } from "gsap/CustomWiggle";
import { SUPPORT_EMAIL } from "@/lib/constants";

/**
 * Floating contact button — pops in with a bounce once the user scrolls past
 * the hero, then expands a small card with the support email.
 */
export default function FloatingContact() {
  const root = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useGSAP(
    () => {
      const fab = fabRef.current;
      if (!fab) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set(fab, { autoAlpha: 1, scale: 1 });
        return;
      }
      const pop = CustomBounce.create("fcPop", { strength: 0.8, squash: 2 });
      gsap.fromTo(
        fab,
        { autoAlpha: 0, scale: 0 },
        {
          autoAlpha: 1,
          scale: 1,
          duration: 1.2,
          ease: pop,
          scrollTrigger: { start: 300, toggleActions: "play none none reverse" },
        }
      );
    },
    { scope: root }
  );

  // Pop the contact card in when it opens (matches the rest of the UI's feel).
  // useLayoutEffect so the fromTo hides it before paint — no one-frame flash.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(
      card,
      { autoAlpha: 0, y: 12, scale: 0.96 },
      {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 0.35,
        ease: "back.out(1.6)",
        overwrite: "auto",
      }
    );
  }, [open]);

  // Close the card when clicking elsewhere.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    const fab = fabRef.current;
    if (fab && next && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Little wiggle as the card pops open.
      const wiggle = CustomWiggle.create("fcWiggle", { wiggles: 3, type: "easeOut" });
      gsap.set(fab, { rotation: 5 });
      gsap.to(fab, { rotation: 0, duration: 0.8, ease: wiggle, overwrite: "auto" });
    }
  };

  return (
    // z-40 keeps the FAB below modal overlays (z-50) so it never floats over
    // the checkout/auth flows.
    <div ref={root} className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {/* Reserve bottom-of-page scroll room so the chat card never sits on
          an interactive card button (e.g. the BOOST · KES 50 card in
          My closet). */}
      <div className="absolute inset-x-0 bottom-26" />
      {open && (
        <div
          ref={cardRef}
          className="w-72 rounded-2xl border border-line bg-paper p-4 shadow-2xl"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-accent">Talk to us</p>
          <p className="mt-1 text-sm text-ink-soft">
            Question about a piece, a sale, or an order? We reply within 24h.
          </p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="mt-3 flex items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-cream transition hover:bg-accent"
          >
            ✉️ {SUPPORT_EMAIL}
          </a>
        </div>
      )}

      <button
        ref={fabRef}
        onClick={toggle}
        aria-label={open ? "Close contact options" : "Open contact options"}
        aria-expanded={open}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-2xl text-white shadow-lg shadow-accent/40 transition hover:bg-accent-deep hover:shadow-xl active:scale-95"
      >
        {open ? "✕" : "💬"}
      </button>
    </div>
  );
}
