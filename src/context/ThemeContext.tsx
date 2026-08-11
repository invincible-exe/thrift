"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type ThemeMode = "system" | "light" | "dark";

type ThemeCtx = { dark: boolean; toggle: () => void; mode: ThemeMode };

const ThemeContext = createContext<ThemeCtx>({ dark: false, toggle: () => {}, mode: "system" });

const STORAGE_KEY = "theme";

/** Stored override, or "system" when the user has never toggled (or cleared it). */
function readStoredMode(): ThemeMode {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s === "light" || s === "dark" || s === "system") return s;
  } catch {
    // Private mode / storage blocked — fall through to system mode.
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/**
 * Theme state with three modes:
 *  - "system" (default, first visit): follows the device's light/dark
 *    preference, including live changes while the page is open.
 *  - "light" / "dark": the user's explicit override, persisted to
 *    localStorage and applied on every visit.
 *
 * The inline no-flash script in layout.tsx applies the initial `dark` class
 * before first paint using the same logic, so this context only keeps it in
 * sync — no post-hydration flip, no effect-based setState on mount.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() =>
    typeof document === "undefined" ? "system" : readStoredMode()
  );
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  // While in system mode, keep following the device even if the OS theme
  // changes mid-session (e.g. a scheduled dark-mode switch at sunset).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const dark = mode === "dark" || (mode === "system" && systemDark);

  // Keep the DOM class + persisted mode in sync with the state.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage blocked — the session still switches correctly.
    }
  }, [dark, mode]);

  const toggle = useCallback(() => {
    setMode((m) => {
      // First toggle from system mode jumps to the explicit opposite of the
      // device preference, so the switch is immediately visible; afterwards
      // it flips between the two explicit themes.
      if (m === "system") return systemDark ? "light" : "dark";
      return m === "dark" ? "light" : "dark";
    });
  }, [systemDark]);

  return (
    <ThemeContext.Provider value={{ dark, toggle, mode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
