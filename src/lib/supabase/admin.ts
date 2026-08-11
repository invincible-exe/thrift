import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** True when the service-role key is set (webhooks / seeding ready). */
export const isAdminConfigured = Boolean(supabaseUrl && serviceRoleKey);

let adminClient: SupabaseClient<Database> | null = null;

/**
 * Server-only service-role client — bypasses RLS. Never import this into a
 * client component; it's for the M-Pesa callback webhook and seed script.
 */
export function getAdminClient(): SupabaseClient<Database> {
  if (!isAdminConfigured) {
    throw new Error(
      "SUPABASE_ADMIN_NOT_CONFIGURED. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
  }
  if (!adminClient) {
    adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}
