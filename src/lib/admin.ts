import { useEffect, useState } from "react";
import { getBrowserClient, isSupabaseConfigured } from "./supabase/client";

/** Optional: set NEXT_PUBLIC_ADMIN_UID to grant dashboard access without a role field. */
const ADMIN_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? "";

export function useIsAdmin(uid: string | null): { isAdmin: boolean; checking: boolean } {
  const envAdmin = Boolean(ADMIN_UID && uid && ADMIN_UID === uid);
  const canCheck = Boolean(uid && !envAdmin && isSupabaseConfigured);

  const [role, setRole] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [prevUid, setPrevUid] = useState<string | null>(null);

  // Reset state when the signed-in user changes (render-time adjustment).
  if (prevUid !== uid) {
    setPrevUid(uid);
    setRole(null);
    setLoaded(false);
  }

  useEffect(() => {
    if (!canCheck) return;
    const client = getBrowserClient();
    if (!client) return;
    let active = true;
    void (async () => {
      try {
        const { data } = await client
          .from("profiles")
          .select("role")
          .eq("id", uid as string)
          .maybeSingle();
        if (!active) return;
        setRole((data as { role?: string } | null)?.role ?? null);
      } catch {
        // Rules or network hiccup — treat as non-admin.
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [canCheck, uid]);

  const checking = canCheck && !loaded;
  return { isAdmin: envAdmin || role === "admin", checking };
}
