import { describe, expect, it } from "bun:test";

import {
  renderDocumentBodyLimitStress,
  runDocumentBodyLimitStress,
  type DocumentBodyLimitStressResult,
} from "./documentBodyLimitStress.bench";

describe("Document body-limit stress evidence", () => {
  it("renders workload, latency, memory, settlement, and durable side-effect outcomes", () => {
    const markdown = renderDocumentBodyLimitStress({
      bunRevision: "revision",
      bunVersion: "1.4.0",
      maxSourceBytes: 64 * 1024,
      platform: "test arm64",
      result: fixtureResult(),
    });

    for (const label of [
      "Structured oversize responses",
      "P95 response latency",
      "Peak RSS growth",
      "Aborted connections settled",
      "Temporary files retained",
      "Promoted Source files",
      "Extraction jobs created",
    ]) {
      expect(markdown).toContain(label);
    }
    expect(markdown).toContain("not a production capacity claim");
  });

  it("settles bounded real-server known, chunked, and aborted oversize probes", async () => {
    const result = await runDocumentBodyLimitStress({
      abortedRequests: 2,
      chunkedRequests: 4,
      concurrency: 4,
      knownRequests: 4,
      maxSourceBytes: 64 * 1024,
    });

    expect(result).toMatchObject({
      abortedConnectionsSettled: 2,
      abortedRequests: 2,
      chunkedRequests: 4,
      extractionJobsCreated: 0,
      knownRequests: 4,
      promotedSourceFiles: 0,
      structuredOversizeResponses: 8,
      temporaryFilesRetained: 0,
      unexpectedResponses: 0,
    });
    expect(result.pendingHandlers).toBe(0);
    expect(result.p95ResponseLatencyMs).toBeLessThan(2_000);
    expect(result.peakRssGrowthBytes).toBeLessThan(128 * 1024 * 1024);
  });
});

function fixtureResult(): DocumentBodyLimitStressResult {
  return {
    abortedConnectionsSettled: 2,
    abortedRequests: 2,
    chunkedRequests: 4,
    extractionJobsCreated: 0,
    knownRequests: 4,
    p50ResponseLatencyMs: 10,
    p95ResponseLatencyMs: 20,
    peakRssBytes: 80 * 1024 * 1024,
    peakRssGrowthBytes: 16 * 1024 * 1024,
    pendingHandlers: 0,
    promotedSourceFiles: 0,
    structuredOversizeResponses: 8,
    temporaryFilesRetained: 0,
    unexpectedResponses: 0,
    wallTimeMs: 50,
  };
}
