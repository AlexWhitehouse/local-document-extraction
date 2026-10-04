import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildModelResponseFormat } from "../src/consumer/modelGateway";
import { validateDocumentClassification, validateSplitPlan } from "../src/consumer/documentAssessment";
import { readPersistedTiming, resultFailures } from "./loopbackGatewaySaturation.bench";
import { benchmarkModelName, benchmarkScenarios, benchmarkTemplateId, scenarioWorkload, simulateModelResponse, submissionRetryDelayMs, summarizeOutcomes, waitForBenchmarkDrain } from "./loopbackWorkload";

function request(name: string, context: unknown = {}) {
  return {
    response_format: buildModelResponseFormat(benchmarkModelName, name, {}),
    messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(context) }] }],
  };
}

test("capacity retries honor server delay seconds and HTTP dates with a one-second minimum", () => {
  const now = Date.parse("2026-10-04T00:00:00Z");
  expect(submissionRetryDelayMs("3", now)).toBe(3_000);
  expect(submissionRetryDelayMs("Sun, 04 Oct 2026 00:00:05 GMT", now)).toBe(5_000);
  for (const header of [null, "", "0", "invalid", "Sun, 04 Oct 2026 00:00:00 GMT"]) {
    expect(submissionRetryDelayMs(header, now)).toBe(1_000);
  }
});

describe("simulated model contracts", () => {
  test("classification selects the eligible benchmark template and passes production validation", () => {
    const candidates = [{ id: "alternative", name: "Other", description: "Other" }, { id: benchmarkTemplateId, name: "Reference", description: "Reference" }];
    const response = simulateModelResponse(request("document_classification", { candidates }));
    expect(response.stage).toBe("classification");
    expect(validateDocumentClassification(JSON.parse(response.content), candidates).template_id).toBe(benchmarkTemplateId);
    expect(() => simulateModelResponse(request("document_classification", { candidates: [] }))).toThrow("candidate");
  });

  test("splitting preserves original page numbers and accounts for every selected page", () => {
    const response = simulateModelResponse(request("document_split", { pages: [{ original_page: 2 }, { original_page: 5 }] }));
    const content = JSON.parse(response.content);
    expect(response.stage).toBe("splitting");
    expect(validateSplitPlan(content.groups, content.exclusions, [2, 5], false).groups).toEqual([[2], [5]]);
    expect(() => simulateModelResponse(request("document_split"))).toThrow("mapping");
  });

  test("extraction and unsupported requests cannot masquerade as assessment", () => {
    const response = simulateModelResponse(request("extraction_results"));
    expect(response.stage).toBe("extraction");
    expect(JSON.parse(response.content).results[0].field_id).toBe("reference");
    expect(() => simulateModelResponse(request("unknown"))).toThrow("Unexpected model response contract");
    expect(() => simulateModelResponse({})).toThrow("Unexpected model response contract");
  });
});

