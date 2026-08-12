"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Product } from "@/lib/types";
import {
  toggleLocationAlert,
  useLocationAlerts,
  useLocations,
  useProducts,
  useProfileLocation,
} from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { useShop } from "@/context/ShopContext";
import { CATEGORIES } from "@/lib/constants";
import { ScrollTrigger } from "@/lib/gsap";
import ProductCard from "./ProductCard";
import Reveal from "./ui/Reveal";
import SplitReveal from "./ui/SplitReveal";
import DraggableCarousel, { type DraggableCarouselHandle } from "./ui/DraggableCarousel";
import NeoSearch from "./ui/NeoSearch";

type SortId = "newest" | "price-asc" | "price-desc";

function matchesQuery(p: Product, q: string): boolean {
  const haystack = [p.title, p.brand, p.category, p.condition, p.era, p.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "border-ink bg-ink text-cream"
          : "border-line bg-paper text-ink-soft hover:border-ink hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export default function ProductFeed() {
  const products = useProducts();
  const { user } = useAuth();
  const { openLocationPrompt, showToast } = useShop();
  const locations = useLocations();
  const profileLocationId = useProfileLocation(user?.id ?? null);
  const alertLocationIds = useLocationAlerts(user?.id ?? null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortId>("newest");
  const [category, setCategory] = useState("all");
  const [nearMe, setNearMe] = useState(false);
  // Once the buyer's area loads, the rack defaults to "Near me" — unless
  // they've already flipped the toggle this session, which wins.
  const [nearMeTouched, setNearMeTouched] = useState(false);
  // Standalone optional location filter (county → area, Jumia-style), separate
  // from the search panel. Purely opt-in: no profile location required.
  const [locCity, setLocCity] = useState("");
  const [locArea, setLocArea] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const carouselRef = useRef<DraggableCarouselHandle>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();

  // Fixed category set for the filter — the catalog is curated around
  // Tops / Trousers / Accessories / Caps / Shoes.
  const categories = CATEGORIES;

  // Buyer area for the "Near me" filter: their chosen location id → area
  // (falling back to county) via the locations catalog.
  const locById = useMemo(
    () => new Map((locations ?? []).map((l) => [l.id, l])),
    [locations]
  );
  const buyerLoc = profileLocationId ? locById.get(profileLocationId) : undefined;

  // Personalized default: signed-in buyers with an area see their county's
  // pieces first (exact area ranked top). Toggling the chip off marks it
  // touched so it never re-enables behind their back this session. Keyed
  // render-time adjustment (the LocationPicker pattern) — fires only when
  // buyerLoc flips from unknown → known, never mid-session.
  const [nearAutoSeed, setNearAutoSeed] = useState("idle");
  const nearAuto = !nearMeTouched && buyerLoc ? "apply" : "idle";
  if (nearAuto !== nearAutoSeed) {
    setNearAutoSeed(nearAuto);
    if (nearAuto === "apply") {
      setNearMe(true);
      setNearMeTouched(true);
    }
  }

  const toggleNearMe = (value: boolean) => {
    setNearMeTouched(true);
    setNearMe(value);
  };

  // Area drop alert bell: watches the buyer's county (their profile area's
  // catalog row — county matching in notify_new_drop). Realtime list keeps
  // the bell state honest across tabs/devices.
  const alertOn = Boolean(buyerLoc && alertLocationIds?.includes(buyerLoc.id));
  const toggleAlert = async () => {
    if (!user || !buyerLoc) return;
    const next = !alertOn;
    try {
      await toggleLocationAlert(user.id, buyerLoc.id, next);
      showToast(
        next
          ? `We'll ping you when new drops land in ${buyerLoc.city}.`
          : `Alerts off for ${buyerLoc.city}.`
      );
    } catch {
      showToast("Couldn't update the alert. Try again.");
    }
  };

  // Counties / areas for the standalone location filter (from the catalog).
  const filterCities = useMemo(
    () => [...new Set((locations ?? []).map((l) => l.city))].sort(),
    [locations]
  );
  const filterAreas = useMemo(
    () => [...new Set((locations ?? []).filter((l) => l.city === locCity).map((l) => l.area))].sort(),
    [locations, locCity]
  );
  const filterCount =
    (category !== "all" ? 1 : 0) + (nearMe ? 1 : 0) + (locCity ? 1 : 0);
  const activeCount = filterCount + (sort !== "newest" ? 1 : 0);

  const newDrops = useMemo(() => {
    const drops = (products ?? []).filter((p) => p.isNewDrop);
    return q ? drops.filter((p) => matchesQuery(p, q)) : drops;
  }, [products, q]);

  // Every live piece belongs in the full rack — including fresh new drops,
  // which are highlighted up top in the New Drops carousel AND remain here.
  const available = useMemo(() => {
    const list = products ?? [];
    return q ? list.filter((p) => matchesQuery(p, q)) : list;
  }, [products, q]);

  // Filters + sort, all driven from the panel that drops under the search
  // bar: category narrows the rack, then the chosen order (newest /
  // low→high / high→low) is applied.
  const filtered = useMemo(() => {
    const list = available.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      // Standalone location filter: exact county, then optional exact area.
      if (locCity) {
        const prodLoc = p.locationId ? locById.get(p.locationId) : undefined;
        if (!prodLoc || prodLoc.city !== locCity) return false;
        if (locArea && prodLoc.area !== locArea) return false;
      }
      // "Near me": pieces whose seller meets anywhere in the buyer's COUNTY,
      // with exact-area matches ranked first (see byNearness below). Area
      // alone was too strict — a Karen buyer couldn't see Westlands drops.
      if (nearMe && buyerLoc) {
        const prodLoc = p.locationId ? locById.get(p.locationId) : undefined;
        if (!prodLoc || prodLoc.city !== buyerLoc.city) return false;
      }
      return true;
    });
    // Paid boosts float to the top of every sort, then (with Near me) the
    // buyer's exact area rises above same-county pieces, then the chosen
    // order applies within the groups.
    const byBoost = (a: Product, b: Product) => Number(b.isBoosted) - Number(a.isBoosted);
    const byNearness = (a: Product, b: Product) => {
      if (!nearMe || !buyerLoc?.area) return 0;
      const aLoc = a.locationId ? locById.get(a.locationId) : undefined;
      const bLoc = b.locationId ? locById.get(b.locationId) : undefined;
      const aExact = aLoc?.area === buyerLoc.area ? 1 : 0;
      const bExact = bLoc?.area === buyerLoc.area ? 1 : 0;
      return bExact - aExact;
    };
    if (sort === "price-asc") list.sort((a, b) => byBoost(a, b) || byNearness(a, b) || a.priceKes - b.priceKes);
    else if (sort === "price-desc") list.sort((a, b) => byBoost(a, b) || byNearness(a, b) || b.priceKes - a.priceKes);
    else list.sort((a, b) => byBoost(a, b) || byNearness(a, b) || b.createdAt.getTime() - a.createdAt.getTime());
    return list;
  }, [available, category, sort, nearMe, buyerLoc, locById, locCity, locArea]);

  // "Near you" — the personalized suggestion section for signed-in users who
  // set their area (profiles.location_id). Same county as the buyer, boosted
  // pieces first, their exact area above the rest of the county, then newest.
  // Rendered separately from the full rack so browsing everything stays easy.
  const nearby = useMemo(() => {
    if (!buyerLoc) return [];
    return available
      .filter((p) => {
        const prodLoc = p.locationId ? locById.get(p.locationId) : undefined;
        return prodLoc && prodLoc.city === buyerLoc.city;
      })
      .sort((a, b) => {
        const byBoost = Number(b.isBoosted) - Number(a.isBoosted);
        if (byBoost) return byBoost;
        const aExact = a.locationId && locById.get(a.locationId)?.area === buyerLoc.area ? 1 : 0;
        const bExact = b.locationId && locById.get(b.locationId)?.area === buyerLoc.area ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
  }, [available, buyerLoc, locById]);

  const clearFilters = () => {
    setCategory("all");
    setSort("newest");
    setNearMe(false);
    setNearMeTouched(true);
    setLocCity("");
    setLocArea("");
  };

  // Close the filter panel on outside click or Escape.
  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setFiltersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  const scrollTrack = (dir: 1 | -1) => carouselRef.current?.scrollBy(dir * 340);

  // The feed loads async — refresh ScrollTrigger positions once it lands so
  // reveals below the fold (e.g. the footer) aren't measured against the
  // skeleton layout.
  useEffect(() => {
    if (products) ScrollTrigger.refresh();
  }, [products]);

  if (!products) {
    return (
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="h-8 w-48 animate-pulse rounded-full bg-sand" />
        <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-sand" />
          ))}
        </div>
      </section>
    );
  }

  if (products.length === 0) {
    return (
      <section className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="font-display text-2xl font-black">All drops are gone for now.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
          Fresh 1-of-1 pieces land weekly.
        </p>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      {/* New Drops */}
      {newDrops.length > 0 && (
        <section id="new-drops" className="scroll-mt-24 py-14">
          <Reveal className="mb-6 flex items-end justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-accent">Fresh off the rack</p>
              <SplitReveal className="mt-1 font-display text-3xl font-black tracking-tight sm:text-4xl">
                New Drops
              </SplitReveal>
            </div>
            <div className="hidden gap-2 sm:flex">
              <button
                onClick={() => scrollTrack(-1)}
                aria-label="Scroll new drops left"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-paper transition hover:border-ink"
              >
                ←
              </button>
              <button
                onClick={() => scrollTrack(1)}
                aria-label="Scroll new drops right"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-paper transition hover:border-ink"
              >
                →
              </button>
            </div>
          </Reveal>
          <Reveal y={36}>
            <DraggableCarousel ref={carouselRef}>
              {newDrops.map((p) => (
                <div key={p.id} className="w-[68vw] shrink-0 sm:w-[300px]">
                  <ProductCard product={p} />
                </div>
              ))}
            </DraggableCarousel>
          </Reveal>
        </section>
      )}

      {/* Near you — personalized suggestions once the buyer sets their area */}
      {nearby.length > 0 && buyerLoc && (
        <section id="near-you" className="scroll-mt-24 py-14">
          <Reveal className="mb-6 flex items-end justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-accent">Suggested for you</p>
              <SplitReveal className="mt-1 font-display text-3xl font-black tracking-tight sm:text-4xl">
                Near you · {buyerLoc.city}
              </SplitReveal>
              <p className="mt-1 text-sm text-ink-soft">
                {buyerLoc.area
                  ? `${nearby.length} piece${nearby.length === 1 ? "" : "s"} meeting in ${buyerLoc.city}. Your area (${buyerLoc.area}) first.`
                  : `${nearby.length} piece${nearby.length === 1 ? "" : "s"} meeting in ${buyerLoc.city}.`}
              </p>
            </div>
          </Reveal>
          <Reveal stagger className="grid grid-cols-2 gap-5 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
            {nearby.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </Reveal>
        </section>
      )}

      {/* Available Drops */}
      <section id="drops" className="scroll-mt-24 py-14">
        <Reveal className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent">The full rack</p>
            <SplitReveal className="mt-1 font-display text-3xl font-black tracking-tight sm:text-4xl">
              Available Drops
            </SplitReveal>
            <p className="mt-1 text-sm text-ink-soft">
              {filterCount > 0
                ? `${filtered.length} piece${filtered.length === 1 ? "" : "s"} match your filters`
                : `${available.length} pieces live right now`}
            </p>
          </div>
        </Reveal>

        <Reveal y={20} className="relative z-20 mb-5">
          <div ref={panelRef} className="relative">
            <NeoSearch
              value={query}
              onChange={setQuery}
              placeholder=""
              aria-label="Search drops"
              active={filtersOpen || activeCount > 0}
              onFilterClick={() => setFiltersOpen((open) => !open)}
            />

            {filtersOpen && (
              <div className="absolute left-0 right-0 top-full z-30 mt-3 rounded-2xl border border-line bg-paper p-5 shadow-2xl">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="font-display text-sm font-bold">Filter &amp; sort the rack</p>
                  {activeCount > 0 && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-xs font-semibold text-accent transition hover:underline"
                    >
                      Clear all ({activeCount})
                    </button>
                  )}
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-ink-soft">
                      Sort by price
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Chip active={sort === "newest"} onClick={() => setSort("newest")}>
                        Newest first
                      </Chip>
                      <Chip active={sort === "price-asc"} onClick={() => setSort("price-asc")}>
                        Price: low → high
                      </Chip>
                      <Chip active={sort === "price-desc"} onClick={() => setSort("price-desc")}>
                        Price: high → low
                      </Chip>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-ink-soft">
                      Category
                    </p>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      aria-label="Filter by category"
                      className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm font-semibold outline-none transition focus:border-ink"
                    >
                      <option value="all">All categories</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-4 border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={() => toggleNearMe(!nearMe)}
                    aria-pressed={nearMe}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      nearMe
                        ? "border-ink bg-ink text-cream"
                        : "border-line bg-paper text-ink-soft hover:border-ink hover:text-ink"
                    }`}
                  >
                    {nearMe
                      ? buyerLoc?.area
                        ? `✓ Near me: ${buyerLoc.city} (${buyerLoc.area} first)`
                        : `✓ Near me: ${buyerLoc?.city ?? "your county"}`
                      : "📍 Near me"}
                  </button>
                  {nearMe && !buyerLoc && (
                    <p className="mt-2 text-xs text-ink-soft">
                      Set your area in{" "}
                      <Link href="/account" className="font-bold text-accent underline-offset-2 hover:underline">
                        My Account
                      </Link>{" "}
                      to see pieces near you. Same-county drops first, your area at the top.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-ink-soft">
                    Showing {filtered.length} of {available.length} pieces
                  </p>
                </div>
              </div>
            )}
          </div>
        </Reveal>

        {/* Standalone optional location filter — separate from the search
            panel above. Purely opt-in: pick a county (and optionally an
            area) to narrow the rack to pieces meeting there. Jumia-style:
            county → area only, no landmark precision. */}
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-paper px-4 py-3">
          <span className="mr-1 text-[11px] font-bold uppercase tracking-widest text-ink-soft">
            📍 Location
          </span>
          <select
            value={locCity}
            onChange={(e) => {
              setLocCity(e.target.value);
              setLocArea("");
            }}
            aria-label="Filter by county"
            className="w-40 rounded-xl border border-line bg-paper px-3 py-2 text-sm font-semibold outline-none transition focus:border-ink"
          >
            <option value="">All counties</option>
            {filterCities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={locArea}
            onChange={(e) => setLocArea(e.target.value)}
            disabled={!locCity}
            aria-label="Filter by area"
            className="w-40 rounded-xl border border-line bg-paper px-3 py-2 text-sm font-semibold outline-none transition focus:border-ink disabled:opacity-50"
          >
            <option value="">All areas</option>
            {filterAreas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          {locCity && (
            <button
              type="button"
              onClick={() => {
                setLocCity("");
                setLocArea("");
              }}
              className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-ink hover:text-ink"
            >
              Clear
            </button>
          )}
          {/* Visible Near-me toggle — makes the auto-enabled county filter
              obvious and one-tap to turn back off. */}
          {buyerLoc && (
            <button
              type="button"
              onClick={() => toggleNearMe(!nearMe)}
              aria-pressed={nearMe}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                nearMe
                  ? "border-ink bg-ink text-cream"
                  : "border-line bg-paper text-ink-soft hover:border-ink hover:text-ink"
              }`}
            >
              {nearMe
                ? `✓ Near me: ${buyerLoc.city}${buyerLoc.area ? ` (${buyerLoc.area} first)` : ""}`
                : `📍 Near me: ${buyerLoc.city}`}
            </button>
          )}
          {nearMe && buyerLoc && (
            <button
              type="button"
              onClick={() => toggleNearMe(false)}
              className="rounded-full border border-accent/30 bg-accent-soft/50 px-3 py-1.5 text-xs font-bold text-accent transition hover:bg-accent hover:text-white"
            >
              Show all drops
            </button>
          )}
          {/* Area drop alert bell — new pieces in this county ping the bell. */}
          {buyerLoc && user && (
            <button
              type="button"
              onClick={() => void toggleAlert()}
              aria-pressed={alertOn}
              title={
                alertOn
                  ? `We'll notify you when new drops land in ${buyerLoc.city}`
                  : `Notify me when new drops land in ${buyerLoc.city}`
              }
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                alertOn
                  ? "border-amber-400 bg-amber-400 text-lime-ink"
                  : "border-line bg-paper text-ink-soft hover:border-ink hover:text-ink"
              }`}
            >
              {alertOn ? `🔔 Alerts on · ${buyerLoc.city}` : `🔕 Notify me · ${buyerLoc.city}`}
            </button>
          )}
        </div>

        {/* Signed in but never set an area — invite them to, so "Near you"
            and the county-first rack kick in. One tap reopens the same
            prompt they saw after signing in (if they skipped it). */}
        {user && profileLocationId === "" && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-3">
            <div>
              <p className="text-sm font-bold">See pieces near you</p>
              <p className="text-xs text-ink-soft">
                Set the area you live in and nearby drops rise to the top of the rack.
              </p>
            </div>
            <button
              type="button"
              onClick={openLocationPrompt}
              className="rounded-full bg-ink px-4 py-2 text-xs font-bold uppercase tracking-wider text-cream transition hover:bg-accent"
            >
              Set my area
            </button>
          </div>
        )}

        {filtered.length > 0 ? (
          <Reveal
            stagger
            className="grid grid-cols-2 gap-5 sm:gap-6 md:grid-cols-3 lg:grid-cols-4"
          >
            {filtered.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </Reveal>
        ) : (
          <div className="rounded-2xl border border-line bg-paper p-8 text-center text-sm text-ink-soft">
            {nearMe && locCity && buyerLoc && locCity !== buyerLoc.city ? (
              <p>
                Near me shows <span className="font-bold text-ink">{buyerLoc.city}</span> pieces,
                but the location filter is set to{" "}
                <span className="font-bold text-ink">{locCity}</span>. Clear the location filter or
                pick <span className="font-bold text-ink">{buyerLoc.city}</span> to see nearby drops.
              </p>
            ) : nearMe && buyerLoc && filterCount === 1 ? (
              <p>
                No pieces meeting in <span className="font-bold text-ink">{buyerLoc.city}</span> right now.
                See all drops instead. New ones land all the time.
              </p>
            ) : query || filterCount > 0 ? (
              "No pieces match your search or filters. Try widening them."
            ) : (
              "No pieces available right now. Fresh drops land soon."
            )}
            {activeCount > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-semibold text-accent transition hover:underline"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
