"use client";

import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { gsap, useGSAP } from "@/lib/gsap";
import { Draggable } from "gsap/Draggable";

export interface DraggableCarouselHandle {
  scrollBy: (deltaX: number) => void;
}

/**
 * Horizontal drag-to-scroll carousel (GSAP Draggable + inertia + snap).
 * Falls back to native overflow scrolling when reduced motion is preferred.
 */
const DraggableCarousel = forwardRef<DraggableCarouselHandle, { children: ReactNode }>(
  function DraggableCarousel({ children }, ref) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const instRef = useRef<Draggable | null>(null);
    const nativeRef = useRef(false);
    const [native, setNative] = useState(false);

    useGSAP(
      () => {
        const wrap = wrapRef.current;
        const track = trackRef.current;
        if (!wrap || !track) return;

        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          nativeRef.current = true;
          setNative(true);
          return;
        }

        const create = () => {
          if (instRef.current) instRef.current.kill();
          // Re-read the card width on every (re)create so the snap step stays
          // correct when the viewport changes (68vw mobile vs 300px desktop).
          const card = track.firstElementChild as HTMLElement | null;
          const cardStep = (card?.offsetWidth ?? 300) + 20; // gap-5
          const maxScroll = Math.max(track.scrollWidth - wrap.clientWidth, 0);
          instRef.current = Draggable.create(track, {
            type: "x",
            inertia: true,
            // Let vertical gestures scroll the page instead of being captured.
            allowNativeTouchScroll: true,
            // Drag anywhere on the carousel (the whole section-width wrapper),
            // not just the strip of cards.
            trigger: wrap,
            edgeResistance: 0.85,
            bounds: { minX: -maxScroll, maxX: 0 },
            snap: (x: number) => {
              const snapped = Math.round(-x / cardStep) * cardStep;
              return -Math.min(Math.max(snapped, 0), maxScroll);
            },
          })[0];
        };

        create();
        const onResize = () => create();
        window.addEventListener("resize", onResize);

        return () => {
          window.removeEventListener("resize", onResize);
          instRef.current?.kill();
        };
      },
      { scope: wrapRef }
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollBy(deltaX: number) {
          const wrap = wrapRef.current;
          const track = trackRef.current;
          if (!wrap || !track) return;
          if (nativeRef.current) {
            track.scrollLeft += deltaX;
            return;
          }
          const maxScroll = Math.max(track.scrollWidth - wrap.clientWidth, 0);
          const current = (gsap.getProperty(track, "x") as number) || 0;
          const target = Math.min(Math.max(current - deltaX, -maxScroll), 0);
          gsap.to(track, {
            x: target,
            duration: 0.6,
            ease: "power3.out",
            overwrite: "auto",
            onComplete: () => instRef.current?.update(),
          });
        },
      }),
      []
    );

    return (
      <div
        ref={wrapRef}
        className={
          native
            ? "no-scrollbar overflow-x-auto"
            : "cursor-grab overflow-hidden active:cursor-grabbing"
        }
      >
        <div ref={trackRef} className="flex w-max gap-5 pb-2">
          {children}
        </div>
      </div>
    );
  }
);

export default DraggableCarousel;
