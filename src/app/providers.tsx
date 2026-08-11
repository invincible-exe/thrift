"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/context/AuthContext";
import { ShopProvider } from "@/context/ShopContext";
import { ThemeProvider } from "@/context/ThemeContext";
import GlobalModals from "@/components/GlobalModals";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ShopProvider>
          {children}
          <GlobalModals />
        </ShopProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
