import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { sendListingDecisionEmail } from "@/lib/email";
import { rateLimit, WINDOWS } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/notifications/email
 * Body: { sellerId, status: "approved" | "rejected", itemTitle }
 *
 * Emails a seller when the owner approves or rejects their listing.
 *
 * Primary caller is the DATABASE, not the browser: the admin SQL functions
 * (`admin_set_product_status` / `admin_delete_product`) fire an async
 * pg_net webhook to this route with an `x-webhook-secret` header, so the
 * email always sends even if the admin's browser closes mid-action.
 * A signed-in admin session is still accepted as a fallback (e.g. testing).
 *
 * Security:
 *  - Two accepted identities: a valid `x-webhook-secret` header matching
 *    `EMAIL_WEBHOOK_SECRET` (DB-triggered), or a signed-in admin session
 *    (server-side profiles.role check, same as the payout routes).
 *  - The recipient email is looked up from `profiles` — never trusted from
 *    the request body.
 *  - No-op (200, skipped) when Resend isn't configured or the seller has no
 *    email, so moderation never fails because of email.
 */
export async function POST(req: Request) {
  const webhookSecret = process.env.EMAIL_WEBHOOK_SECRET ?? "";
  const headerSecret = req.headers.get("x-webhook-secret") ?? "";
  // Constant-time comparison so a timing attack can't leak the webhook
  // secret (the only credential guarding a cost-bearing email endpoint).
  // Compare BYTE lengths (not string lengths) — timingSafeEqual throws if
  // the buffers differ in byte length, and UTF-8 string length != byte
  // length for non-ASCII secrets.
  const expectedBuf = Buffer.from(webhookSecret);
  const receivedBuf = Buffer.from(headerSecret);
  const isWebhook =
    expectedBuf.length > 0 &&
    expectedBuf.length === receivedBuf.length &&
    timingSafeEqual(expectedBuf, receivedBuf);

  let callerId: string | null = null;

  if (isWebhook) {
    callerId = "webhook";
  } else {
    // Fallback: signed-in admin session.
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

    if (!isAdminConfigured) {
      return NextResponse.json({ error: "ADMIN_NOT_CONFIGURED" }, { status: 501 });
    }

    const admin = getAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    }
    callerId = user.id;
  }

  // Cap sends so a compromised admin session or leaked webhook secret can't
  // burn through the Resend quota. Webhook traffic is naturally low (one per
  // moderation action), so a per-window cap on the shared key is enough.
  const rl = rateLimit(
    isWebhook ? "email-webhook" : `email-notify:${callerId}`,
    isWebhook ? 200 : 60,
    WINDOWS.hour
  );
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: "Too many notification emails. Try again in a little while.",
        retryAfterSec: Math.ceil((rl.resetAt - Date.now()) / 1000),
      },
      { status: 429 }
    );
  }

  let body: {
    sellerId?: string | null;
    status?: string;
    itemTitle?: string;
    note?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const { sellerId, status, itemTitle, note } = body;
  if ((status !== "approved" && status !== "rejected") || !itemTitle || !sellerId) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  // Admin explanation for a rejection — capped for safety (the DB trusts
  // the note from an admin session, but the webhook path is public).
  const cleanNote = typeof note === "string" ? note.trim().slice(0, 500) : "";

  if (!isAdminConfigured) {
    return NextResponse.json({ error: "ADMIN_NOT_CONFIGURED" }, { status: 501 });
  }
  const admin = getAdminClient();

  // Recipient email comes from the database, never from the request body.
  const { data: seller } = await admin
    .from("profiles")
    .select("email")
    .eq("id", sellerId)
    .maybeSingle();
  const to = seller?.email ?? "";

  const result = await sendListingDecisionEmail({
    to,
    itemTitle,
    status,
    note: cleanNote || undefined,
  });

  if (!result.ok) {
    // Expected no-ops (no key / no email) — nothing to alert about.
    if (result.skipped === "error") {
      console.error("Listing decision email failed:", result.error, { status });
      return NextResponse.json({ error: "EMAIL_FAILED" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, skipped: result.skipped });
  }

  return NextResponse.json({ ok: true });
}
