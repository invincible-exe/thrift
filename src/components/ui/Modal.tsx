"use client";

import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useMounted } from "@/lib/use-mounted";

export default function Modal({
  open,
  onClose,
  children,
  label,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label?: string;
  /** Roomier panel (e.g. the product photo gallery). */
  wide?: boolean;
}) {
  // Render nothing until the client has mounted (see useMounted above):
  // both the server HTML and the client's first render are null, then the
  // portal is created post-hydration.
  const mounted = useMounted();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-ink/60 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className={`relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-paper shadow-2xl sm:rounded-3xl ${
              wide ? "max-w-3xl" : "max-w-lg"
            }`}
            initial={{ y: 56, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 32, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    // Portal into the dedicated #portal-root (rendered in the root layout)
    // instead of document.body — portal hydration against the whole body can
    // misattribute sibling fixed elements like FloatingContact.
    document.getElementById("portal-root") ?? document.body
  );
}
