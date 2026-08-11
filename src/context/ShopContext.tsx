"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { toggleWishlist } from "@/lib/db";
import type { Product } from "@/lib/types";
import { useAuth, type AppUser } from "./AuthContext";

/**
 * A serializable description of what the user wanted to do behind the
 * sign-in modal. Survives the full-page OAuth redirect so the action
 * completes after they return.
 */
type Intent =
  | { type: "wishlist"; productId: string; next: boolean }
  | { type: "checkout"; product: Product }
  | { type: "sell" };

interface ShopContextValue {
  authOpen: boolean;
  openAuth: () => void;
  closeAuth: () => void;
  /** Runs the gated action after a successful in-page sign-in. */
  completeAuth: () => void;
  /** Auth-gate an arbitrary action; receives the freshly signed-in user. */
  gateAction: (action: (user: AppUser) => void, intent?: Intent) => void;
  checkoutProduct: Product | null;
  openCheckout: (p: Product) => void;
  closeCheckout: () => void;
  sellOpen: boolean;
  openSell: () => void;
  closeSell: () => void;
  /** The "Where do you live?" area prompt — openable from anywhere (e.g.
   * the feed's "Set my area" card), not just the automatic post-sign-in popup. */
  locationPromptOpen: boolean;
  openLocationPrompt: () => void;
  closeLocationPrompt: () => void;
  toast: string | null;
  showToast: (msg: string) => void;
}

const ShopContext = createContext<ShopContextValue | null>(null);

const INTENT_KEY = "thrift-pending-intent";

function serializeIntent(intent: Intent): string {
  if (intent.type === "checkout") {
    // Dates don't survive JSON — send the ISO string and restore on read.
    return JSON.stringify({
      ...intent,
      product: { ...intent.product, createdAt: intent.product.createdAt.toISOString() },
    });
  }
  return JSON.stringify(intent);
}

function deserializeIntent(raw: string): Intent | null {
  try {
    const parsed = JSON.parse(raw) as Intent;
    if (parsed.type === "checkout") {
      parsed.product.createdAt = new Date(parsed.product.createdAt);
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Central shop state: auth-gated modals, checkout, sell, and toasts.
 * Browsing stays free — only purchase/sell actions gate on sign-in.
 */
export function ShopProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [checkoutProduct, setCheckoutProduct] = useState<Product | null>(null);
  const [sellOpen, setSellOpen] = useState(false);
  const [locationPromptOpen, setLocationPromptOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const pendingRef = useRef<(() => void) | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gate = useCallback(
    (action: () => void, intent?: Intent) => {
      if (user) {
        action();
      } else {
        pendingRef.current = action;
        if (intent && typeof window !== "undefined") {
          sessionStorage.setItem(INTENT_KEY, serializeIntent(intent));
        }
        setAuthOpen(true);
      }
    },
    [user]
  );

  // After an OAuth round-trip (full page reload), drain any pending intent.
  // In-page email sign-in handles its own intent via completeAuth, so if a
  // pendingRef exists we must NOT run it here too (would double-fire).
  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    if (pendingRef.current) return;
    const raw = sessionStorage.getItem(INTENT_KEY);
    if (!raw) return;
    sessionStorage.removeItem(INTENT_KEY);
    const intent = deserializeIntent(raw);
    if (!intent) return;
    // Defer so the modal opens after this render commits.
    setTimeout(() => {
      if (intent.type === "wishlist") {
        void toggleWishlist(user.id, intent.productId, intent.next).catch(() => {});
      } else if (intent.type === "checkout") {
        setCheckoutProduct(intent.product);
      } else if (intent.type === "sell") {
        setSellOpen(true);
      }
    }, 0);
  }, [user]);

  const openAuth = () => setAuthOpen(true);
  const closeAuth = () => {
    pendingRef.current = null;
    if (typeof window !== "undefined") sessionStorage.removeItem(INTENT_KEY);
    setAuthOpen(false);
  };
  const completeAuth = () => {
    setAuthOpen(false);
    const action = pendingRef.current;
    pendingRef.current = null;
    if (typeof window !== "undefined") sessionStorage.removeItem(INTENT_KEY);
    action?.();
  };

  /** Gate an action behind sign-in, passing the fresh user. */
  const gateAction = (action: (user: AppUser) => void, intent?: Intent) => {
    if (user) {
      action(user);
      return;
    }
    pendingRef.current = () => {
      const client = getBrowserClient();
      if (!client) return;
      void client.auth.getSession().then(({ data }) => {
        const su = data.session?.user;
        if (su) {
          action({
            id: su.id,
            email: su.email ?? null,
            name: String(su.user_metadata?.name ?? su.user_metadata?.full_name ?? su.email ?? ""),
            photoUrl: (su.user_metadata?.avatar_url as string | undefined) ?? null,
          });
        }
      });
    };
    if (intent && typeof window !== "undefined") {
      sessionStorage.setItem(INTENT_KEY, serializeIntent(intent));
    }
    setAuthOpen(true);
  };

  const openCheckout = useCallback(
    (p: Product) => gate(() => setCheckoutProduct(p), { type: "checkout", product: p }),
    [gate]
  );
  const closeCheckout = useCallback(() => setCheckoutProduct(null), []);
  const openSell = useCallback(
    () => gate(() => setSellOpen(true), { type: "sell" }),
    [gate]
  );
  const closeSell = useCallback(() => setSellOpen(false), []);

  const openLocationPrompt = useCallback(() => setLocationPromptOpen(true), []);
  const closeLocationPrompt = useCallback(() => setLocationPromptOpen(false), []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <ShopContext.Provider
      value={{
        authOpen,
        openAuth,
        closeAuth,
        completeAuth,
        gateAction,
        checkoutProduct,
        openCheckout,
        closeCheckout,
        sellOpen,
        openSell,
        closeSell,
        locationPromptOpen,
        openLocationPrompt,
        closeLocationPrompt,
        toast,
        showToast,
      }}
    >
      {children}
    </ShopContext.Provider>
  );
}

export function useShop(): ShopContextValue {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error("useShop must be used within a ShopProvider");
  return ctx;
}
