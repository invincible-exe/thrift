/**
 * Distributed rate limiter backed by Postgres (the app's shared Supabase DB).
 *
 * Why Postgres instead of memory: the old in-memory limiter was exact on a
 * single instance but a per-instance SOFT limit on multi-instance serverless
 * deploys (e.g. many Vercel lambdas), so a bot could spread hits across
 * instances and blow past the caps. The shared `rate_limits` table (see
 * supabase/migrations/0019_rate_limit.sql) keeps ONE counter per key across
 * every instance — `rate_limit_hit` is a SECURITY DEFINER RPC doing a single
 * atomic upsert, so concurrent requests serialize on the row lock.
 *
 * Graceful degradation: when the service-role keys are unset (preview/dev
 * without keys) or the RPC is missing (migration not applied), the limiter
 * falls back to per-instance in-memory buckets — the endpoint still gets a
 * working cap instead of failing closed on infrastructure.
 *
 * `rateLimit` is async so routes can check it with one `await`.
 */

import { isAdminConfigured, getAdminClient } from "@/lib/supabase/admin";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

/** In-memory fallback — a per-instance soft limit (dev box / preview mode). */
function memoryLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  // Opportunistic cleanup: sweep expired buckets whenever the table grows
  // large, instead of running a timer (serverless instances shouldn't leave
  // stray intervals behind).
  if (buckets.size > 10_000) {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }

  const now = Date.now();
  const bucket = buckets.get(key);

  // Fresh window (or first hit).
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, limit, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (bucket.count >= limit) {
    return { ok: false, limit, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { ok: true, limit, remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

let warned = false;

/**
 * Record one hit for `key`. Returns whether the hit is allowed and how many
 * remain in the current window.
 *
 * @param key      Unique limiter key, e.g. `checkout:${userId}`.
 * @param limit    Max hits per window.
 * @param windowMs Window length in milliseconds.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  // Distributed path: exact, shared counters across every instance.
  if (isAdminConfigured) {
    try {
      const admin = getAdminClient();
      const { data, error } = await admin.rpc("rate_limit_hit", {
        p_key: key,
        p_limit: limit,
        p_window_ms: windowMs,
      });
      if (!error && Array.isArray(data) && data.length > 0) {
        const row = data[0];
        return {
          ok: Boolean(row.ok),
          limit,
          remaining: Number(row.remaining),
          resetAt: new Date(row.reset_at).getTime(),
        };
      }
      if (error && !warned) {
        warned = true;
        console.error(
          "rate_limit_hit RPC failed — falling back to in-memory:",
          String(error.message ?? "")
        );
      }
    } catch (err) {
      if (!warned) {
        warned = true;
        console.error("rate_limit_hit threw — falling back to in-memory:", err);
      }
    }
  }
  return memoryLimit(key, limit, windowMs);
}

/** Standard windows. */
export const WINDOWS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const;
