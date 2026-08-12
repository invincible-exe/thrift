import type { Metadata, Viewport } from "next";
import { Archivo, Inter } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import ScrollProgress from "@/components/ui/ScrollProgress";
import FloatingContact from "@/components/ui/FloatingContact";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
  weight: ["400", "500", "600", "700", "800", "900"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "10/10 Thrifts | Premium Curated Thrift",
  description:
    "1-of-1 premium pieces, no doubles ever. Browse free, pay with M-Pesa or bank transfer. Sell your fits for 90% of the sale.",
  // PWA: the manifest makes the site installable ("Add to Home Screen" /
  // "Install app"); the appleWebApp + apple-touch-icon entries give iPhones
  // the fullscreen app treatment on their own "Add to Home Screen".
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "10/10 Thrifts",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
};

// Browser UI chrome matches the app's dark paper background. (theme-color
// in the viewport export — the metadata themeColor form is deprecated.)
export const viewport: Viewport = {
  themeColor: "#1e1915",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${archivo.variable} ${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        {/* Apply the saved/system theme before first paint so there's no
            light-mode flash for dark-mode users. Mirrors ThemeContext's
            three modes: "dark" → dark, "light" → light, and "system" or
            no stored value → the device preference.

            This is a plain <script> tag (NOT next/script): next/script with
            strategy="beforeInteractive" + dangerouslySetInnerHTML renders a
            script ELEMENT in the React tree, which React 19.2 flags with
            "Encountered a script tag while rendering React component" and
            can desync the server/client HTML (hydration mismatch). A raw
            script tag rendered by the server lands in the initial HTML
            verbatim and executes before hydration — exactly what a
            no-flash theme init needs — and hydrates in place.
            suppressHydrationWarning tells React to accept the class the
            script applies to <html> before it hydrates. */}
        <script
          id="theme-init"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("theme");var d=s==="dark"?true:s==="light"?false:window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark")}catch(e){}})();`,
          }}
        />
        <ScrollProgress />
        <Providers>{children}</Providers>
        <FloatingContact />
        {/* PWA service worker — registers itself only in production. */}
        <ServiceWorkerRegister />
        {/* Dedicated portal target. Toast/Modal portal here instead of
            document.body so React's hydration never scans the whole body and
            misattributes sibling fixed-position elements (FloatingContact). */}
        <div id="portal-root" />
      </body>
    </html>
  );
}
