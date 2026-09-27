import { expect, test } from "bun:test";
import { createLocalAuthRateLimitStorage } from "./localAuthRateLimit";

test("an exhausted authentication budget recovers only after its fixed window", async () => {
  let now = 100_000;
  const storage = createLocalAuthRateLimitStorage({ now: () => now });
  const consume = () => storage.consume!("client-and-endpoint", { max: 3, window: 10 });
  expect((await consume()).allowed).toBe(true);
  expect((await consume()).allowed).toBe(true);
  expect((await consume()).allowed).toBe(true);
  expect(await consume()).toEqual({ allowed: false, retryAfter: 10 });
  now = 109_001;
  expect(await consume()).toEqual({ allowed: false, retryAfter: 1 });
  now = 110_000;
  expect(await consume()).toEqual({ allowed: true, retryAfter: null });
});

test("identity churn cannot evict active limits or grow storage without a bound", async () => {
  let now = 100_000;
  const storage = createLocalAuthRateLimitStorage({ maximumEntries: 2, now: () => now });
  const consume = (key: string) => storage.consume!(key, { max: 1, window: 10 });
  expect((await consume("first")).allowed).toBe(true);
  expect((await consume("second")).allowed).toBe(true);
  for (let index = 0; index < 10; index++) expect((await consume(`new-${index}`)).allowed).toBe(false);
  expect((await consume("first")).allowed).toBe(false);
  now = 110_000;
  expect((await consume("new-after-expiry")).allowed).toBe(true);
  expect((await consume("another-after-expiry")).allowed).toBe(true);
  expect((await consume("capacity-again")).allowed).toBe(false);
});
