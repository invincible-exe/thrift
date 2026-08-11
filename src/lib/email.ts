import { Resend } from "resend";
import { APP_NAME, SUPPORT_EMAIL } from "@/lib/constants";

/**
 * Server-only email helpers (Resend). Never import this module from a client
 * component — it reads server env vars and bundles the Resend SDK.
 *
 * When `RESEND_API_KEY` is missing the helpers no-op instead of throwing, so
 * the rest of the app works fine without email configured (e.g. local dev).
 *
 * NOTE (DB-triggered): emails are fired by the admin SQL functions via a
 * pg_net webhook to /api/notifications/email, so they always send even if
 * the admin's browser closes mid-action. The in-app bell notification
 * (created inside the same SQL functions) remains the always-on channel.
 * Requires EMAIL_WEBHOOK_SECRET in the app's env matching
 * app_settings.email_webhook_secret in the DB.
 */

const API_KEY = process.env.RESEND_API_KEY ?? "";

/**
 * Verified `From` address. Defaults to Resend's testing address
 * (onboarding@resend.dev) which only delivers to your own account email —
 * set `EMAIL_FROM` (e.g. "10/10 Thrifts <hello@your-domain.com>") after
 * verifying a domain in the Resend dashboard.
 */
const FROM = process.env.EMAIL_FROM ?? "10/10 Thrifts <onboarding@resend.dev>";

/** Absolute site URL for email links (optional — links are omitted if unset). */
const APP_URL = (process.env.APP_URL ?? "").replace(/\/$/, "");

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!API_KEY) return null;
  if (!resend) resend = new Resend(API_KEY);
  return resend;
}

export interface ListingDecisionEmail {
  to: string;
  itemTitle: string;
  status: "approved" | "rejected";
  /** Admin's optional explanation, shown on a rejection. */
  note?: string;
}

export type SendEmailResult =
  | { ok: true; skipped?: never }
  | { ok: false; skipped: "no-api-key" | "no-email" }
  | { ok: false; skipped: "error"; error: string };

/**
 * Email a seller when their listing is approved for the feed or rejected.
 * No-op (skipped) when Resend isn't configured or the recipient is missing.
 */
export async function sendListingDecisionEmail(input: ListingDecisionEmail): Promise<SendEmailResult> {
  const client = getResend();
  if (!client) return { ok: false, skipped: "no-api-key" };
  if (!input.to) return { ok: false, skipped: "no-email" };

  const approved = input.status === "approved";
  const subject = approved
    ? `${APP_NAME} — "${input.itemTitle}" is live 🎉`
    : `${APP_NAME} — "${input.itemTitle}" wasn't approved`;

  // The admin's reason, shown as a callout on rejections.
  const noteBlock =
    !approved && input.note
      ? `
        <div style="background: #fef3c7; border-left: 4px solid #b45309; border-radius: 10px; padding: 12px 16px; margin: 0 0 20px;">
          <p style="font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #92400e; margin: 0 0 4px;">
            Why it wasn't accepted
          </p>
          <p style="font-size: 14px; line-height: 1.5; color: #78350f; margin: 0;">
            ${escapeHtml(input.note)}
          </p>
        </div>`
      : "";

  const accountLink = APP_URL ? `${APP_URL}/account` : null;

  const html = `
    <div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1a1712;">
      <p style="font-size: 13px; font-weight: 700; letter-spacing: 0.12em; color: #b45309; text-transform: uppercase; margin: 0 0 16px;">
        ${APP_NAME}
      </p>
      <div style="background: #f6f1e9; border: 1px solid #e5dccb; border-radius: 16px; padding: 28px;">
        <p style="font-size: 26px; font-weight: 800; margin: 0 0 8px; color: #1a1712;">
          ${approved ? "✓ Your piece is live" : "✕ Not this time"}
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #57534e; margin: 0 0 20px;">
          ${
            approved
              ? `Your listing <strong>"${escapeHtml(input.itemTitle)}"</strong> was approved and is now live on the feed, waiting for a buyer.`
              : input.note
                ? `Your listing <strong>"${escapeHtml(input.itemTitle)}"</strong> was not approved. Fix the point below and re-list it — no hard feelings.`
                : `Your listing <strong>"${escapeHtml(input.itemTitle)}"</strong> was not approved. You can re-list it with fresh photos and a clear description.`
          }
        </p>
        ${noteBlock}
        ${
          accountLink
            ? `<a href="${accountLink}" style="display: inline-block; background: #1a1712; color: #f6f1e9; text-decoration: none; font-size: 14px; font-weight: 700; padding: 12px 22px; border-radius: 999px;">
                 View my listings
               </a>`
            : ""
        }
      </div>
      <p style="font-size: 12px; color: #a8a29e; margin: 24px 0 0; line-height: 1.5;">
        You're receiving this because you listed a piece on ${APP_NAME}.
        <br />
        Questions? Email us at{" "}
        <a href="mailto:${SUPPORT_EMAIL}" style="color: #b45309; text-decoration: underline;">${SUPPORT_EMAIL}</a>
        — we reply within 24h.
      </p>
    </div>
  `;

  try {
    const { error } = await client.emails.send({
      from: FROM,
      to: [input.to],
      subject,
      html,
    });
    if (error) return { ok: false, skipped: "error", error: String(error.message ?? error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, skipped: "error", error: (err as Error)?.message ?? "Unknown error" };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
