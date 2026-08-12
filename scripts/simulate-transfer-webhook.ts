/**
 * Simulate Paystack transfer webhooks against a running local app, proving
 * the amount-verification added in the money-flow audit behaves correctly.
 *
 * Requires a running production server with Supabase keys +
 * PAYSTACK_SECRET_KEY loaded (dotenv reads .env.local):
 *
 *   npm run build && npm start &   # on :3100, or set PORT
 *   npx tsx scripts/simulate-transfer-webhook.ts http://localhost:3100
 *
 * Sends REAL HMAC-SHA512 signatures (computed with your PAYSTACK_SECRET_KEY),
 * so the webhook handler treats them exactly like a genuine Paystack
 * delivery. Paystack reports transfer amounts in subunits (×100 for KES) —
 * that is the documented unit the handler divides by 100.
 *
 * Cases:
 *  A. transfer.success with the correct amount        → payout flips to paid
 *  B. transfer.success with a WRONG amount            → payout stays processing
 *  C. valid payload but forged signature              → 401, nothing changes
 *  D. transfer.success with the amount field missing  → fail-safe, stays processing
 *  E. transfer.failed                                 → payout flips to failed
 *
 * Temp payout rows are created and removed.
 */
import { createHmac } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const baseUrl = process.argv[2] ?? "http://localhost:3100";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const secret = process.env.PAYSTACK_SECRET_KEY ?? "";

if (!url || !serviceKey || !secret) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / PAYSTACK_SECRET_KEY");
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
const RUN = `vrfy-${Date.now().toString(36)}`;
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

const payoutIds: string[] = [];
const track = (id: string) => payoutIds.push(id);

function sign(rawBody: string): string {
  return createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
}

async function deliver(rawBody: string, signature: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${baseUrl}/api/payments/paystack-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-paystack-signature": signature,
    },
    body: rawBody,
  });
  return { status: res.status, body: await res.text() };
}

async function makePayout(role = "seller"): Promise<string> {
  const ref = `${RUN}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await sb
    .from("payouts")
    .insert({
      to: "platform:verify",
      role,
      amount_kes: 500,
      status: "processing",
      provider_ref: ref,
    })
    .select("id, provider_ref")
    .single();
  if (error || !data) throw new Error(`create payout: ${error?.message ?? "no row"}`);
  track(String(data.id));
  return String(data.provider_ref);
}

async function payoutState(providerRef: string): Promise<string> {
  const { data } = await sb.from("payouts").select("status").eq("provider_ref", providerRef).single();
  return String(data?.status ?? "?");
}

async function main() {
  try {
    console.log(`Target: ${baseUrl}/api/payments/paystack-webhook\n`);

    // ---- A. correct amount → paid --------------------------------------
    const refA = await makePayout();
    const bodyA = JSON.stringify({
      event: "transfer.success",
      data: { transfer_code: refA, amount: 50000, currency: "KES", status: "success" },
    });
    const resA = await deliver(bodyA, sign(bodyA));
    const stateA = await payoutState(refA);
    if (resA.status === 200 && stateA === "paid") {
      ok("A. correct amount (50000 subunit = KES 500) → payout paid", `HTTP ${resA.status}, status=${stateA}`);
    } else {
      bad("A. correct amount should mark paid", `HTTP ${resA.status}, status=${stateA}`);
    }

    // ---- B. wrong amount → NOT paid -------------------------------------
    const refB = await makePayout();
    const bodyB = JSON.stringify({
      event: "transfer.success",
      data: { transfer_code: refB, amount: 50100, currency: "KES", status: "success" },
    });
    const resB = await deliver(bodyB, sign(bodyB));
    const stateB = await payoutState(refB);
    if (resB.status === 200 && stateB === "processing") {
      ok("B. wrong amount (50100 subunit = KES 501 ≠ 500) → NOT paid", `HTTP ${resB.status}, status=${stateB}`);
    } else {
      bad("B. wrong amount must not mark paid", `HTTP ${resB.status}, status=${stateB}`);
    }

    // ---- C. forged signature → 401 --------------------------------------
    const bodyC = JSON.stringify({
      event: "transfer.success",
      data: { transfer_code: refA, amount: 50000, currency: "KES", status: "success" },
    });
    const resC = await deliver(bodyC, "deadbeef".repeat(8));
    const stateC = await payoutState(refA);
    if (resC.status === 401 && stateC === "paid") {
      ok("C. forged signature → 401, nothing changed", `HTTP ${resC.status}`);
    } else {
      bad("C. forged signature must 401", `HTTP ${resC.status}, status=${stateC}`);
    }

    // ---- D. missing amount → fail-safe, NOT paid -------------------------
    const refD = await makePayout();
    const bodyD = JSON.stringify({
      event: "transfer.success",
      data: { transfer_code: refD, currency: "KES", status: "success" },
    });
    const resD = await deliver(bodyD, sign(bodyD));
    const stateD = await payoutState(refD);
    if (resD.status === 200 && stateD === "processing") {
      ok("D. missing amount field → fail-safe, stays processing", `HTTP ${resD.status}, status=${stateD}`);
    } else {
      bad("D. missing amount must fail closed", `HTTP ${resD.status}, status=${stateD}`);
    }

    // ---- E. transfer.failed → failed (no amount gate) --------------------
    const refE = await makePayout();
    const bodyE = JSON.stringify({
      event: "transfer.failed",
      data: { transfer_code: refE, amount: 50000, currency: "KES", status: "failed", gateway_response: "simulated" },
    });
    const resE = await deliver(bodyE, sign(bodyE));
    const stateE = await payoutState(refE);
    if (resE.status === 200 && stateE === "failed") {
      ok("E. transfer.failed → payout failed", `HTTP ${resE.status}, status=${stateE}`);
    } else {
      bad("E. transfer.failed should mark failed", `HTTP ${resE.status}, status=${stateE}`);
    }

    console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  } catch (err) {
    console.error("\n⚠️  Simulation crashed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    for (const id of payoutIds) {
      try {
        await sb.from("payouts").delete().eq("id", id);
      } catch {
        /* best-effort */
      }
    }
    console.log("🧹 Temp payouts cleaned up.");
  }
  process.exit(fail > 0 ? 1 : 0);
}

main();
