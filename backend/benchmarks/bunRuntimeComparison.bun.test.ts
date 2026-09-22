import { describe, expect, test } from "bun:test";

import {
  aggregateRuntimeRuns,
  condenseBunProfileMarkdown,
  evaluateRuntimeRegression,
  parsePrototypeResult,
  renderBunRuntimeComparison,
  sanitizeBunProfileMarkdown,
  type BunRuntimeComparisonEvidence,
  type BunRuntimeRun,
} from "./bunRuntimeComparison";

function run(overrides: Partial<BunRuntimeRun> = {}): BunRuntimeRun {
  return {
    admissionRejected: 0,
    admissionRetries: 0,
    baselineRssBytes: 80 * 1024 * 1024,
    bunRevision: "revision-a",
    bunVersion: "1.3.14",
    completed: 20,
    elapsedMs: 1_000,
    failed: 0,
    gatewayPeakActive: 4,
    lifecycleLatencyMs: [800, 900, 1_000, 1_100, 1_200],
    maxEventLoopLagMs: 10,
    normalizedCpuFraction: 0.2,
    peakRssBytes: 100 * 1024 * 1024,
    queuePeak: 12,
    repetition: 1,
    runnerPeak: 4,
    sqliteBusyOutcomes: 0,
    sqliteBusyRetries: 0,
    ...overrides,
  };
}

