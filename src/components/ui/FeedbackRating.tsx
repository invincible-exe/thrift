"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./FeedbackRating.module.css";

type FaceKey = "angry" | "sad" | "ok" | "good" | "happy";

/** Which decorative svg parts each face renders (eyes/mouth via #symbol). */
const FACE_SVGS: Record<FaceKey, ("eyeL" | "eyeR" | "mouth")[]> = {
  angry: ["eyeL", "eyeR", "mouth"],
  sad: ["eyeL", "eyeR", "mouth"],
  ok: [],
  good: ["eyeL", "eyeR", "mouth"],
  happy: ["eyeL", "eyeR"],
};

const FACE_LABELS: Record<FaceKey, string> = {
  angry: "Angry",
  sad: "Sad",
  ok: "Okay",
  good: "Good",
  happy: "Happy",
};

const FACE_ORDER: FaceKey[] = ["angry", "sad", "ok", "good", "happy"];

/**
 * Post-purchase experience rating (Uiverse-style emoji faces). Submits the
 * score to POST /api/ratings (session-authenticated) and reports completion
 * via onSubmitted so the checkout modal can close once rated.
 */
export default function FeedbackRating({
  orderId,
  onSubmitted,
}: {
  orderId: string | null;
  onSubmitted: () => void;
}) {
  // Unique symbol ids so multiple instances (or StrictMode remounts) never
  // clash on the shared <symbol> definitions.
  const uid = useId();
  const eyeId = `${uid}-eye`;
  const mouthId = `${uid}-mouth`;

  const [selected, setSelected] = useState<FaceKey | null>(null);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Never let the thanks-swap timer fire after the modal unmounts (e.g. the
  // user closes it mid-submit) — that would setState on a dead component.
  // The mounted flag also covers the pending-fetch case where the timer is
  // only assigned in `finally` after the unmount cleanup already ran.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const submit = async (face: FaceKey) => {
    if (sending || submitted) return;
    setSelected(face);
    setSending(true);
    try {
      await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: FACE_ORDER.indexOf(face) + 1, orderId }),
      });
    } catch {
      // Non-blocking: a failed rating must never ruin the purchase flow.
    } finally {
      if (!mountedRef.current) return;
      setSending(false);
      // Let the 0.8s shake animation actually play before swapping to the
      // thanks view — an instant swap would cut the feedback off mid-swing.
      timerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        setSubmitted(true);
        onSubmitted();
      }, 850);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-line bg-sand/60 px-6 py-6 text-center">
        <span className="text-3xl">🖤</span>
        <p className="mt-2 font-display text-lg font-black">Thanks for the feedback</p>
        <p className="mt-1 text-sm text-ink-soft">
          {selected ? (
            <>
              You rated this drop <span className="font-bold text-ink">{FACE_LABELS[selected]}</span>.
              It helps us curate better.
            </>
          ) : (
            "It helps us curate better."
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-sand/60 px-6 py-6">
      <p className="text-center font-display text-lg font-black">How was your experience?</p>
      <p className="mt-0.5 text-center text-xs text-ink-soft">
        Tap a face. Your honest take helps the next drop land.
      </p>

      {/* Shared eye + mouth shapes, referenced via <use> below. */}
      <svg style={{ display: "none" }} aria-hidden="true">
        <symbol id={eyeId} viewBox="0 0 7 4">
          <path d="M1,1 C1.83333333,2.16666667 2.66666667,2.75 3.5,2.75 C4.33333333,2.75 5.16666667,2.16666667 6,1" />
        </symbol>
        <symbol id={mouthId} viewBox="0 0 18 7">
          <path d="M1,5.5 C3.66666667,2.5 6.33333333,1 9,1 C11.6666667,1 14.3333333,2.5 17,5.5" />
        </symbol>
      </svg>

      <div className={styles.feedback} role="radiogroup" aria-label="Rate your experience">
        {FACE_ORDER.map((face, i) => (
          <label key={face} className={styles[face]} aria-label={FACE_LABELS[face]}>
            <input
              type="radio"
              name="feedback"
              value={String(i + 1)}
              checked={selected === face}
              onChange={() => void submit(face)}
            />
            <div>
              {FACE_SVGS[face].map((part) =>
                part === "eyeL" ? (
                  <svg key={part} className={`${styles.eye} ${styles.left}`}>
                    <use href={`#${eyeId}`} />
                  </svg>
                ) : part === "eyeR" ? (
                  <svg key={part} className={`${styles.eye} ${styles.right}`}>
                    <use href={`#${eyeId}`} />
                  </svg>
                ) : (
                  <svg key={part} className={styles.mouth}>
                    <use href={`#${mouthId}`} />
                  </svg>
                )
              )}
            </div>
          </label>
        ))}
      </div>

      <p className="mt-4 text-center text-xs text-ink-soft">
        {sending ? "Submitting…" : "1 angry · 5 happy"}
      </p>
    </div>
  );
}
