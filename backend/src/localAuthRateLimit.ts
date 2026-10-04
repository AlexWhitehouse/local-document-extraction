import { createHash } from "node:crypto";
import type { BetterAuthOptions } from "better-auth";

type RateLimitStorage = NonNullable<NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]>;

type Bucket = { count: number; expiresAt: number };

/** One bounded, atomic attempt budget per running authentication instance. */
export function createLocalAuthRateLimitStorage({
  maximumEntries = 10_000,
  now = Date.now,
}: { maximumEntries?: number; now?: () => number } = {}): RateLimitStorage {
  const buckets = new Map<string, Bucket>();
  let nextSweepAt = 0;

  return {
    // Better Auth 1.6.23 requires these legacy methods in its type, but uses
    // consume whenever provided. Never silently fall back to a racy get/set.
    get: async () => {
      throw new Error("Authentication rate limits require atomic consumption.");
    },
    set: async () => {
      throw new Error("Authentication rate limits require atomic consumption.");
    },
    consume: async (key, rule) => {
      const timestamp = now();

      if (timestamp >= nextSweepAt) {
        for (const [key, bucket] of buckets) if (bucket.expiresAt <= timestamp) buckets.delete(key);
        nextSweepAt = timestamp + 1_000;
      }

      // Keep arbitrarily long client/path strings out of retained state.
      const bucketKey = createHash("sha256").update(key).digest("hex");
      const existing = buckets.get(bucketKey);

      if (existing && existing.expiresAt > timestamp) {
        if (existing.count >= rule.max) {
          return { allowed: false, retryAfter: Math.max(1, Math.ceil((existing.expiresAt - timestamp) / 1_000)) };
        }

        existing.count++;

        return { allowed: true, retryAfter: null };
      }

      if (existing) buckets.delete(bucketKey);

      // Retain active limits under a flood of unique identities; never evict
      // an exhausted bucket to make room for a new attacker-selected key.
      if (buckets.size >= maximumEntries) return { allowed: false, retryAfter: 1 };
      buckets.set(bucketKey, { count: 1, expiresAt: timestamp + rule.window * 1_000 });

      return { allowed: true, retryAfter: null };
    },
  };
}
