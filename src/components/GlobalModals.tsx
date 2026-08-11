"use client";

import { useEffect } from "react";
import AuthModal from "./AuthModal";
import CheckoutModal from "./CheckoutModal";
import LocationOnboarding from "./LocationOnboarding";
import SellModal from "./SellModal";
import Toast from "./ui/Toast";
import { useShop } from "@/context/ShopContext";

export default function GlobalModals() {
  const { showToast } = useShop();

  // Card payments land back here with ?paid=1 (or ?paid=0) — confirm to the
  // buyer and clear the query so the toast doesn't repeat on refresh.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paid = params.get("paid");
    if (paid === "1" || paid === "0") {
      // Defer so the toast fires after this render commits (the intent-drain
      // pattern in ShopContext).
      setTimeout(() => {
        showToast(
          paid === "1"
            ? "Payment received — the piece is yours 🎉"
            : "The payment didn't go through. No charge was made."
        );
        window.history.replaceState(null, "", window.location.pathname);
      }, 0);
    }
  }, [showToast]);

  return (
    <>
      <AuthModal />
      <CheckoutModal />
      <LocationOnboarding />
      <SellModal />
      <Toast />
    </>
  );
}
