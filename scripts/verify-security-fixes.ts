/**
 * Verify the security fixes from migrations 0019 + 0020 are LIVE in the
 * database. Run after applying the migrations:
 *
 *   npx tsx scripts/verify-security-fixes.ts
 *
 * Proves, end-to-end (creates temp rows, cleans everything up):
 *  1. rate_limit_hit — distributed limiter: counts to the limit, rejects
 *     beyond it, and resets after the window expires.
 *  2. Admin escalation closed — an authenticated user CANNOT insert their
 *     own profile with role='admin' (previously full admin takeover), while
 *     a normal role='user' insert still works.
 *  3. No double-payout — two CONCURRENT finalize_order_by_reference calls
 *     for the same reference produce exactly ONE payout row.
 *  4. mark_order_failed no longer stamps completed_at on failed orders.
 *  5. Backfill applied — no existing failed orders carry completed_at.
 *  6. Self-purchase blocked — finalize_order refuses an order whose buyer
 *     is the product's seller (CANNOT_BUY_OWN, no payout routed).
 *  7. Admin-delete cleanup — no pending orders point at deleted products.
 *
 * Also checks the rate_limits table is invisible to the anon (browser) key.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!url || !serviceKey || !anonKey) {
  console.error("Missing Supabase keys in .env.local (URL / SERVICE_ROLE / ANON)");
  process.exit(1);
}

const sb: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: false } });

const RUN = `verify-${Date.now().toString(36)}`;
let pass = 0;
let fail = 0;
const ok = (label: string, detail = "") => {
  pass += 1;
  console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
};
const bad = (label: string, detail = "") => {
  fail += 1;
  console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  const created: { kind: string; id: string }[] = [];
  const track = (kind: string, id: string) => created.push({ kind, id });
  const cleanup = async () => {
    // Reverse order: payouts → orders → products → profile → auth user.
    for (const c of [...created].reverse()) {
      try {
        if (c.kind === "payout") await sb.from("payouts").delete().eq("id", c.id);
        if (c.kind === "order") await sb.from("orders").delete().eq("id", c.id);
        if (c.kind === "product") await sb.from("products").delete().eq("id", c.id);
        if (c.kind === "profile") await sb.from("profiles").delete().eq("id", c.id);
        if (c.kind === "user") await sb.auth.admin.deleteUser(c.id);
        if (c.kind === "rate_key") await sb.from("rate_limits").delete().eq("key", c.id);
      } catch {
        /* best-effort cleanup */
      }
    }
  };

  try {
    // ==================================================================
    // 1. Distributed rate limiter
    // ==================================================================
    console.log("\n=== 1. rate_limit_hit (distributed limiter) ===");
    const rlKey = `verify-${RUN}`;
    track("rate_key", rlKey);
    const h1 = await sb.rpc("rate_limit_hit", { p_key: rlKey, p_limit: 2, p_window_ms: 60_000 });
    const h2 = await sb.rpc("rate_limit_hit", { p_key: rlKey, p_limit: 2, p_window_ms: 60_000 });
    const h3 = await sb.rpc("rate_limit_hit", { p_key: rlKey, p_limit: 2, p_window_ms: 60_000 });
    if (h1.error || h2.error || h3.error) {
      bad("rate_limit_hit RPC exists & callable", h1.error?.message ?? h2.error?.message ?? h3.error?.message);
    } else {
      const r1 = h1.data?.[0];
      const r2 = h2.data?.[0];
      const r3 = h3.data?.[0];
      if (r1?.ok === true && r1.remaining === 1 && r2?.ok === true && r2.remaining === 0 && r3?.ok === false && r3.remaining === 0) {
        ok("limiter counts to the limit then rejects", `1:ok(1 left) 2:ok(0 left) 3:blocked`);
      } else {
        bad("limiter counting behavior", JSON.stringify([r1, r2, r3]));
      }
    }

    // Window reset.
    const rlResetKey = `verify-reset-${RUN}`;
    track("rate_key", rlResetKey);
    const w1 = await sb.rpc("rate_limit_hit", { p_key: rlResetKey, p_limit: 1, p_window_ms: 200 });
    await new Promise((r) => setTimeout(r, 500));
    const w2 = await sb.rpc("rate_limit_hit", { p_key: rlResetKey, p_limit: 1, p_window_ms: 200 });
    if (w1.data?.[0]?.ok === true && w2.data?.[0]?.ok === true) {
      ok("limiter resets after window expiry");
    } else {
      bad("limiter window reset", JSON.stringify([w1.data?.[0], w2.data?.[0]]));
    }

    // rate_limits must be invisible to the browser (anon) key.
    const anonPeek = await anon.from("rate_limits").select("key").limit(1);
    if (anonPeek.error || (anonPeek.data ?? []).length === 0) {
      ok("rate_limits table not readable by anon key", anonPeek.error ? "permission denied" : "RLS returned 0 rows");
    } else {
      bad("rate_limits table is readable by anon key!");
    }

    // ==================================================================
    // 2. Admin escalation closed (the critical fix)
    // ==================================================================
    console.log("\n=== 2. profiles admin-escalation closed ===");
    const email = `${RUN}@verify.local`;
    const password = "Verify-Pass-123!";
    const { data: newUser, error: createErr } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !newUser?.user) {
      bad("create temp auth user", createErr?.message ?? "no user returned");
      throw new Error("Cannot run remaining checks without a temp user");
    }
    const uid = newUser.user.id;
    track("user", uid);

    const authed = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: signInErr } = await authed.auth.signInWithPassword({ email, password });
    if (signInErr) {
      bad("sign in as temp user", signInErr.message);
      throw new Error("Cannot sign in as temp user");
    }

    // Track the profile for cleanup BEFORE the attempts — if the exploit
    // insert unexpectedly succeeds (regression), the row must still be
    // removed (auth-user deletion cascades to profiles regardless).
    track("profile", uid);

    // Exploit attempt #1: insert own profile with role='admin' → must be REJECTED.
    const escalate = await authed.from("profiles").insert({ id: uid, name: "Escalation probe", role: "admin" });
    if (escalate.error) {
      ok("role='admin' self-insert blocked", String(escalate.error.message).slice(0, 60));
    } else {
      bad("role='admin' self-insert was ALLOWED (critical vuln still open!)");
    }

    // Legit path: insert own profile with role='user' → must SUCCEED. On a
    // regression the exploit insert already created a row, so tolerate a
    // duplicate-key conflict here rather than reporting a misleading error.
    const legit = await authed.from("profiles").insert({ id: uid, name: "Verification user", role: "user" });
    if (legit.error && !/duplicate key/i.test(String(legit.error.message))) {
      bad("role='user' self-insert broken (regression?)", legit.error.message);
    } else {
      ok("role='user' self-insert still works", "legit onboarding path intact");
    }

    // ==================================================================
    // 3. No double-payout on concurrent finalization
    // ==================================================================
    console.log("\n=== 3. concurrent finalize → exactly one payout ===");
    const { data: product, error: pErr } = await sb
      .from("products")
      .insert({
        title: "Verification piece",
        brand: "verify",
        category: "Tops",
        size: "M",
        condition: "Very good",
        price_kes: 500,
        image_url: "",
        // 'pending' (not 'active') so the temp row never flashes on the
        // public feed during CI runs — RLS hides pending from anon, and
        // finalize_order resolves the product by id regardless of status.
        status: "pending",
        source: "platform",
        location_label: "",
      })
      .select("id")
      .single();
    if (pErr || !product) {
      bad("create temp product", pErr?.message ?? "no row");
    } else {
      track("product", product.id);
      const ref = `${RUN}-order`;
      const { data: order, error: oErr } = await sb
        .from("orders")
        .insert({
          product_id: product.id,
          buyer_id: uid,
          buyer_name: "Verify buyer",
          buyer_email: email,
          method: "mpesa",
          amount_kes: 500,
          status: "pending",
          provider_ref: ref,
          product_snapshot: {},
        })
        .select("id")
        .single();
      if (oErr || !order) {
        bad("create temp pending order", oErr?.message ?? "no row");
      } else {
        track("order", order.id);
        // Two SIMULTANEOUS webhook deliveries for the same reference.
        const [c1, c2] = await Promise.all([
          sb.rpc("finalize_order_by_reference", { p_reference: ref, p_expected_amount: 500 }),
          sb.rpc("finalize_order_by_reference", { p_reference: ref, p_expected_amount: 500 }),
        ]);
        const { data: payouts } = await sb.from("payouts").select("id, role, amount_kes").eq("order_id", order.id);
        const count = (payouts ?? []).length;
        if (c1.error || c2.error) {
          bad("finalize RPC calls", c1.error?.message ?? c2.error?.message);
        } else if (count === 1) {
          ok("concurrent finalize produced exactly ONE payout", `role=${payouts?.[0]?.role} amount=${payouts?.[0]?.amount_kes}`);
          for (const p of payouts ?? []) track("payout", String(p.id));
        } else {
          bad(`concurrent finalize produced ${count} payouts (double-pay race!)`, JSON.stringify(payouts));
          for (const p of payouts ?? []) track("payout", String(p.id));
        }
      }
    }

    // ==================================================================
    // 4. mark_order_failed leaves completed_at null
    // ==================================================================
    console.log("\n=== 4. failed orders have no completed_at ===");
    const failRef = `${RUN}-fail`;
    const { data: fOrder, error: fErr } = await sb
      .from("orders")
      .insert({
        buyer_id: uid,
        buyer_name: "Verify buyer",
        buyer_email: email,
        method: "mpesa",
        amount_kes: 100,
        status: "pending",
        provider_ref: failRef,
        product_snapshot: {},
      })
      .select("id")
      .single();
    if (fErr || !fOrder) {
      bad("create temp order for fail-test", fErr?.message ?? "no row");
    } else {
      track("order", fOrder.id);
      await sb.rpc("mark_order_failed_by_reference", { p_reference: failRef, p_reason: "verify" });
      const { data: failed } = await sb.from("orders").select("status, completed_at").eq("id", fOrder.id).single();
      if (failed?.status === "failed" && failed.completed_at === null) {
        ok("mark_order_failed leaves completed_at null", `status=${failed.status}`);
      } else {
        bad("mark_order_failed timestamp behavior", JSON.stringify(failed));
      }
    }

    // ==================================================================
    // 5. Backfill: no historical failed orders with completed_at
    // ==================================================================
    const { data: stragglers } = await sb
      .from("orders")
      .select("id")
      .eq("status", "failed")
      .not("completed_at", "is", null)
      .limit(5);
    if (!stragglers || stragglers.length === 0) {
      ok("no failed orders carry completed_at (backfill applied)");
    } else {
      bad("failed orders still carry completed_at", `${stragglers.length} row(s)`);
    }

    // ==================================================================
    // 6. Self-purchase blocked (migration 0021)
    // ==================================================================
    console.log("\n=== 6. sellers can't buy their own pieces ===");
    const ownRef = `${RUN}-own`;
    const { data: ownProduct, error: ownPErr } = await sb
      .from("products")
      .insert({
        title: "Self-purchase probe",
        brand: "verify",
        category: "Tops",
        size: "M",
        condition: "Very good",
        price_kes: 400,
        image_url: "",
        status: "pending",
        source: "community",
        seller_id: uid,
        location_label: "",
      })
      .select("id")
      .single();
    if (ownPErr || !ownProduct) {
      bad("create temp product with seller", ownPErr?.message ?? "no row");
    } else {
      track("product", ownProduct.id);
      const { data: ownOrder, error: ownOErr } = await sb
        .from("orders")
        .insert({
          product_id: ownProduct.id,
          buyer_id: uid, // the SELLER buying their own piece
          buyer_name: "Verify seller-buyer",
          buyer_email: email,
          method: "mpesa",
          amount_kes: 400,
          status: "pending",
          provider_ref: ownRef,
          product_snapshot: {},
        })
        .select("id")
        .single();
      if (ownOErr || !ownOrder) {
        bad("create temp order (buyer = seller)", ownOErr?.message ?? "no row");
      } else {
        track("order", ownOrder.id);
        // Webhook-path finalization must refuse a buyer==seller order.
        const own = await sb.rpc("finalize_order_by_reference", {
          p_reference: ownRef,
          p_expected_amount: 400,
        });
        const refused = own.error && /CANNOT_BUY_OWN/i.test(String(own.error.message));
        const { data: after } = await sb
          .from("orders")
          .select("status")
          .eq("id", ownOrder.id)
          .single();
        const { data: ownPayouts } = await sb
          .from("payouts")
          .select("id")
          .eq("order_id", ownOrder.id);
        if (refused && after?.status === "pending" && (ownPayouts ?? []).length === 0) {
          ok("self-purchase order refused by finalize_order", "CANNOT_BUY_OWN, no payout routed");
        } else {
          bad("self-purchase finalization", JSON.stringify({ refused, status: after?.status, payouts: ownPayouts }));
        }
      }
    }

    // ==================================================================
    // 7. Backfill: no orphaned pending orders (admin-delete cleanup)
    // ==================================================================
    console.log("\n=== 7. no orphaned pending orders (admin-delete cleanup) ===");
    const { data: orphans } = await sb
      .from("orders")
      .select("id")
      .eq("status", "pending")
      .is("product_id", null)
      .limit(5);
    if (!orphans || orphans.length === 0) {
      ok("no pending orders with a deleted product (backfill applied)");
    } else {
      bad("pending orders still reference deleted products", `${orphans.length} row(s) — run migration 0021`);
    }

    // ==================================================================
    // Info: current admin profiles (confirm these are all legit)
    // ==================================================================
    const { data: admins } = await sb.from("profiles").select("name, email").eq("role", "admin");
    console.log(`\nℹ️  ${(admins ?? []).length} profile(s) currently have role='admin':`);
    for (const a of admins ?? []) console.log(`   · ${String(a.email ?? a.name ?? "?")}`);

    console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  } catch (err) {
    console.error("\n⚠️  Verification crashed:", err instanceof Error ? err.message : err);
    console.error("   (If this is a network error, the sandbox may be offline — run this on a machine with Supabase access.)");
    process.exitCode = 1;
  } finally {
    await cleanup();
    console.log("🧹 Temp rows cleaned up.");
  }
  process.exit(fail > 0 ? 1 : 0);
}

main();
