import { expect, test } from "bun:test";
import { createByteBudget } from "./lib/byteBudget";
import { readLocalMemoryLimits } from "./localMemoryLimits";

const GiB = 1024 ** 3;

test("a 64 GiB host admits eight PDF preparation reservations within the shared allowance", async () => {
  const limits = readLocalMemoryLimits({}, 64 * GiB);
  expect(limits.processLimitBytes).toBe(Math.floor(64 * GiB * 0.8));
  expect(limits.preparationMaxBytes / GiB).toBeCloseTo(46.08);
  const budget = createByteBudget(limits.preparationMaxBytes);
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let active = 0;
  const calls = Array.from({ length: 8 }, () => budget.run(208 * 1024 ** 2, async () => {
    if (++active === 8) started.resolve();
    await gate.promise;
  }));
  try {
    await started.promise;
    expect(budget.snapshot()).toMatchObject({ reservedBytes: 8 * 208 * 1024 ** 2, waiting: 0 });
  } finally {
    gate.resolve();
    await Promise.all(calls);
  }
  expect(budget.snapshot().reservedBytes).toBe(0);
});

test("the preparation allowance scales down with system RAM and the configured process ceiling", () => {
  const limits = readLocalMemoryLimits({ LOCAL_MEMORY_LIMIT_RATIO: "0.5" }, 2 * GiB);
  expect(limits.processLimitBytes).toBe(GiB);
  expect(limits.preparationMaxBytes).toBe(Math.floor(GiB * 0.9));
  const constrained = readLocalMemoryLimits({}, 256 * 1024 ** 2);
  expect(constrained.preparationMaxBytes).toBeLessThan(256 * 1024 ** 2);
});

test("operators can lower the preparation budget but cannot remove process headroom", () => {
  expect(readLocalMemoryLimits({ MODEL_PREPARATION_MAX_BYTES: String(GiB) }, 64 * GiB)
    .preparationMaxBytes).toBe(GiB);
  expect(() => readLocalMemoryLimits({ MODEL_PREPARATION_MAX_BYTES: String(50 * GiB) }, 64 * GiB))
    .toThrow("MODEL_PREPARATION_MAX_BYTES");
  for (const value of ["0", "-1", "invalid", "Infinity", "1.5"]) {
    expect(() => readLocalMemoryLimits({ MODEL_PREPARATION_MAX_BYTES: value }, 64 * GiB))
      .toThrow("MODEL_PREPARATION_MAX_BYTES");
  }
  for (const value of ["0", "-1", "invalid", "Infinity", "1.1"]) {
    expect(() => readLocalMemoryLimits({ LOCAL_MEMORY_LIMIT_RATIO: value }, 64 * GiB))
      .toThrow("LOCAL_MEMORY_LIMIT_RATIO");
  }
});
