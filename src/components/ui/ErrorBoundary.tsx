"use client";

import { Component, type ReactNode } from "react";

/**
 * Client-side error boundary with a custom fallback.
 *
 * The app previously had zero boundaries, so a single uncaught error in any
 * client component (e.g. WebGL/GLB failure in the 3D hero on a phone) would
 * unmount the ENTIRE React tree — the server-rendered HTML stays visible but
 * every button goes dead. Wrapping fragile sections in this keeps the rest
 * of the page fully interactive when one part breaks.
 */
export default class ErrorBoundary extends Component<
  { fallback?: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error("ErrorBoundary caught:", error, info.componentStack ?? "");
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
