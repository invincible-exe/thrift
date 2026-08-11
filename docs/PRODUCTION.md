# Production launch checklist

Everything needed to take the app from the current sandbox/ngrok setup to a
real, publicly reachable deployment. Work through the sections top to bottom;
**Section 8 (verification)** is the smoke test you run last.

Current dev setup to replace: app on `next dev` (port 3001), exposed via an
ngrok tunnel, Supabase project `squhnrehnoxukhwzzidu`, M-Pesa on **sandbox**,
email links baked to the ngrok URL via `NEXT_PUBLIC_SITE_URL`.

---

## 1 · Domain & DNS

1. Buy/point a domain (e.g. `10of10thrifts.com`) at your DNS provider.
2. Create a record for the hosting platform:
   - **Vercel:** add the domain in Vercel → project → Settings → Domains. Vercel
     gives you an `A`/`CNAME` record to add at your registrar (and handles
     HTTPS automatically).
3. Keep the ngrok tunnel around for development only. The production domain is
   what everything below points at.

## 2 · Hosting (Vercel recommended)

1. Push the repo to GitHub/GitLab and **Import** it in Vercel.
   - Framework preset: **Next.js** (auto-detected).
   - Build command `next build`, output `standalone` not required.
2. The 3D models in `public/models/` deploy as static assets — comfortably
   within platform limits, served from the CDN edge.
3. **`next.config.ts` `allowedDevOrigins` is dev-only** — it only affects
   `next dev`, so it can stay in the repo; it has no effect in production.
4. **Env vars:** add every var from `Section 5` under Project → Settings →
   Environment Variables, for **Production** (and Preview if you want
   previews to work end-to-end).
5. After first deploy, confirm HTTPS works on your domain.

> **Payments need HTTPS + the Paystack webhook configured** — set the
> webhook URL to `https://your-domain.com/api/payments/paystack-webhook` in
> the Paystack dashboard and give it a moment to take effect before testing.

## 3 · Supabase configuration

Dashboard → **Authentication → URL Configuration**:

| Setting | Value |
| ------- | ----- |
| Site URL | `https://your-domain.com` |
| Redirect URLs | add `https://your-domain.com/**` (keep the localhost/LAN/ngrok entries for dev) |

Also review, once:

- **Providers → Email:** decide whether to keep email confirmation on.
  On = safer; the app's "Resend confirmation link" flow (AuthModal) makes it
  painless. Off = instant login, less safe.
- **RLS:** leave enabled. Purchases, order finalization and payouts are all
  service-role-only server RPCs; the browser can never mark an order paid
  (see `docs/PAYMENTS.md`).
- **Storage:** the photo upload buckets must allow `authenticated` writes but
  only `public` reads for product images (already configured).

## 4 · Paystack go-live (currently sandbox / simulated)

1. Create a **Paystack** account and activate the **Kenya** mode (CBK-licensed
   locally). Paystack handles M-Pesa STK pushes, cards, and payouts to
   M-Pesa wallets or Kenyan bank accounts — no direct Safaricom Daraja
   application, passkeys, or B2C certificates needed.
2. In the Paystack dashboard, add your production domain to the
   **callback URL / webhook allowlist**:
   - Webhook URL → `https://your-domain.com/api/payments/paystack-webhook`
   - Card callback → `https://your-domain.com/api/payments/card/callback`
     (this must also match the `PAYSTACK_CARD_CALLBACK_URL` env var)
3. Set in the hosting env (NOT just `.env.local`):
   - `PAYSTACK_SECRET_KEY=<production secret key>`
   - `PAYSTACK_CARD_CALLBACK_URL=https://your-domain.com/api/payments/card/callback`
4. Paystack Transfers (seller payouts) require a **Registered Business**
   with verified details; the Starter tier caps collected volume
   (currently KES 600k) — upgrade before volume grows.
5. Do a real KSh-1 test purchase (M-Pesa) and a card payment, then a real
   KSh-1 payout to a seller's M-Pesa and bank account (see `Section 8`).