test("packet throughput counts uploads only after every expected child completes, using server timestamps", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "loopback-timing-"));
  await mkdir(join(stateDirectory, "data", "workspaces"), { recursive: true });
  const database = new Database(join(stateDirectory, "data", "workspaces", "test.sqlite"));
  const at = (seconds: number) => new Date(seconds * 1_000).toISOString();
  try {
    database.exec(`CREATE TABLE jobs(id TEXT, status TEXT, created_at TEXT, completed_at TEXT);
      CREATE TABLE document_packets(id TEXT, status TEXT, created_at TEXT);
      CREATE TABLE document_packet_children(packet_id TEXT, job_id TEXT);`);
    for (const id of ["complete", "incomplete", "failed"]) {
      database.query("INSERT INTO document_packets VALUES (?, 'processing_children', ?)").run(id, at(0));
    }
    for (const [id, packet, status, completed] of [
      ["a", "complete", "completed", 5], ["b", "complete", "completed", 8],
      ["c", "incomplete", "completed", 6], ["d", "failed", "failed", null],
    ] as const) {
      database.query("INSERT INTO jobs VALUES (?, ?, ?, ?)").run(id, status, at(4), completed === null ? null : at(completed));
      database.query("INSERT INTO document_packet_children VALUES (?, ?)").run(packet, id);
    }
    const timing = readPersistedTiming({ stateDirectory, workspaceId: "test", splitting: true, jobsPerSubmission: 2, loadStartedAt: at(0), loadStoppedAt: at(7), warmupSeconds: 1 });
    expect(timing).toMatchObject({ completed: 3, failed: 1, measurementCompleted: 2 });
    expect(timing.submissions).toMatchObject({ completed: 1, failed: 1, other: 1, measurementCompleted: 0, lifecycleP95Ms: 8_000 });
    const unsplit = readPersistedTiming({ stateDirectory, workspaceId: "test", splitting: false, jobsPerSubmission: 1, loadStartedAt: at(0), loadStoppedAt: at(7), warmupSeconds: 1 });
    expect(unsplit.submissions.completed).toBe(unsplit.completed);
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("measurement window excludes warm-up and drain while preserving full lifecycle latency", () => {
  const rows = [1, 3, 8].map((seconds) => ({ status: "completed", created_at: new Date(0).toISOString(), completed_at: new Date(seconds * 1_000).toISOString() }));
  expect(summarizeOutcomes(rows, 2_000, 6_000)).toMatchObject({ completed: 3, measurementCompleted: 1, measurementJobsPerSecond: 0.25, lifecycleP95Ms: 8_000 });
});

test("drain waits for worker cleanup after completion events and respects its deadline", async () => {
  const progress = [
    { terminalJobs: 1, active: 0, pending: 0, deferred: 1 },
    { terminalJobs: 2, active: 1, pending: 0, deferred: 0 },
    { terminalJobs: 2, active: 0, pending: 0, deferred: 0 },
  ];
  await waitForBenchmarkDrain(async () => progress.shift()!, 2, Date.now() + 1_000);
  expect(progress).toHaveLength(0);
  let reads = 0;
  await waitForBenchmarkDrain(async () => {
    reads++;
    return { terminalJobs: 0, active: 1, pending: 0, deferred: 0 };
  }, 2, Date.now() + 1);
  expect(reads).toBeLessThanOrEqual(1);
});

test("each scenario requires all child jobs and the correct model stages, including zero-work rejection", () => {
  for (const scenario of benchmarkScenarios) {
    const workload = scenarioWorkload(scenario, 2);
    const jobs = workload.jobsPerSubmission;
    const timing = summarizeOutcomes([], 0, 1_000);
    const result: Parameters<typeof resultFailures>[0] = {
      accepted: 1, scenario, jobsPerSubmission: jobs,
      serverTiming: { ...timing, completed: jobs, submissions: { ...timing, completed: 1 } },
      gateway: { active: 0, bytesReceived: 0, cpuCoreEquivalents: 0, cpuSystemMs: 0, cpuUserMs: 0, elapsedMs: 1_000, peakActive: 1, peakRssBytes: 0, requests: 0, invalidRequests: 0,
        requestsByStage: { extraction: jobs, classification: workload.automatic ? jobs : 0, splitting: workload.splitting ? 1 : 0 } },
      client: { cpuCoreEquivalents: 0, networkErrors: 0, rejected: 0, unexpectedResponses: [] },
    };
    expect(resultFailures(result)).toEqual([]);
    expect(resultFailures({ ...result, accepted: 0 })).toContain("No uploads were accepted");
    result.gateway.requestsByStage.extraction = 0;
    expect(resultFailures(result).some((failure) => failure.includes("extraction call count"))).toBe(true);
    if (workload.automatic) {
      result.gateway.requestsByStage.classification = 0;
      expect(resultFailures(result).some((failure) => failure.includes("classification call count"))).toBe(true);
    }
    if (workload.splitting) {
      result.gateway.requestsByStage.splitting = 0;
      expect(resultFailures(result).some((failure) => failure.includes("splitting call count"))).toBe(true);
    }
  }
});
