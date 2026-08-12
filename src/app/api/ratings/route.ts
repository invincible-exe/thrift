import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { rateLimit, WINDOWS } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/ratings
 * Body: { score: 1-5, orderId?: string }
 *
 * Records a buyer's post-purchase experience rating. The buyer is taken from
 * the session cookie (never from the body); RLS restricts inserts to the
 * caller's own rows, and the order id is only linked if it belongs to them.
 */
export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  // Availability + integrity cap: one buyer can't meaningfully rate more
  // than a handful of orders, so a tight per-user window stops a bot from
  // inflating (or tanking) the shop's rating stats.
  const rl = await rateLimit(`ratings:${user.id}`, 60, WINDOWS.hour);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many rating submissions. Try again shortly." },
      { status: 429 }
    );
  }

  let body: { score?: unknown; orderId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const score = Number(body.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return NextResponse.json({ error: "INVALID_SCORE" }, { status: 400 });
  }

  let orderId: string | null = null;
  if (typeof body.orderId === "string" && body.orderId) {
    // Only attach the rating to an order this user actually bought.
    const { data: order } = await supabase
      .from("orders")
      .select("id")
      .eq("id", body.orderId)
      .eq("buyer_id", user.id)
      .maybeSingle();
    if (!order) {
      return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
    }
    orderId = body.orderId;

    // One rating per order — a retried request (or double-tap) must not
    // inflate the stats. Idempotent: returning ok is fine for the caller.
    const { data: existing } = await supabase
      .from("ratings")
      .select("id")
      .eq("order_id", orderId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, alreadyRated: true });
    }
  }

  const { error } = await supabase.from("ratings").insert({
    user_id: user.id,
    order_id: orderId,
    score,
  });
  if (error) {
    console.error("Rating insert failed:", error);
    return NextResponse.json({ error: "INSERT_FAILED" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
