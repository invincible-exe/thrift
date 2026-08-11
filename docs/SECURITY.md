# Security Posture — CIA Triad & Zero Trust

How this app's security controls map to the **CIA triad** (Confidentiality,
Integrity, Availability) and the **zero-trust model** (never trust, always
verify; least privilege; assume breach). Use this as the review checklist —
each control lists where it lives in the codebase.

---

## 1. Confidentiality (only the right people see the data)

| Control | Where |
|---|---|
| Row Level Security on every table (profiles, products, orders, payouts, listings, wishlists, notifications, ratings, payout_reports, app_settings) | `supabase/migrations/0001_init.sql` + 0002/0003/0004 |
| Owner-only read policies — users see only their own orders/payouts/listings/wishlists/notifications; admins see all (`public.is_admin()`) | RLS `using` clauses, same files |
| `app_settings` (webhook secret) locked with RLS **and no policies** — only SECURITY DEFINER functions can read it | `0001_init.sql` |
| Service-role key never bundled client-side — `getAdminClient()` lives in server-only modules imported only by API routes / server libs | `src/lib/supabase/admin.ts`; verified via search (no client-component imports) |
| Server components/routes bind the session cookie, never a client-supplied identity | `src/lib/supabase/server.ts`, every route calls `supabase.auth.getUser()` |
| Only minimal product fields exposed; price is set server-side from the DB | `src/app/api/payments/initiate/route.ts` |
| Response headers: HSTS, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geo/payment blocked), `X-Frame-Options: DENY` + `frame-ancestors 'none'` (anti-clickjacking) | `next.config.ts` `headers()` |
| Session JWT verification (aud = `authenticated` only, HS256, `SUPABASE_JWT_SECRET`) for webhook Bearer defense | `src/lib/auth-verify.ts` |

## 2. Integrity (data can't be tampered with unnoticed)

| Control | Where |
|---|---|
| Price/amount never trusted from the client — read from the `products` row server-side | `src/app/api/payments/initiate/route.ts` |
| Paystack webhook: unauthenticated endpoint **fail-closed** — HMAC-SHA512 signature over the raw body verified timing-safe against `PAYSTACK_SECRET_KEY`, event type allowlisted (`charge.success` / `transfer.*`), and finalization only happens after amount+reference match the pending row in SQL | `src/app/api/payments/paystack-webhook/route.ts`, `src/lib/server/paystack-callback.ts`, `src/lib/payments/paystack.ts` |
| Transfer callback marks paid **only** when `provider_ref` matches a `pending` row AND Paystack's reported amount equals the ledger amount | `src/app/api/payments/paystack-webhook/route.ts` |
| Email webhook authenticated with a **timing-safe** secret comparison (`timingSafeEqual`) | `src/app/api/notifications/email/route.ts` |
| Atomicity / no double-pay: `for update` product lock, `pending → processing` claims, status-constrained updates | `purchase_product`, `sendPayout` (`src/lib/server/payouts.ts`) |
| Ledger rows are append-only via SECURITY DEFINER RPCs — clients have **no** insert/update on orders/payouts | `revoke all … grant execute …` blocks in migrations |
| Role self-escalation blocked by trigger (`prevent_role_self_change`) — users can't set their own `role='admin'` | `0001_init.sql` |
| Uploads re-encoded server-side (sharp → WebP, ≤1600px) — no client-controlled bytes land in the bucket | `src/app/api/storage/upload/route.ts` |
| Storage direct-upload RLS policy removed — uploads only via the validating server route (least privilege) | `supabase/migrations/0006_security_hardening.sql` |
| Auth callback `next` param validated — no open redirect | `src/app/auth/callback/route.ts` |
| CSP baseline — blocks external script/object/frame loading and form exfiltration (`script-src` has no remote origins; `'wasm-unsafe-eval'` only relaxes WebAssembly compilation for the 3D decoders, not JS eval) | `next.config.ts` `headers()` |
| `images.remotePatterns` allowlist (Unsplash + Supabase only) — the `/ _next/image` optimizer can't be pointed at arbitrary hosts (SSRF surface) | `next.config.ts` |

