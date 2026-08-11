"use client";

import { useEffect, useState } from "react";

/**
 * Render-pure "current time" for expiry logic (boost windows, new-drop age,
 * etc.). Components must never call Date.now() during render (the project's
 * react-hooks/purity rule enforces it) — this hook keeps `now` in state, so
 * rendering only ever reads a plain number.
 *
 * The seed uses a lazy useState initializer (Date.now() is fine there — it
 * runs once per mount), then refreshes every `intervalMs` from the interval
 * callback so no setState happens synchronously in an effect body.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);

  return now;
}
