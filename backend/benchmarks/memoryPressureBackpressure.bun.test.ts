import { describe, expect, it } from "bun:test";

import {
  renderMemoryPressureBenchmark,
  type MemoryPressureBenchmarkResult,
} from "./memoryPressureBackpressure.bench";

describe("memory-pressure benchmark evidence", () => {
  it("records comparable workload and every requested pressure metric", () => {
    const results: MemoryPressureBenchmarkResult[] = [
      result("disabled", { peakRssBytes: 120 * 1024 * 1024, p95QueueLatencyMs: 12 }),
      result("enabled", {
        pauseDurationMs: 44,
        peakRssBytes: 80 * 1024 * 1024,
        p95QueueLatencyMs: 56,
        recoveryTimeMs: 45,
      }),
    ];

    const markdown = renderMemoryPressureBenchmark({
      bunRevision: "revision",
      bunVersion: "1.4.0",
      documentBytes: 8 * 1024 * 1024,
      jobs: 12,
      maxConcurrent: 4,
      platform: "test arm64",
      pressureBytes: 32 * 1024 * 1024,
      pressureHoldMs: 40,
      results,
    });

    expect(markdown).toContain("Policy disabled");
    expect(markdown).toContain("Policy enabled");
    expect(markdown).toContain("Peak RSS");
    expect(markdown).toContain("P95 queue latency");
    expect(markdown).toContain("Pause duration");
    expect(markdown).toContain("Recovery time");
    expect(markdown).toContain("Completed");
    expect(markdown).toContain("Failed");
    expect(markdown).toContain("Rejected admissions");
    expect(markdown).toContain("same 12 queued 8.00 MiB Document simulations");
    expect(markdown).toContain("not a production capacity claim");
  });
});

function result(
  mode: "disabled" | "enabled",
  overrides: Partial<MemoryPressureBenchmarkResult>,
): MemoryPressureBenchmarkResult {
  return {
    completed: 12,
    failed: 0,
    mode,
    p50QueueLatencyMs: 10,
    p95QueueLatencyMs: 20,
    pauseDurationMs: 0,
    peakRssBytes: 100 * 1024 * 1024,
    recoveryTimeMs: 0,
    rejectedAdmissions: 0,
    wallTimeMs: 100,
    ...overrides,
  };
}
