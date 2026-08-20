import { describe, expect, test } from "bun:test";

import {
  percentile,
  renderStaticAssetBenchmark,
  type StaticAssetBenchmarkResult,
} from "./staticAssetConcurrency.bench";

describe("static asset concurrency evidence", () => {
  test("calculates an interpolated latency percentile without mutating samples", () => {
    const samples = [40, 10, 30, 20];

    expect(percentile(samples, 0.5)).toBe(25);
    expect(percentile(samples, 0.95)).toBeCloseTo(38.5);
    expect(samples).toEqual([40, 10, 30, 20]);
  });

  test("labels the legacy and lazy implementations with comparable parameters", () => {
    const results: StaticAssetBenchmarkResult[] = [
      benchmarkResult({ mode: "buffered", peakRssBytes: 200, p95LatencyMs: 12 }),
      benchmarkResult({ mode: "lazy", peakRssBytes: 120, p95LatencyMs: 8 }),
    ];

    const markdown = renderStaticAssetBenchmark({
      assetBytes: 8 * 1024 * 1024,
      bunRevision: "revision",
      bunVersion: "1.4.0",
      concurrency: 12,
      platform: "test arch",
      results,
      rounds: 2,
    });

    expect(markdown).toContain("Legacy `readFile()` buffer");
    expect(markdown).toContain("Lazy `Bun.file()` response");
    expect(markdown).toContain("RSS reduction");
    expect(markdown).toContain("same 8.00 MiB asset, concurrency 12, 2 rounds");
  });
});

function benchmarkResult(
  overrides: Partial<StaticAssetBenchmarkResult>,
): StaticAssetBenchmarkResult {
  return {
    currentRssBytes: 100,
    mode: "lazy",
    p50LatencyMs: 5,
    p95LatencyMs: 8,
    peakRssBytes: 120,
    requestCount: 24,
    wallTimeMs: 20,
    ...overrides,
  };
}
