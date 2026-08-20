import { expect, test } from "bun:test";

import {
  renderLiveUpdateFanoutBenchmark,
  type LiveUpdateFanoutResult,
} from "./liveUpdateFanout.bench";

test("live update fanout evidence records current hub cost without claiming native-topic results", () => {
  const results: LiveUpdateFanoutResult[] = [
    {
      attemptedSends: 100,
      events: 10,
      microsecondsPerSend: 2,
      rssGrowthBytes: 1024,
      sendsPerSecond: 500_000,
      subscribers: 10,
      wallTimeMs: 0.2,
    },
  ];
  const markdown = renderLiveUpdateFanoutBenchmark({
    bunRevision: "revision",
    bunVersion: "1.4.0",
    platform: "test arm64",
    results,
  });

  for (const label of [
    "Subscribers",
    "Events",
    "Attempted sends",
    "Wall time",
    "Per-send cost",
    "Sends/second",
    "RSS growth",
  ]) {
    expect(markdown).toContain(label);
  }
  expect(markdown).toContain("current in-memory hub");
  expect(markdown).toContain("does not measure Bun native topics");
  expect(markdown).toContain("not a production capacity claim");
});