> **Sandbox vs production are separate keys.** Test mode uses `sk_test_…`,
> production `sk_live_…` — never mix them. Keep `ALLOW_SIMULATED_MPESA=true`
> only for local dev without keys.

## 5 · Environment variables

| Var | Public? | Value (production) |
| --- | ------- | ------------------ |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | `https://squhnrehnoxukhwzzidu.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | anon key (safe to ship in the bundle) |
| `NEXT_PUBLIC_ADMIN_UID` | yes | your user UUID (gates the admin UI) |
| `NEXT_PUBLIC_SITE_URL` | yes | `https://your-domain.com` — **used to bake email confirmation links**; must be reachable from any device |
| `SUPABASE_SERVICE_ROLE_KEY` | **no** | service-role key (server-only, never in client code) |
| `SUPABASE_JWT_SECRET` | **no** | for auth token verification |
| `EMAIL_FROM` | no | verified sender (Resend) |
| `PAYSTACK_SECRET_KEY` | no | production secret key (`sk_live_…`) |
| `PAYSTACK_CARD_CALLBACK_URL` | no | `https://your-domain.com/api/payments/card/callback` |
| `ALLOW_SIMULATED_MPESA` | no | **never** set in production (test-only) |

## 6 · Email (Resend)

1. Verify your sending domain in the Resend dashboard (adds SPF/DKIM records).
2. Set `EMAIL_FROM` to a sender on that domain (e.g. `hello@your-domain.com`).
3. Confirmation emails use `NEXT_PUBLIC_SITE_URL` for their links — with the
   production URL set, links open correctly on any device (this was the
   "localhost on the phone" bug, fixed by design now).

## 7 · Ops notes (read once)

- **Rate limiting is in-memory.** On Vercel (many lambdas) it's a per-instance
  soft limit — still stops a single client hammering, but not a distributed
  burst. For hard limits, swap `src/lib/rate-limit.ts` for a shared store
  (Upstash/Redis) or the platform's rate limiter.
- **The service-role key is the crown jewels.** It's only referenced from
  server modules (`src/lib/supabase/admin.ts`) and API routes. Never move it
  into a `"use client"` file or a `NEXT_PUBLIC_*` var.
- **Model pipeline:** `scripts/compress-model.ts` rebuilds
  `public/models/modelToUse.glb` (~7MB, position-welded to ~500K verts +
  meshopt) and `modelToUse-mobile.glb` (3.6MB, decimated for phones);
  `MascotModel.tsx` serves the mobile variant to phones/tablets/low-RAM/
  slow connections and honors `?model=mobile|full` for testing. Verify with
  `npx tsx scripts/verify-model.ts <file>`; winding sanity with
  `npx tsx scripts/check-winding.ts <file>`. The original 103MB file is
  backed up at `/tmp/modelToUse.original.glb` on the dev machine.
- **Repo size:** the 103MB original is still in git history (it was tracked
  before compression). If repo size ever matters, rewrite history with
  `git filter-repo`/BFG or move the models to Git LFS — optional, not
  required for launch.

## 8 · Post-deploy verification (run all)

1. `https://your-domain.com` loads, hero renders, no console errors.
2. Phone (real device, mobile data): hero loads the **2.2MB** variant (DevTools
   → Network; or append `?model=mobile` / `?model=full` to compare). Confirm
   it renders within a few seconds on 4G.
3. Desktop on a fast connection: hero loads the **31.6MB** variant and is
   smooth when dragging.
4. Sign in with email+password → confirmation link in the inbox points at
   `https://your-domain.com/...` and opens on the phone.
5. Google sign-in lands back on the app (redirect allowlist).
6. **Checkout:** pay with M-Pesa (STK prompt) and with a card (Paystack
   checkout) → order completes, the listing disappears. Check the webhook
   arrived (server logs).
7. **Payout:** as admin, settle a seller payout to their M-Pesa number and
   one to a bank account (entering the OTP if Paystack requires it) →
   money arrives → payout flips to `paid` in `/admin`.
8. Admin dashboard loads; photo upload works (storage bucket rules).
9. Grafana/dev-only ports are irrelevant in production — nothing listens on
   3000/3001 there.
