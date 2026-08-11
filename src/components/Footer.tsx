"use client";

import { useRef } from "react";
import Link from "next/link";
import { APP_NAME, SUPPORT_EMAIL } from "@/lib/constants";
import { gsap, useGSAP, SplitText } from "@/lib/gsap";
import { maskWords } from "@/lib/split-mask";
import Reveal from "./ui/Reveal";

export default function Footer() {
  const root = useRef<HTMLElement>(null);

  // Bottom row rises word-by-word out of masks with a blur-to-sharp reveal,
  // and every nav link gets a GSAP-drawn underline + gentle lift on hover.
  // Honors prefers-reduced-motion (no animation, CSS hover color only).
  useGSAP(
    () => {
      const scope = root.current;
      if (!scope) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const bottom = scope.querySelector(".footer-bottom");
      if (!bottom) return;

      const cleanups: (() => void)[] = [];

      // Tagline: words rise out of masks with a soft blur-to-sharp. The
      // copyright line follows right behind with a matching rise.
      const tagline = scope.querySelector<HTMLElement>(".footer-tagline");
      const copyright = scope.querySelector<HTMLElement>(".footer-copyright");
      const splitTag = tagline ? SplitText.create(tagline, { type: "words" }) : null;
      if (splitTag) maskWords(splitTag.words);

      gsap
        .timeline({
          scrollTrigger: { trigger: bottom, start: "top 94%", once: true },
        })
        .fromTo(
          splitTag?.words ?? tagline ?? bottom,
          { yPercent: 115, autoAlpha: 0, filter: "blur(8px)" },
          {
            yPercent: 0,
            autoAlpha: 1,
            filter: "blur(0px)",
            stagger: 0.05,
            duration: 0.8,
            ease: "power4.out",
            immediateRender: true,
          }
        )
        .fromTo(
          copyright,
          { y: 18, autoAlpha: 0, filter: "blur(6px)" },
          {
            y: 0,
            autoAlpha: 1,
            filter: "blur(0px)",
            duration: 0.7,
            ease: "power3.out",
            immediateRender: true,
          },
          "-=0.55"
        );

      // Nav links: an accent underline sweeps in from the left on hover and
      // exits to the right, while the label lifts a touch.
      scope.querySelectorAll<HTMLElement>(".footer-link").forEach((link) => {
        const bar = document.createElement("span");
        bar.className =
          "pointer-events-none absolute inset-x-0 bottom-0 h-[1.5px] origin-left scale-x-0 bg-accent";
        link.appendChild(bar);

        const onEnter = () => {
          gsap.fromTo(
            bar,
            { scaleX: 0, transformOrigin: "left" },
            { scaleX: 1, duration: 0.45, ease: "power3.out", overwrite: true }
          );
          gsap.to(link, { y: -1, duration: 0.35, ease: "power2.out", overwrite: "auto" });
        };
        const onLeave = () => {
          gsap.fromTo(
            bar,
            { scaleX: 1, transformOrigin: "right" },
            { scaleX: 0, duration: 0.4, ease: "power3.inOut", overwrite: true }
          );
          gsap.to(link, { y: 0, duration: 0.3, ease: "power2.out", overwrite: "auto" });
        };

        link.addEventListener("mouseenter", onEnter);
        link.addEventListener("mouseleave", onLeave);
        cleanups.push(() => {
          link.removeEventListener("mouseenter", onEnter);
          link.removeEventListener("mouseleave", onLeave);
          bar.remove();
        });
      });

      return () => {
        cleanups.forEach((fn) => fn());
        splitTag?.revert();
      };
    },
    { scope: root }
  );

  return (
    <footer ref={root} className="border-t border-line bg-cream">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <Reveal stagger y={20} className="grid gap-10 md:grid-cols-[1fr_1fr_1fr_1fr]">
          <div>
            <p className="font-display text-2xl font-black tracking-tighter">
              10/10<span className="text-accent">.</span>
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Shop</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <a href="#new-drops" className="footer-link relative inline-block transition-colors hover:text-accent">
                  New Drops
                </a>
              </li>
              <li>
                <a href="#drops" className="footer-link relative inline-block transition-colors hover:text-accent">
                  Available Drops
                </a>
              </li>
              <li>
                <Link href="/account" className="footer-link relative inline-block transition-colors hover:text-accent">
                  My Account
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Sell</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <a href="#sell" className="footer-link relative inline-block transition-colors hover:text-accent">
                  List a piece
                </a>
              </li>
              <li>
                <a href="#sell" className="footer-link relative inline-block transition-colors hover:text-accent">
                  Commission: 10% (min 50 KES)
                </a>
              </li>
              <li>
                <a href="#sell" className="footer-link relative inline-block transition-colors hover:text-accent">
                  Payout to M-Pesa
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Contact</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  title={`Email us at ${SUPPORT_EMAIL}`}
                  className="footer-link relative inline-block max-w-full break-all transition-colors hover:text-accent"
                >
                  {SUPPORT_EMAIL}
                </a>
              </li>
            </ul>
          </div>
        </Reveal>
        <div className="footer-bottom mt-12 flex flex-col items-center justify-between gap-3 border-t border-line pt-6 text-xs text-ink-soft sm:flex-row">
          <p className="footer-copyright">© {new Date().getFullYear()} {APP_NAME}. Built for Nairobi 🇰🇪</p>
          <p className="footer-tagline">Thrift smart. Dress loud. Pay once.</p>
        </div>
      </div>
    </footer>
  );
}
