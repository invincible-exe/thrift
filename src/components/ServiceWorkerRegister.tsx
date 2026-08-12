"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker (public/sw.js). Production only — in dev
 * the HMR runtime fights with a service worker and causes stale-module
 * pain for zero benefit. Swallows failures: installability is a nice-to-have,
 * never something that should break the page.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
