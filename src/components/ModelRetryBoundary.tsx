"use client";

import { Component, Fragment, createContext, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import { MODEL_URLS } from "@/lib/model-urls";

/**
 * Model-loading status, shared from the retry boundary down to the model
 * (which reports when its scene is actually rendering) and up to the hero
 * card's loading overlay (which fades out once the model paints). Context
 * flows through the R3F canvas, so ModelScene can reach it directly.
 */
interface ModelStatus {
  loaded: boolean;
  markLoaded: () => void;
}

export const ModelStatusContext = createContext<ModelStatus | null>(null);

/**
 * Soft studio glow shown while the model streams in (and during a retry
 * backoff) — WITH a caption, so the loading state reads as intentional
 * instead of a broken empty window. Used everywhere the card waits on the
 * 3D: pre-page-ready, chunk download, GLB fetch, and retry backoff.
 */
export function ModelGlow() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <div className="h-24 w-24 animate-pulse rounded-full bg-gradient-to-br from-lime/30 via-accent/20 to-transparent blur-2xl" />
      <span className="text-[10px] font-bold uppercase tracking-[0.35em] text-cream/50">
        Loading the lineup…
      </span>
    </div>
  );
}

const MAX_ATTEMPTS = 3;

interface Props {
  children: ReactNode;
}

interface State {
  attempt: number;
  retrying: boolean;
  error: Error | null;
  giveUp: boolean;
  loaded: boolean;
}

/**
 * Retry wrapper for the 3D hero.
 *
 * Why this exists: drei's loader cache (suspend-react) keeps a REJECTED
 * fetch around after a failure — every later useGLTF(url) instantly rethrows
 * the same cached error. So a single GLB download that gets aborted during
 * the page's load window (a known iOS behavior, and the classic "first load
 * fails, refresh fixes it" symptom) would permanently doom the model for
 * that page load.
 *
 * This boundary:
 *  1. catches any error thrown from the 3D subtree (model fetch, WebGL
 *     context creation, shader compile — anything),
 *  2. clears the loader cache entries for every model variant so the next
 *     attempt genuinely re-downloads instead of rethrowing,
 *  3. shows the glow for a short backoff, then re-mounts the 3D subtree
 *     from scratch (fresh WebGL context, fresh fetches) — up to MAX_ATTEMPTS
 *     total,
 *  4. after the last attempt, rethrows so the parent ErrorBoundary swaps in
 *     the branded static poster instead of a blank card.
 *
 * A transient network failure therefore self-heals in a second or two — the
 * user no longer needs to refresh the whole page.
 */
export default class ModelRetryBoundary extends Component<Props, State> {
  state: State = { attempt: 0, retrying: false, error: null, giveUp: false, loaded: false };
  private timer: ReturnType<typeof setTimeout> | null = null;

  // Stable per-instance so ModelScene's effect doesn't re-run every render.
  private markLoaded = () => this.setState({ loaded: true });

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { retrying: true, error, loaded: false };
  }

  componentDidCatch() {
    // A failed GLB download poisons the loader cache (the rejection is kept
    // forever). Clear every variant so the retry re-fetches from scratch.
    // useGLTF.clear is a safe no-op for URLs that were never requested.
    MODEL_URLS.forEach((url) => useGLTF.clear(url));

    const attempt = this.state.attempt;
    if (attempt + 1 >= MAX_ATTEMPTS) {
      // Out of retries — the next render rethrows to the parent boundary,
      // which swaps in the static poster. (Parent boundary is CyberCard's
      // ErrorBoundary; it only exists above this component at mount time.)
      this.setState({ giveUp: true });
      return;
    }

    // Backoff grows with each attempt (700ms → 1400ms), giving a flaky
    // connection a moment to settle before re-mounting the 3D.
    this.timer = setTimeout(() => {
      this.setState((s) => ({ attempt: s.attempt + 1, retrying: false }));
    }, 700 * (attempt + 1));
  }

  componentWillUnmount() {
    if (this.timer) clearTimeout(this.timer);
  }

  render() {
    if (this.state.giveUp) {
      throw this.state.error ?? new Error("3D failed to load after retries");
    }
    if (this.state.retrying) return <ModelGlow />;
    // key remounts the whole 3D subtree (fresh WebGL context + fetches) on
    // every retry — a stale canvas can't be reused after a failure.
    return (
      <ModelStatusContext.Provider value={{ loaded: this.state.loaded, markLoaded: this.markLoaded }}>
        <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
      </ModelStatusContext.Provider>
    );
  }
}
