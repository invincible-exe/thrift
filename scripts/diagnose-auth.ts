/**
 * Diagnose "No API key found in request" at login.
 *
 * Tests the auth + REST endpoints against BOTH the current (broken, has
 * /rest/v1/ suffix) Supabase URL and the corrected base URL, using a dummy
 * sign-in that never succeeds (no side effects).
 *
 * Run: npx tsx scripts/diagnose-auth.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const currentUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
// The corrected base URL: strip any trailing /rest/v1/ path.
const fixedUrl = currentUrl.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");

async function probeAuth(label: string, url: string) {
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  // Dummy credentials — wrong on purpose, proves the endpoint is reachable.
  const { error } = await sb.auth.signInWithPassword({
    email: "diag@example.com",
    password: "wrong-password",
  });
  const msg = error?.message ?? String(error);
  const status = error?.status ?? "n/a";
  console.log(`${label}: status=${status} message="${msg}"`);
}

async function probeRest(label: string, url: string) {
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await sb.from("products").select("id").limit(0);
  console.log(`${label}: rest=${error ? `ERR ${error.message}` : "ok"}`);
}

async function main() {
  console.log(`current url: ${currentUrl}`);
  console.log(`fixed   url: ${fixedUrl}`);
  console.log("--- auth probe (expected: current=fails w/ No API key, fixed=Invalid login credentials) ---");
  await probeAuth("current", currentUrl);
  await probeAuth("fixed  ", fixedUrl);
  console.log("--- rest probe (make sure fixing the URL doesn't break REST) ---");
  await probeRest("current", currentUrl);
  await probeRest("fixed  ", fixedUrl);
  process.exit(0);
}

main().catch((e) => {
  console.error("Diagnostic crashed:", e);
  process.exit(1);
});
