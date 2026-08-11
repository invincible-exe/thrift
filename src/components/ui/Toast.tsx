"use client";

import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useShop } from "@/context/ShopContext";
import { useMounted } from "@/lib/use-mounted";

export default function Toast() {
  const { toast } = useShop();

  // Render nothing until the client has mounted (see useMounted above):
  // both the server HTML and the client's first render are null, then the
  // portal is created post-hydration.
  const mounted = useMounted();

  if (!mounted) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast}
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            className="rounded-full border border-line bg-ink px-5 py-3 text-sm font-semibold text-cream shadow-xl"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    // Portal into the dedicated #portal-root (rendered in the root layout)
    // instead of document.body — portal hydration against the whole body can
    // misattribute sibling fixed elements like FloatingContact.
    document.getElementById("portal-root") ?? document.body
  );
}
