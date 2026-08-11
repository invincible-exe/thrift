import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when the user has pasted their Supabase keys — otherwise Supabase features are off. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

let browserClient: SupabaseClient<Database> | null = null;

/**
 * Singleton browser client. Client-side only — call it from hooks and event
 * handlers, never during server rendering.
 */
export function getBrowserClient(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null;
  if (!browserClient) browserClient = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
  return browserClient;
}

/**
 * Whether an OAuth provider is switched on in Supabase, from the public
 * auth settings endpoint. Returns null when it can't be determined — the
 * caller should proceed optimistically rather than block sign-in.
 */
export async function checkOAuthProviderEnabled(provider: string): Promise<boolean | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabaseAnonKey },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { external?: Record<string, boolean> };
    // Unknown shape → null (fail-open) rather than blocking sign-in.
    const external = json.external;
    if (!external) return null;
    return external[provider] === true;
  } catch {
    return null;
  }
}
