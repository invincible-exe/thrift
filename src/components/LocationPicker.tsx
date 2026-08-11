"use client";

import { useMemo, useState } from "react";
import { useLocations } from "@/lib/db";
import type { Location } from "@/lib/types";

const selectCls =
  "w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm font-semibold outline-none transition focus:border-ink disabled:opacity-50";

/**
 * Cascading county → area picker, driven by the `locations` table — Jumia-style,
 * deliberately ambiguous: no precise landmark step. Sellers pick the area they
 * meet in ("Nairobi · Westlands") and buyer + seller agree on the exact spot in
 * the order chat; the catalog's landmark rows just serve as concrete meetup
 * suggestions and give each area a stable row id.
 *
 * Selecting an area reports the FIRST landmark row of that area so the stored
 * location_id always resolves to the right county + area (and Near-me /
 * filters match on it). The `locations` table stays as-is; only the UI is
 * coarser.
 */
export default function LocationPicker({
  value,
  onChange,
}: {
  /** Currently selected location id (locations table). */
  value: string | null;
  onChange: (loc: Location | null) => void;
}) {
  const locations = useLocations();
  const selected = locations?.find((l) => l.id === value) ?? null;

  const counties = useMemo(
    () => [...new Set((locations ?? []).map((l) => l.city))].sort(),
    [locations]
  );

  const [county, setCounty] = useState(selected?.city ?? "");
  const [area, setArea] = useState(selected?.area ?? "");

  // Seed the drafts from the external value, including when the locations
  // catalog arrives late and reveals a stored selection. Render-time
  // adjustment (the ProductCard optimistic-reset pattern) instead of an
  // effect — the key only changes on external input, so it never fights
  // the user's in-progress selections.
  const [seedKey, setSeedKey] = useState("");
  const seed = `${value ?? ""}:${locations ? "loaded" : "loading"}`;
  if (seed !== seedKey) {
    setSeedKey(seed);
    if (value || locations) {
      setCounty(selected?.city ?? "");
      setArea(selected?.area ?? "");
    }
  }

  const areas = useMemo(
    () => [...new Set((locations ?? []).filter((l) => l.city === county).map((l) => l.area))].sort(),
    [locations, county]
  );

  const handleCounty = (c: string) => {
    setCounty(c);
    setArea("");
    onChange(null);
  };
  const handleArea = (a: string) => {
    setArea(a);
    // Report the first catalog row of the area — it carries the right
    // county + area and a stable id, which is all the rest of the app needs.
    const first = (locations ?? []).find((l) => l.city === county && l.area === a) ?? null;
    onChange(first);
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <select value={county} onChange={(e) => handleCounty(e.target.value)} aria-label="County" className={selectCls}>
        <option value="">County</option>
        {counties.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        value={area}
        onChange={(e) => handleArea(e.target.value)}
        disabled={!county}
        aria-label="Area"
        className={selectCls}
      >
        <option value="">Area</option>
        {areas.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </div>
  );
}
