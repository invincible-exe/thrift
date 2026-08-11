/**
 * Diagnose why "Add a piece" fails. Read-only-ish: it never inserts rows.
 *
 * - RPC probe: calls create_listing with p_price_kes = "not-a-number". If the
 *   function is missing, PostgREST returns "Could not find the function". If
 *   it exists, PostgREST rejects the integer cast before the function body
 *   runs (never inserts), which still proves the function is present in the
 *   schema cache. Either way the probe cannot insert a row.
 * - Column probes: .select() on the newer columns; a missing column makes
 *   PostgREST error with the column name, which tells us what schema the
 *   live DB is missing.
 *
 * Run: npx tsx scripts/diagnose-listing.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const line = (label: string, ok: boolean, detail: string) =>
  console.log(`${ok ? "✅" : "❌"} ${label}: ${detail}`);

async function probeColumn(table: string, column: string) {
  const { error } = await sb.from(table).select(column).limit(0);
  if (!error) line(`${table}.${column}`, true, "present");
  else line(`${table}.${column}`, false, String(error.message).split("\n")[0]);
}

async function main() {
  console.log("--- RPC probe (create_listing) ---");
  const rpc = await sb.rpc("create_listing", {
    p_title: "diag",
    p_brand: "diag",
    p_category: "Tops",
    p_size: "M",
    p_condition: "Good",
    p_price_kes: "not-a-number", // PostgREST rejects the cast — never inserts
    p_image_url: "diag",
    p_image_urls: ["diag"],
    p_description: null,
    p_era: null,
  });
  if (!rpc.error) {
    line("create_listing RPC", true, `unexpectedly succeeded, id=${rpc.data}`);
  } else {
    const msg = String(rpc.error.message);
    // Success = the function exists in the schema cache. A malformed arg is
    // rejected before the body runs, and under the service-role key the auth
    // gate would raise 'AUTH_REQUIRED' — both are errors, but neither is
    // "function missing", so anything that isn't "Could not find the
    // function" counts as present.
    line("create_listing RPC", !msg.includes("Could not find the function"), msg.split("\n")[0]);
  }

  console.log("\n--- Column probes ---");
  await probeColumn("products", "image_urls");
  await probeColumn("products", "status");
  await probeColumn("products", "source");
  await probeColumn("products", "seller_id");
  await probeColumn("orders", "provider_ref");
  await probeColumn("orders", "checkout_request_id");
  await probeColumn("payouts", "provider_ref");
  await probeColumn("payouts", "failure_reason");
  await probeColumn("payouts", "paid_at");
  await probeColumn("profiles", "phone");
  await probeColumn("listings", "image_urls");
  await probeColumn("listings", "order_id");

  console.log("\n--- Storage bucket probe ---");
  const bucket = await sb.storage.getBucket("product-images");
  line("product-images bucket", !bucket.error, bucket.error ? String(bucket.error.message) : "exists");

  process.exit(0);
}

main().catch((e) => {
  console.error("Diagnostic crashed:", e);
  process.exit(1);
});
