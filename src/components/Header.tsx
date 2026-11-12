"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useShop } from "@/context/ShopContext";
import { useTheme } from "@/context/ThemeContext";
import { useIsAdmin } from "@/lib/admin";
import { markNotificationsRead, useNotifications, useWishlistIds } from "@/lib/db";
import { gsap } from "@/lib/gsap";

export default function Header() {
  const { user, logout } = useAuth();
  const { openAuth, openSell } = useShop();
  const { dark, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const themeBtnRef = useRef<HTMLButtonElement>(null);
  const wipeBusyRef = useRef(false);
  const wishlistIds = useWishlistIds(user?.id ?? null);
  const savedCount = wishlistIds?.length ?? 0;
  const notifications = useNotifications(user?.id ?? null);
  const unreadCount = (notifications ?? []).filter((n) => !n.read).length;
  const { isAdmin } = useIsAdmin(user?.id ?? null);

  // Expanding-circle wipe (GSAP) hides the instant color flip when switching
  // themes; reduced-motion users get a plain toggle (CSS handles the fade).
  const handleThemeToggle = () => {
    const btn = themeBtnRef.current;
    const nextDark = !dark;
    if (wipeBusyRef.current) return;
    if (!btn || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      toggle();
      return;
    }
    wipeBusyRef.current = true;
    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const root = document.documentElement;
    // Read the target theme's page background from the live palette so the
    // wipe circle never drifts out of sync with globals.css (the class flip
    // is synchronous, so nothing paints in between).
    root.classList.toggle("dark", nextDark);
    const targetBg =
      getComputedStyle(root).getPropertyValue("--cream").trim() ||
      (nextDark ? "#14110e" : "#f3eee7");
    root.classList.toggle("dark", !nextDark);
    const overlay = document.createElement("div");
    overlay.style.cssText =
      `position:fixed;inset:0;z-index:60;pointer-events:none;border-radius:50%;` +
      `background:${targetBg};transform:scale(0);` +
      `transform-origin:${x}px ${y}px;`;
    document.body.appendChild(overlay);
    const ease = gsap.parseEase("M0,0 C0.2,1 0.32,1 1,1");
    gsap.fromTo(
      overlay,
      { scale: 0 },
      {
        scale: 3,
        duration: 0.55,
        ease,
        onComplete: () => {
          toggle();
          gsap.to(overlay, {
            autoAlpha: 0,
            duration: 0.45,
            ease: "power2.out",
            onComplete: () => {
              overlay.remove();
              wipeBusyRef.current = false;
            },
          });
        },
      }
    );
  };

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Mark everything read once the user actually looks at the dropdown.
  useEffect(() => {
    if (notifOpen && user && unreadCount > 0) {
      void markNotificationsRead(user.id).catch(() => {});
    }
  }, [notifOpen, user, unreadCount]);

  const initial = (user?.name || user?.email || "U").charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-cream/85 backdrop-blur-md">
      <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-6 lg:px-8">
        <nav className="hidden items-center gap-5 lg:flex" aria-label="Primary">
          <a href="#new-drops" className="text-xs font-bold uppercase tracking-widest text-ink-soft transition hover:text-ink">
            New drops
          </a>
          <Link
            href="/wishlist"
            className="relative text-xs font-bold uppercase tracking-widest text-ink-soft transition hover:text-ink"
          >
            Saved
            {savedCount > 0 && (
              <span className="absolute -right-3.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-black text-white">
                {savedCount}
              </span>
            )}
          </Link>
          <a href="#drops" className="text-xs font-bold uppercase tracking-widest text-ink-soft transition hover:text-ink">
            Available
          </a>
          <Link
            href="/account#closet"
            className="text-xs font-bold uppercase tracking-widest text-ink-soft transition hover:text-ink"
          >
            My closet
          </Link>
        </nav>

        <div className="lg:hidden" />

        <Link href="/" className="group flex flex-col items-center py-3 leading-none" aria-label="10/10 Thrifts home">
          <span className="font-display text-3xl font-black tracking-tighter">
            10/10<span className="text-accent">.</span>
          </span>
          <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.4em] text-ink-soft">
            Thrifts
          </span>
        </Link>

        <div className="flex items-center justify-end gap-2.5 sm:gap-3">
          <Link
            href="/wishlist"
            aria-label={`Saved pieces${savedCount ? ` (${savedCount})` : ""}`}
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-line bg-paper text-base transition hover:border-ink/40 sm:hidden"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.099 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
            </svg>
            {savedCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-black text-white">
                {savedCount}
              </span>
            )}
          </Link>
          <button
            onClick={openSell}
            className="hidden rounded-full border-2 border-ink px-4 py-2 text-xs font-bold uppercase tracking-wider transition hover:bg-ink hover:text-cream sm:inline-flex"
          >
            Sell a piece
          </button>

          {user && (
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen((o) => !o)}
                aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
                className="relative flex h-10 w-10 items-center justify-center rounded-full border border-line bg-paper text-ink-soft transition hover:border-ink/40 hover:text-ink"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-black text-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute left-1/2 top-12 w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-line bg-paper p-2 shadow-xl sm:left-auto sm:right-0 sm:translate-x-0">
                  <p className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-widest text-ink-soft">
                    Notifications
                  </p>
                  {notifications && notifications.length > 0 ? (
                    <ul className="max-h-80 overflow-y-auto">
                      {notifications.slice(0, 12).map((n) => {
                        const icon =
                          n.type === "listing_approved"
                            ? "✓"
                            : n.type === "listing_rejected"
                              ? "✕"
                              : n.type === "payout_paid"
                                ? "💸"
                                : "✦";
                        // Accent reads well on both the sand card (light
                        // mode) and the dark paper background; lime would
                        // vanish on the light sand.
                        const iconClass =
                          n.type === "listing_approved" ||
                          n.type === "listing_rejected" ||
                          n.type === "payout_paid"
                            ? "text-accent"
                            : "text-ink";
                        const inner = (
                          <>
                            <p className="font-semibold">
                              <span className={iconClass}>{icon}</span>{" "}
                              {n.title}
                            </p>
                            <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{n.body}</p>
                          </>
                        );
                        const cardClass = `block rounded-xl px-3 py-2.5 text-sm transition ${
                          n.read ? "opacity-60" : "bg-sand"
                        }`;
                        return (
                          <li key={n.id}>
                            {n.type === "new_drop" ? (
                              <Link href="/#new-drops" onClick={() => setNotifOpen(false)} className={cardClass}>
                                {inner}
                              </Link>
                            ) : (
                              <div className={cardClass}>{inner}</div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : notifications !== null ? (
                    <p className="px-3 py-6 text-center text-sm text-ink-soft">
                      Nothing yet. We&apos;ll ping you when a piece you listed is approved or rejected,
                      and when fresh drops land.
                    </p>
                  ) : null}
                  <Link
                    href="/account"
                    onClick={() => setNotifOpen(false)}
                    className="mt-1 block rounded-xl px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wider text-accent transition hover:bg-sand"
                  >
                    View listings
                  </Link>
                </div>
              )}
            </div>
          )}

          <button
            ref={themeBtnRef}
            onClick={handleThemeToggle}
            aria-label="Toggle dark mode"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-paper text-ink-soft transition hover:border-ink/40 hover:text-ink"
          >
            {/* CSS-driven icons: correct from first paint, no hydration
                mismatch, and they flip instantly with the theme. */}
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden className="h-5 w-5 dark:hidden">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
            </svg>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden className="hidden h-5 w-5 dark:block">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
            </svg>
          </button>

          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-paper py-1.5 pl-1.5 pr-3 transition hover:border-ink/40"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink font-display text-sm font-black text-cream">
                  {initial}
                </span>
                <span className="hidden max-w-[110px] truncate text-sm font-semibold sm:block">
                  {user.name || "Account"}
                </span>
                <span className="text-xs text-ink-soft">▾</span>
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-12 w-52 rounded-2xl border border-line bg-paper p-2 shadow-xl" role="menu">
                  <Link
                    href="/account"
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-xl px-3 py-2.5 text-sm font-semibold transition hover:bg-sand"
                    role="menuitem"
                  >
                    My Account
                  </Link>
                  <Link
                    href="/wishlist"
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-xl px-3 py-2.5 text-sm font-semibold transition hover:bg-sand"
                    role="menuitem"
                  >
                    Saved pieces {savedCount > 0 && `(${savedCount})`}
                  </Link>
                  {isAdmin && (
                    <Link
                      href="/admin"
                      onClick={() => setMenuOpen(false)}
                      className="block rounded-xl px-3 py-2.5 text-sm font-semibold text-accent transition hover:bg-sand"
                      role="menuitem"
                    >
                      Admin dashboard
                    </Link>
                  )}
                  <button
                    onClick={() => {
                      logout();
                      setMenuOpen(false);
                    }}
                    className="block w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-ink-soft transition hover:bg-sand hover:text-ink"
                    role="menuitem"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={openAuth}
              className="rounded-full bg-ink px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-cream transition hover:bg-black"
            >
              Sign in
            </button>
          )}
        </div>
      </div>

      {/* Mobile nav row — the four primary links, always reachable on
          phones. Flex negatively-margined strip so tabs are equal-height
          and the touched anchors line up on one baseline. */}
      <nav
        className="flex items-center overflow-x-auto border-t border-line/70 px-4 sm:px-6 lg:hidden"
        aria-label="Primary"
      >
        <a
          href="#new-drops"
          className="flex flex-shrink-0 items-center px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-ink-soft transition hover:text-ink"
        >
          New drops
        </a>
        <Link
          href="/wishlist"
          className="relative flex flex-shrink-0 items-center px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-ink-soft transition hover:text-ink"
        >
          Saved
          {savedCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-black text-white">
              {savedCount}
            </span>
          )}
        </Link>
        <a
          href="#drops"
          className="flex flex-shrink-0 items-center px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-ink-soft transition hover:text-ink"
        >
          Available
        </a>
        <Link
          href="/account#closet"
          className="flex flex-shrink-0 items-center px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-ink-soft transition hover:text-ink"
        >
          My closet
        </Link>
      </nav>
    </header>
  );
}