describe("Bun runtime comparison evidence", () => {
  test("parses the sole credential-free prototype result record", () => {
    const result = parsePrototypeResult([
      "prototype chatter",
      `PROTOTYPE_RESULT ${JSON.stringify({
        configuration: { workers: 20 },
        fixtureBytes: [100, 200],
        fixtureSha256: ["a", "b"],
        results: [{ client: { completed: 20 }, profile: "bounded", server: { accepted: 20 } }],
      })}`,
    ].join("\n"));

    expect(result.configuration).toEqual({ workers: 20 });
    expect(result.fixtureSha256).toEqual(["a", "b"]);
    expect(result.results).toHaveLength(1);
    expect(() => parsePrototypeResult("no structured result")).toThrow("PROTOTYPE_RESULT");
    expect(() => parsePrototypeResult("PROTOTYPE_RESULT {}\nPROTOTYPE_RESULT {}")).toThrow("exactly one");
  });

  test("aggregates repetitions with variance and lifecycle percentiles", () => {
    const aggregate = aggregateRuntimeRuns([
      run({ lifecycleLatencyMs: [10, 20, 30, 40], repetition: 1 }),
      run({ elapsedMs: 1_250, lifecycleLatencyMs: [20, 30, 40, 50], repetition: 2 }),
      run({ elapsedMs: 800, lifecycleLatencyMs: [30, 40, 50, 60], repetition: 3 }),
    ]);

    expect(aggregate.repetitions).toBe(3);
    expect(aggregate.throughputJobsPerSecond.mean).toBeCloseTo((20 + 16 + 25) / 3);
    expect(aggregate.throughputJobsPerSecond.coefficientOfVariation).toBeGreaterThan(0);
    expect(aggregate.lifecycleP50Ms.mean).toBe(35);
    expect(aggregate.lifecycleP95Ms.mean).toBe(50);
    expect(aggregate.completedTotal).toBe(60);
  });

  test("applies explicit regression thresholds with practical noise floors", () => {
    const baseline = aggregateRuntimeRuns([run(), run({ repetition: 2 }), run({ repetition: 3 })]);
    const acceptable = aggregateRuntimeRuns([
      run({ bunVersion: "1.4.0", elapsedMs: 1_100 }),
      run({ bunVersion: "1.4.0", elapsedMs: 1_100, repetition: 2 }),
      run({ bunVersion: "1.4.0", elapsedMs: 1_100, repetition: 3 }),
    ]);
    const slow = aggregateRuntimeRuns([
      run({ bunVersion: "1.4.0", elapsedMs: 1_200 }),
      run({ bunVersion: "1.4.0", elapsedMs: 1_200, repetition: 2 }),
      run({ bunVersion: "1.4.0", elapsedMs: 1_200, repetition: 3 }),
    ]);

    expect(evaluateRuntimeRegression(baseline, acceptable).passed).toBe(true);
    expect(evaluateRuntimeRegression(baseline, slow)).toMatchObject({
      passed: false,
      checks: expect.arrayContaining([
        expect.objectContaining({ metric: "Throughput", passed: false }),
      ]),
    });
  });

  test("scrubs absolute paths, identity, credentials, and long retained data", () => {
    const sanitized = sanitizeBunProfileMarkdown([
      "at /Users/developer/project/backend/src/server.ts:10",
      "tmp=/private/var/folders/aa/bb/T/profile/source.pdf",
      "Authorization: Bearer secret-token-123",
      "api_key=lsk_supersecretvalue",
      "email=person@example.com password=Strong1!",
      `payload=${"A".repeat(120)}`,
    ].join("\n"), {
      repositoryRoot: "/Users/developer/project",
      temporaryRoots: ["/private/var/folders/aa/bb/T/profile"],
    });

    expect(sanitized).toContain("<repo>/backend/src/server.ts:10");
    expect(sanitized).toContain("<temp>/source.pdf");
    expect(sanitized).not.toMatch(/developer|secret-token|lsk_|person@example|Strong1|A{80}/);
    expect(sanitized).toContain("<redacted-long-data>");
  });

  test("keeps decision-rich native profile sections without the full heap graph", () => {
    const condensed = condenseBunProfileMarkdown([
      "# Bun Heap Profile",
      "",
      "## Summary",
      "summary row",
      "## Top 50 Types by Retained Size",
      "type row",
      "## Top 50 Largest Objects",
      "object row",
      "## Retainer Chains",
      "retainer path",
      "## GC Roots",
      "root graph",
      "## All Objects",
      "complete graph",
    ].join("\n"), "heap");

    expect(condensed).toContain("retainer path");
    expect(condensed).toContain("Sanitized decision-rich excerpt");
    expect(condensed).not.toContain("root graph");
    expect(condensed).not.toContain("complete graph");
  });

  test("keeps complete native profile data in explicitly ignored raw scratch state", async () => {
    const ignoreRules = await Bun.file(new URL("../../.gitignore", import.meta.url)).text();
    expect(ignoreRules).toContain(".scratch/");
  });

  test("renders provenance, repetitions, gates, profile findings, and scope", () => {
    const runs = [run(), run({ repetition: 2 }), run({ repetition: 3 })];
    const evidence: BunRuntimeComparisonEvidence = {
      command: "bun run --cwd backend benchmark:bun-runtime",
      fixtureIdentities: [{ bytes: 100, pageCount: 2, sha256: "abc" }],
      host: {
        architecture: "arm64",
        cpuCount: 8,
        cpuModel: "Test CPU",
        memoryBytes: 16 * 1024 ** 3,
        platform: "darwin",
      },
      profileSummary: {
        cpuHotFunctions: ["parseLocalMultipartSubmission"],
        heapLargestObjects: ["ArrayBuffer — 1 MiB"],
        heapRetentionPaths: ["GlobalObject → ArrayBuffer"],
      },
      repository: { dirty: true, revision: "deadbeef" },
      runtimes: [
        { aggregate: aggregateRuntimeRuns(runs), runs, version: "1.3.14" },
        {
          aggregate: aggregateRuntimeRuns(runs.map((entry) => ({ ...entry, bunVersion: "1.4.0" }))),
          runs: runs.map((entry) => ({ ...entry, bunVersion: "1.4.0" })),
          version: "1.4.0",
        },
      ],
      settings: {
        boundedAdmissionConcurrency: 4,
        boundedRunnerConcurrency: 4,
        gatewayConcurrency: 4,
        gatewayLatencyMs: 20,
        pollIntervalMs: 10,
        steadyRepetitions: 3,
        warmupRepetitions: 1,
        workers: 20,
      },
    };
    const markdown = renderBunRuntimeComparison(evidence);

    expect(markdown).toContain("Bun 1.3.14 versus 1.4.0");
    expect(markdown).toContain("Acceptable-regression policy");
    expect(markdown).toContain("Coefficient of variation");
    expect(markdown).toContain("CPU profile findings");
    expect(markdown).toContain("Heap retention paths");
    expect(markdown).toContain("project-local capacity evidence");
    expect(markdown).toContain(evidence.command);
  });
});
