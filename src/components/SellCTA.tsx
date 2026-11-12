"use client";

import { useRef } from "react";
import { useShop } from "@/context/ShopContext";
import { gsap, useGSAP, SplitText } from "@/lib/gsap";
import { maskWords } from "@/lib/split-mask";

export default function SellCTA() {
  const { openSell } = useShop();
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const section = root.current;
      if (!section) return;

      const nums = gsap.utils.toArray<HTMLElement>(
        section.querySelectorAll(".stat-num")
      );
      const cta = section.querySelector<HTMLElement>(".p2p-cta");
      const arrow = cta?.querySelector<HTMLElement>(".p2p-cta-arrow") ?? null;

      // The markup ships the final values (90% / 10% / 0 KES), so the stats
      // are correct even before — or entirely without — the animation. This
      // helper restores those values whenever we have to bail out.
      const showFinal = () => {
        nums.forEach((el) => {
          el.textContent = `${el.dataset.value ?? 0}${el.dataset.suffix ?? ""}`;
        });
      };

      // Reduced motion: show final values without animating or hover tricks.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        showFinal();
        return;
      }

      // Safety net: a failure anywhere in the animation pipeline must never
      // leave the section stuck at "0%" or hidden mid-reveal. On error we
      // clear whatever inline styles the partial tweens applied and show the
      // real numbers.
      try {
        return setupAnimation(section, nums, cta, arrow);
      } catch (err) {
        console.error("SellCTA animation failed — showing final values.", err);
        gsap.set([".p2p-stat", ".p2p-cta"], { clearProps: "all" });
        showFinal();
      }
    },
    { scope: root }
  );

  return (
    <section ref={root} id="sell" className="scroll-mt-24 mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="relative overflow-hidden rounded-[2rem] bg-ink px-6 py-14 text-cream sm:px-12 lg:px-16">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-16 h-72 w-72 rounded-full bg-lime/10 blur-3xl" />

        <div className="relative grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="p2p-eyebrow text-xs font-bold uppercase tracking-widest text-accent">
              Peer-to-peer marketplace
            </p>
            <h2 className="p2p-headline mt-2 font-display text-4xl font-black leading-[0.95] tracking-tight sm:text-5xl">
              Got fire pieces?
              <br />
              <span className="text-accent">Sell them here.</span>
            </h2>
            <p className="p2p-desc mt-5 max-w-md leading-relaxed text-cream/70">
              List your own fits in two minutes. When they sell, a 10% commission (min 50 KES)
              funds 10/10 Thrifts, and <span className="font-bold text-amber-ink">up to 90% lands in your wallet</span>.
              No listing fees, no middlemen at the door.
            </p>
            <button
              type="button"
              onClick={openSell}
              className="p2p-cta mt-8 inline-flex items-center gap-2 rounded-full bg-accent px-8 py-4 text-sm font-bold uppercase tracking-wider text-white transition-colors hover:bg-accent-deep"
            >
              List a piece <span className="p2p-cta-arrow inline-block">→</span>
            </button>
          </div>

          <div className="grid gap-4">
            {/* Dark charcoal card on the cream page so the stat numbers stay
                AA: bold ~24-28px charcoal on the page cream is ~15:1 and on
                the card's dark ink base is ~19:1. Lime stays reserved for
                the dark hero, where it is the call-to-action colour. */}
            <div className="p2p-stat relative overflow-hidden rounded-2xl border border-line bg-paper p-6">
              <p className="stat-num text-4xl font-black text-ink" data-value="90" data-suffix="%">
                90%
              </p>
              <p className="mt-1 text-sm text-ink-soft">up to 90% goes straight to you · min 50 KES fee</p>
            </div>
            <div className="p2p-stat relative overflow-hidden rounded-2xl border border-line bg-paper p-6">
              <p className="stat-num text-4xl font-black text-ink" data-value="10" data-suffix="%">
                10%
              </p>
              <p className="mt-1 text-sm text-ink-soft">commission keeps the rack running</p>
            </div>
            <div className="p2p-stat relative overflow-hidden rounded-2xl border border-line bg-paper p-6">
              <p className="stat-num text-4xl font-black text-ink" data-value="0" data-suffix=" KES">
                0 KES
              </p>
              <p className="mt-1 text-sm text-ink-soft">to list, pay only when you sell</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function setupAnimation(
  section: HTMLElement,
  nums: HTMLElement[],
  cta: HTMLElement | null,
  arrow: HTMLElement | null
) {
  const ease = gsap.parseEase("M0,0 C0.22,1 0.36,1 1,1");
  const eyebrow = section.querySelector<HTMLElement>(".p2p-eyebrow");
  const headline = section.querySelector<HTMLElement>(".p2p-headline");
  const desc = section.querySelector<HTMLElement>(".p2p-desc");
  if (!eyebrow || !headline || !desc) return;

  const cleanups: (() => void)[] = [];

  // Split every block of text into words (the eyebrow into chars) so the
  // reveal can be a masked rise with a slight skew + blur-to-sharp — a
  // sleeker entrance than a plain fade-up.
  const splitEyebrow = SplitText.create(eyebrow, { type: "chars" });
  const splitHeadline = SplitText.create(headline, { type: "words" });
  const splitDesc = SplitText.create(desc, { type: "words" });
  maskWords(splitHeadline.words);
  maskWords(splitDesc.words);

  const tl = gsap.timeline({
    defaults: { ease },
    scrollTrigger: { trigger: section, start: "top 72%", once: true },
  });

  // immediateRender: true on every fromTo (targets are disjoint) so all
  // content is hidden up front and only appears when its turn in the
  // choreography arrives — avoids a visible hide-then-reveal flash.
  tl.fromTo(
    splitEyebrow.chars,
    { yPercent: 120, skewY: 8, autoAlpha: 0, filter: "blur(6px)" },
    {
      yPercent: 0,
      skewY: 0,
      autoAlpha: 1,
      filter: "blur(0px)",
      stagger: 0.022,
      duration: 0.55,
      immediateRender: true,
    }
  )
    .fromTo(
      splitHeadline.words,
      { yPercent: 120, skewY: 8, autoAlpha: 0, filter: "blur(10px)" },
      {
        yPercent: 0,
        skewY: 0,
        autoAlpha: 1,
        filter: "blur(0px)",
        stagger: 0.07,
        duration: 0.8,
        immediateRender: true,
      },
      "-=0.25"
    )
    .fromTo(
      splitDesc.words,
      { yPercent: 115, skewY: 4, autoAlpha: 0, filter: "blur(6px)" },
      {
        yPercent: 0,
        skewY: 0,
        autoAlpha: 1,
        filter: "blur(0px)",
        stagger: 0.03,
        duration: 0.6,
        immediateRender: true,
      },
      "-=0.45"
    )
    .fromTo(
      ".p2p-cta",
      { autoAlpha: 0, scale: 0.86, filter: "blur(8px)" },
      {
        autoAlpha: 1,
        scale: 1,
        filter: "blur(0px)",
        duration: 0.7,
        ease: "back.out(1.8)",
        immediateRender: true,
      },
      "-=0.3"
    );

  // Label the spot where the stats kick in — 0.35s before the end of the
  // chain, right as the CTA pops. Added after the chain so the offset is
  // measured against the full choreography (an offset added to an empty
  // timeline would clamp to position 0 and fire the cards too early).
  tl.addLabel("stats", "-=0.35");

  tl.fromTo(
    ".p2p-stat",
    { autoAlpha: 0, y: 44 },
    { autoAlpha: 1, y: 0, stagger: 0.12, duration: 0.7, immediateRender: true },
    "stats"
  );

  // Count the 90% / 10% / 0 KES stats up in exact sync with the card
  // entrance — each tween is dropped at the "stats" label, so the numbers
  // rise just as the cards slide in. The counters reset to 0 here (the
  // markup holds the targets), so a trigger that never fires still leaves
  // the final values on screen.
  nums.forEach((el) => {
    const target = Number(el.dataset.value ?? 0);
    const suffix = el.dataset.suffix ?? "";
    el.textContent = `0${suffix}`;
    const state = { val: 0 };
    tl.to(
      state,
      {
        val: target,
        duration: 1.6,
        ease: "power2.out",
        snap: { val: 1 },
        onUpdate: () => {
          el.textContent = `${Math.round(state.val)}${suffix}`;
        },
      },
      "stats"
    );
  });

  // ── Magnetic CTA: the button gravitates toward the cursor ──
  if (cta) {
    const xTo = gsap.quickTo(cta, "x", { duration: 0.45, ease: "power3.out" });
    const yTo = gsap.quickTo(cta, "y", { duration: 0.45, ease: "power3.out" });
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = cta.getBoundingClientRect();
      const relX = e.clientX - (r.left + r.width / 2);
      const relY = e.clientY - (r.top + r.height / 2);
      xTo(relX * 0.35);
      yTo(relY * 0.35);
    };
    const onLeave = () => {
      xTo(0);
      yTo(0);
    };
    cta.addEventListener("pointermove", onMove);
    cta.addEventListener("pointerleave", onLeave);
    cleanups.push(() => {
      cta.removeEventListener("pointermove", onMove);
      cta.removeEventListener("pointerleave", onLeave);
    });
  }

  // ── CTA arrow kicks diagonally on hover ──
  if (arrow && cta) {
    const onEnter = () =>
      gsap.to(arrow, {
        x: 5,
        rotate: 45,
        duration: 0.35,
        ease: "power3.out",
        overwrite: "auto",
      });
    const onLeave = () =>
      gsap.to(arrow, {
        x: 0,
        rotate: 0,
        duration: 0.3,
        ease: "power2.out",
        overwrite: "auto",
      });
    cta.addEventListener("pointerenter", onEnter);
    cta.addEventListener("pointerleave", onLeave);
    cleanups.push(() => {
      cta.removeEventListener("pointerenter", onEnter);
      cta.removeEventListener("pointerleave", onLeave);
    });
  }

  // ── Stat cards: 3D tilt + a glare that follows the cursor ──
  section.querySelectorAll<HTMLElement>(".p2p-stat").forEach((card) => {
    gsap.set(card, { transformPerspective: 900 });
    const rotX = gsap.quickTo(card, "rotationX", { duration: 0.5, ease: "power3.out" });
    const rotY = gsap.quickTo(card, "rotationY", { duration: 0.5, ease: "power3.out" });
    const scaleTo = gsap.quickTo(card, "scale", { duration: 0.4, ease: "power3.out" });
    const glare = card.querySelector<HTMLElement>(".p2p-glare");
    const gx = glare ? gsap.quickTo(glare, "x", { duration: 0.6, ease: "power3.out" }) : null;
    const gy = glare ? gsap.quickTo(glare, "y", { duration: 0.6, ease: "power3.out" }) : null;
    let glareOn = false;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      rotY(px * 10);
      rotX(-py * 8);
      scaleTo(1.02);
      if (glare && gx && gy) {
        if (!glareOn) {
          glareOn = true;
          gsap.to(glare, { autoAlpha: 1, duration: 0.3, overwrite: "auto" });
        }
        gx(px * 140);
        gy(py * 140);
      }
    };
    const onLeave = () => {
      rotX(0);
      rotY(0);
      scaleTo(1);
      if (glare) {
        glareOn = false;
        gsap.to(glare, { autoAlpha: 0, duration: 0.4, overwrite: "auto" });
      }
    };
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
    cleanups.push(() => {
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
    });
  });

  return () => {
    cleanups.forEach((fn) => fn());
    splitEyebrow.revert();
    splitHeadline.revert();
    splitDesc.revert();
  };
}