## 3. Availability (the service stays up and honest under attack)

| Control | Where |
|---|---|
| Per-user rate limits on every cost-bearing endpoint (payment initiations, uploads, payouts, escrow sweep, confirm-receipt, notification emails, ratings) | `src/lib/rate-limit.ts`, applied in each route |
| Webhooks always answer 200 quickly and are idempotent — Paystack re-delivery can't corrupt state (reference-keyed finalize functions are status-constrained) | callback routes |
| Fail-closed with graceful degradation: missing email keys no-op instead of failing sales; escrow auto-releases after 24h; payouts claim rows atomically so concurrent sweeps can't double-pay | `src/lib/email.ts`, `0005_escrow.sql`, `sendPayout` |
| Stale pending orders are failed before a re-checkout, so a dropped STK push can't wedge a 1-of-1 | `src/app/api/payments/mpesa/route.ts` |
| `ErrorBoundary`, toast/skeleton states, and `once: true` scroll triggers keep UI resilient | `src/components/ui/ErrorBoundary.tsx` et al. |

---

## 4. Zero Trust — never trust, always verify

1. **Verify explicitly at every request.**
   - Every API route independently calls `supabase.auth.getUser()` on the session cookie — the client is never trusted with identity.
   - Admin actions re-verify `profiles.role = 'admin'` server-side (routes) **and** inside the SQL functions (`public.is_admin()`), so a forged client or leaked `NEXT_PUBLIC_ADMIN_UID` can't escalate.
   - Webhooks are verified against the source: Paystack HMAC signature for charges, exact amount+ref match for transfers, timing-safe shared secret for email.
2. **Use least privilege.**
   - Service-role key: server-only, never in a client bundle.
   - RPC grants: `revoke all … grant execute to authenticated/service_role` on every function; `purchase_product` and finalization functions are service-role-only.
   - `products` is read-only to clients (public reads, admin writes via RPCs); wishlists/notifications are owner-only.
   - Direct storage writes by clients removed (`0006`).
3. **Assume breach / design for damage containment.**
   - Fail-closed webhooks (a forged callback can't finalize, can't mark paid, can't overwrite paid rows).
   - Money moves in small, idempotent, atomic steps (escrow → release → claim → paid) with a full orders/payouts ledger to reconcile against.
   - Security-relevant anomalies (amount mismatches, unconfirmed callbacks, missing metadata) are logged with context.
   - Defense in depth: RLS + SECURITY DEFINER + route checks + rate limits + headers.

---

## 5. Residual risks & recommended next steps

| Gap | Why it remains | Mitigation today | Recommended |
|---|---|---|---|
| Transfer webhook depends on Paystack's HMAC signature | A leaked `PAYSTACK_SECRET_KEY` would let an attacker forge `transfer.success` | Signature checked timing-safe against the secret, and the amount + `provider_ref` must match a `pending` row; status-constrained updates prevent double-pay | Rotate the key if ever suspected; monitor transfer webhooks in the Paystack dashboard |
| Rate limiter is in-memory (`src/lib/rate-limit.ts`) | Single-instance deploys get exact limits; multi-instance serverless gets per-instance soft limits | Per-user keys kill the common single-client abuse case | For hard distributed limits, swap in a shared store (Upstash/Redis) or the platform's rate limiter |
| CSP uses `'unsafe-inline'` for scripts | Next.js App Router injects inline bootstrap scripts; a nonce/hash pipeline isn't set up | `script-src` still allows **no remote origins** — injected `<script src="https://evil">` payloads can't load; other directives (object/frame/form/base) are strict | Adopt Next.js nonce-based CSP for a strict `script-src` |
| `NEXT_PUBLIC_ADMIN_UID` is a client-visible hint | It's a UI convenience for showing the dashboard | Server routes and SQL functions always re-verify `profiles.role` | Prefer the DB role as the single source of truth; treat the env var as cosmetic |
| Demo catalog images come from Unsplash via an allowlisted domain | Seed data lives outside the repo | `remotePatterns` allows only `images.unsplash.com` + `*.supabase.co` | Move demo images into Supabase Storage for a single trusted image origin |
