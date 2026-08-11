"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * Hydration-safe "are we on the client yet?" check. Returns the server
 * snapshot (false) during SSR and the client snapshot (true) after
 * hydration, with no setState-in-effect and no render-phase state flip —
 * so client-only UI (e.g. portals) can be appended post-hydration and is
 * never hydrated against the server HTML.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}
