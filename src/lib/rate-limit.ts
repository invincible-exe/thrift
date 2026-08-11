/**
 * Lightweight in-memory fixed-window rate limiter.
 *
 * Used to protect cost-bearing and abuse-prone endpoints (payment
 * initiations, photo uploads, payouts). Limits are keyed per user and
 * stored in memory:
 *
 *  - Single-instance deploys (dev, one VPS): a hard limit.
 *  - Multi-instance serverless (e.g. many Vercel lambdas): a per-instance
 *    soft limit — still kills the common abuse case (a single client
 *    hammering the endpoint) even though each instance keeps its own
 *    counters. For hard distributed limits, swap this for a shared store
 *    (Upstash/Redis) or the platform's own rate limiter.
 *
 * `rateLimit` is synchronous so routes can check it with one line.
 */

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

/**
 * Record one hit for `key`. Returns whether the hit is allowed and how many
 * remain in the current window.
 *
 * @param key      Unique limiter key, e.g. `mpesa:${userId}`.
 * @param limit    Max hits per window.
 * @param windowMs Window length in milliseconds.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
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

/** Standard windows. */
export const WINDOWS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const;
