import { expect, it } from "bun:test";

import { runDocumentBodyLimitStress } from "./documentBodyLimitStress.bench";

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
