/**
 * Diagnose why the admin "Pending review" queue appears empty.
 *
 * Read-only. Uses the service-role key to check, regardless of RLS:
 *  - how many products exist per status ('pending' / 'active' / 'sold')
 *  - whether any are community listings awaiting review
 *  - the profiles table (does any row have role = 'admin'? does the row for
 *    NEXT_PUBLIC_ADMIN_UID have role = 'admin'?)
 *
 * The key insight: the dashboard's products query runs through the BROWSER
 * (anon) client, whose RLS policy only returns products where
 * `status = 'active' OR is_admin()`. `is_admin()` checks the *database*
 * profiles row — so if your profile lacks role='admin', pending products are
 * invisible even though the UI shows you the dashboard via the env shortcut.
 *
 * Run: npx tsx scripts/diagnose-admin.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const adminUid = process.env.NEXT_PUBLIC_ADMIN_UID ?? "";

if (!url || !serviceKey || !anonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
// The anon client is exactly what the browser uses — proving RLS behaviour.
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const line = (label: string, ok: boolean, detail: string) =>
  console.log(`${ok ? "✅" : "❌"} ${label}: ${detail}`);

async function main() {
  // Hoisted so the RLS-proof section below can read it regardless of the
  // products query's success.
  const counts: Record<string, number> = {};
  console.log("--- products by status ---");
  const { data: products, error } = await sb.from("products").select("id,title,status,source,seller_id,seller_name,created_at").order("created_at", { ascending: false }).limit(200);
  if (error) {
    line("products", false, String(error.message));
  } else {
    for (const p of products ?? []) {
      const s = String(p.status ?? "?");
      counts[s] = (counts[s] ?? 0) + 1;
    }
    console.log(`total: ${(products ?? []).length} | ${JSON.stringify(counts)}`);
    const pending = (products ?? []).filter((p) => p.status === "pending");
    if (pending.length === 0) {
      console.log("ℹ️  No pending products at all - the queue is legitimately empty right now.");
    } else {
      pending.forEach((p) =>
        console.log(`  pending: ${String(p.title).slice(0, 40)} | source=${p.source} | seller=${p.seller_name ?? p.seller_id ?? "?"}`)
      );
    }
  }

  console.log("\n--- RLS proof: what the anon (browser) client sees ---");
  const anonPending = await anon.from("products").select("id").eq("status", "pending").limit(10);
  const anonAll = await anon.from("products").select("id,status").limit(10);
  console.log("anon sees pending:", anonPending.error ? `ERR ${anonPending.error.message}` : `${(anonPending.data ?? []).length} row(s)`);
  console.log("anon sees products (any status):", anonAll.error ? `ERR ${anonAll.error.message}` : `${(anonAll.data ?? []).length} row(s)`);
  console.log("(service role sees:", counts["pending"] ?? 0, "pending across", (products ?? []).length, "products)");

  console.log("\n--- profiles (admin status) ---");
  const { data: profiles, error: pErr } = await sb.from("profiles").select("id,name,email,role").limit(100);
  if (pErr) {
    line("profiles", false, String(pErr.message));
  } else {
    if (!profiles || profiles.length === 0) {
      console.log("ℹ️  No profiles rows yet (signing in creates one via upsert).");
    }
    for (const pr of profiles ?? []) {
      const isEnvAdmin = adminUid && String(pr.id) === adminUid;
      console.log(`  ${String(pr.name || pr.email || pr.id).slice(0, 30)} | role=${String(pr.role ?? "?")}${isEnvAdmin ? " | ← matches NEXT_PUBLIC_ADMIN_UID" : ""}`);
    }
  }

  console.log("\n--- summary ---");
  if (pErr) {
    console.log("⚠️  Could not read profiles (see error above) - cannot determine admin access.");
  } else {
    const adminRows = (profiles ?? []).filter((p) => p.role === "admin");
    if (adminRows.length === 0) {
      console.log("⚠️  No profile has role='admin'. The browser (anon) query is filtered by RLS to");
      console.log("    status='active' only, so pending products stay HIDDEN even though they exist.");
      console.log("    Fix: update profiles set role='admin' where id='<your uid>' in the SQL editor.");
    } else {
      console.log(`✅ ${adminRows.length} profile(s) have role='admin' - RLS should expose pending products.`);
    }
    if (adminUid) {
      const envAdminProfile = (profiles ?? []).find((p) => String(p.id) === adminUid);
      console.log(`NEXT_PUBLIC_ADMIN_UID set (${adminUid.slice(0, 8)}…), profile role = ${String(envAdminProfile?.role ?? "none")}`);
    } else {
      console.log("NEXT_PUBLIC_ADMIN_UID not set - admin access relies on profile role only.");
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("Diagnostic crashed:", e);
  process.exit(1);
});
