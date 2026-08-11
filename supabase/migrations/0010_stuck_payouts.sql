-- 10/10 Thrifts — stuck-payout reconciliation support.
-- ====================================================================
-- Adds processing_started_at so the reconciliation sweep can tell a B2C
-- send that's mid-flight from one whose ResultURL callback was lost.
-- sendB2CPayout stamps it when claiming a payout (pending → processing);
-- /api/payouts/reconcile reads it to list stale 'processing' rows for the
-- owner to verify against M-Pesa. No new RPCs or policies — the reconcile
-- route uses the service-role client and only ever touches rows already
-- in 'processing', so no client can mutate payout state directly.
alter table public.payouts add column if not exists processing_started_at timestamptz;
