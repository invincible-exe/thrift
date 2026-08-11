# 10/10 Thrifts 🧥

Kenya's curated thrift store. Premium 1-of-1 pieces — no doubles, ever.
Browse free; buy with M-Pesa; sell your own fits and keep 90% of the sale.

Built with **Next.js (App Router)**, **Supabase** (Postgres + Auth + Realtime),
**React Three Fiber** (3D stylist mascot) and **Tailwind CSS v4**.

## Quick start

```bash
npm install
cp .env.local.example .env.local   # then fill in your Supabase keys
npm run dev                        # → http://localhost:3000 (or :3001 if 3000 is taken)
```

Without Supabase keys the feed stays empty — auth, checkout and selling are
disabled until keys are added. The app ships with **no demo catalog**: every
piece on the feed is real data from your Supabase project.

## 1 · Connect Supabase (5 minutes)

1. Create a project at [supabase.com](https://supabase.com) → **New project**.
2. **SQL Editor** → paste the contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) →
   **Run**. This creates all tables, the RLS policies, the atomic
   purchase/finalize functions, and enables Realtime for the feed, orders and
   wishlists.
3. **Authentication → URL Configuration** — this is what makes login
   redirect back to the app. If a login lands on a *different* app (e.g.
   Grafana, which often owns port 3000), the Site URL below points at that
   app instead of yours:
   - **Site URL**: your main app URL — e.g. `http://localhost:3001`
     (NOT `:3000` if another service like Grafana runs there).
   - **Redirect URLs**: one entry **per origin** you open the app from, each
     ending in `/**`:

     ```
     http://localhost:3001/**
     http://localhost:3000/**      # only if port 3000 is actually the app
     http://192.168.x.x:3001/**    # LAN IP — testing from your phone
     https://your-subdomain.ngrok-free.dev/**   # ngrok tunnel
     https://your-domain.com/auth/callback     # production
     ```

     When a redirect URL is missing from this list, Supabase **silently
     falls back to the Site URL** — so if login "goes to Grafana" (or any
     other app), the missing entry (or a wrong Site URL) is the cause.
4. **Authentication → Providers** → enable **Google** and **Email**.
5. **Project Settings → API** → copy the URL and anon key into `.env.local`:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

   (`SUPABASE_SERVICE_ROLE_KEY` is server-only — used by the payment webhook.
   Never expose it.)
6. Restart the dev server and add your first pieces from the admin dashboard
   (`/admin` → Add a piece) or the sell flow.

### Testing from other devices (LAN or ngrok)

`next dev` binds `0.0.0.0`, so the app is reachable from any device on your
Wi-Fi via your machine's LAN IP (`http://<your-ip>:3001`) or an ngrok tunnel
(`ngrok http 3001`). Before **Google sign-in / email confirmation links**
work from those URLs, add each origin to **Authentication → URL
Configuration → Redirect URLs** (step 3). Email+password login needs no
redirect at all, so it works from any origin immediately.

Email confirmation links are the one catch: the link is baked into the
email **at sign-up time** with the origin you were on. If an account was
created on `localhost`, that link tries to reach the *device's own*
localhost when opened on a phone (→ `ERR_CONNECTION_REFUSED`). Set
`NEXT_PUBLIC_SITE_URL` in `.env.local` to a URL reachable from every
device — e.g. your ngrok tunnel — and every confirmation link (and
resend) uses it instead of the sign-up origin.

## 2 · Features

| Feature | Where |
| --- | --- |
| Open, un-gated browsing | Homepage feed (New Drops + Available Drops, search, sorting) |
| Movable 3D hero | `Hero3D` / `MascotModel` — 6-character lineup, drag to rotate, scroll to zoom. Position-welded + meshopt-compressed models (`public/models/modelToUse.glb` ~7MB desktop / 500K verts, `modelToUse-mobile.glb` ~3.6MB for phones, `modelToUse-lite.glb` ~0.9MB for low-end devices) built via `scripts/compress-model.ts` |
| Supabase Auth (Google + email) | `AuthModal`, gated buy/sell/save actions only |
| 1-of-1 inventory | `purchase_product` / `finalize_order` SQL functions — atomic order write + product delete |
| P2P marketplace + 10% commission (min KES 50) | `create_listing` SQL function; commission routing inside the purchase functions |
| Seller escrow (anti-scam) | Seller's 90% is held in escrow until the buyer confirms delivery — or a 24h auto-resolve window passes — then pays out automatically via Paystack Transfer (`0005_escrow.sql`; confirm button on the buyer's account page) |
| Optimized photo uploads | Every listing photo is compressed + converted to WebP server-side (sharp, ≤1600px) before reaching Supabase Storage, keeping the feed fast on mobile data |
| Wishlist | Postgres-backed save (🤍 on cards) + `/wishlist` page, real-time |
| Admin dashboard | `/admin` — platform wallet, products, community listings |
| Notifications | In-app bell — sellers are pinged when a listed piece is approved or rejected, and every user is pinged when a new piece drops on the feed. Seller emails are **DB-triggered** (pg_net webhook → `/api/notifications/email` → Resend, optional), so they send even if the admin tab closes |
| Rate limiting | Per-user caps on payment initiations, photo uploads and payouts |
| Server-side checkout (Paystack) | M-Pesa STK push (`/api/payments/initiate`) or card redirect (Paystack checkout, `/api/payments/card/callback`); the verified webhook finalizes orders server-side. No client-side purchase path. |

## 3 · Scripts

```bash
npm run dev        # dev server
npm run build      # production build (typechecks)
npm run lint       # eslint
```

## 4 · Payments

Checkout runs through **Paystack** — M-Pesa STK push (the default) or cards —
and is fully server-side: the route validates the product + price from the
database, initiates the charge, and the verified Paystack webhook finalizes
the order. There is no client-triggered purchase. Seller payouts go out via
Paystack Transfers (M-Pesa wallet or Kenyan bank account, chosen on
`/account`). Set `PAYSTACK_SECRET_KEY` in `.env.local` to go live; without
it checkout stays disabled. See [`docs/PAYMENTS.md`](docs/PAYMENTS.md).

## 5 · Production launch

Ready to ship? See [`docs/PRODUCTION.md`](docs/PRODUCTION.md) — the
step-by-step checklist for domain, Vercel, Supabase URL config, Paystack
go-live, env vars and the post-deploy smoke test.

## 6 · Admin dashboard

Open `/admin` to review community listings and watch the platform wallet.
Access is granted by setting
`NEXT_PUBLIC_ADMIN_UID` to your Supabase user ID (Authentication → Users), or
setting `role: "admin"` on your row in the `profiles` table. Users can never
change their own role — the migration ships a trigger that blocks it.

## 7 · Project structure

```
src/
  app/            pages (/, /account, /wishlist, /admin) + /api/payments, /api/payouts
  components/     header, hero (3D), feed, modals, sections
  context/        AuthContext, ShopContext (auth-gated modal flow)
  lib/            supabase (clients), db (hooks + RPC calls), payments (Paystack)
supabase/migrations/0001_init.sql   schema + RLS + functions + realtime
public/models/    the 3D mascot GLBs (full + mobile variants)
```
