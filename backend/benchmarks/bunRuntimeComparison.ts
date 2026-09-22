import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";

import { PDFDocument } from "pdf-lib";

export type BunRuntimeRun = {
  admissionRejected: number;
  admissionRetries: number;
  baselineRssBytes: number;
  bunRevision: string;
  bunVersion: string;
  completed: number;
  elapsedMs: number;
  failed: number;
  gatewayPeakActive: number;
  lifecycleLatencyMs: number[];
  maxEventLoopLagMs: number;
  normalizedCpuFraction: number;
  peakRssBytes: number;
  queuePeak: number;
  repetition: number;
  runnerPeak: number;
  sqliteBusyOutcomes: number;
  sqliteBusyRetries: number;
};

export type MetricSummary = {
  coefficientOfVariation: number;
  maximum: number;
  mean: number;
  minimum: number;
};

export type BunRuntimeAggregate = {
  completedTotal: number;
  failedTotal: number;
  lifecycleP50Ms: MetricSummary;
  lifecycleP95Ms: MetricSummary;
  maxEventLoopLagMs: MetricSummary;
  normalizedCpuFraction: MetricSummary;
  peakRssBytes: MetricSummary;
  repetitions: number;
  sqliteBusyOutcomes: number;
  sqliteBusyRetries: number;
  throughputJobsPerSecond: MetricSummary;
};

export type RegressionCheck = {
  actual: string;
  metric: string;
  passed: boolean;
  threshold: string;
};

export type RegressionAssessment = {
  checks: RegressionCheck[];
  passed: boolean;
};

export type BunRuntimeComparisonSettings = {
  boundedAdmissionConcurrency: number;
  boundedRunnerConcurrency: number;
  gatewayConcurrency: number;
  gatewayLatencyMs: number;
  pollIntervalMs: number;
  steadyRepetitions: number;
  warmupRepetitions: number;
  workers: number;
};

export type BunRuntimeComparisonEvidence = {
  command: string;
  fixtureIdentities: Array<{ bytes: number; pageCount: number; sha256: string }>;
  generatedAt?: string;
  host: {
    architecture: string;
    cpuCount: number;
    cpuModel: string;
    memoryBytes: number;
    platform: string;
  };
  profileSummary: {
    cpuHotFunctions: string[];
    heapLargestObjects: string[];
    heapRetentionPaths: string[];
  };
  repository: { dirty: boolean; revision: string };
  runtimes: Array<{
    aggregate: BunRuntimeAggregate;
    runs: BunRuntimeRun[];
    version: string;
  }>;
  settings: BunRuntimeComparisonSettings;
};

type PrototypeResult = {
  bunRevision: string;
  bunVersion: string;
  configuration: Record<string, number>;
  fixtureBytes: number[];
  fixtureSha256: string[];
  results: Array<{
    client: {
      completed: number;
      elapsedMs: number;
      failed: number;
      lifecycleLatencyMs: number[];
      submissionRetries: number;
    };
    profile: "baseline" | "bounded";
    server: {
      admissionRejected: number;
      baselineRssBytes: number;
      completed: number;
      gatewayPeakActive: number;
      maxEventLoopLagMs: number;
      normalizedCpuFraction: number;
      peakRssBytes: number;
      queue: { peakActive: number; peakPending: number };
      sqliteBusyOutcomes: number;
      sqliteBusyRetries: number;
      timing: {
        lifecycleLatencyMs: number[];
        measurementElapsedMs: number;
        throughputJobsPerSecond: number;
      };
    };
  }>;
};

const resultPrefix = "PROTOTYPE_RESULT ";
const repositoryRoot = resolve(import.meta.dir, "../..");
const prototypePath = resolve(import.meta.dir, "throughput.ts");
const rawRoot = resolve(repositoryRoot, ".scratch/bun-1-4-review/raw/19-bun-runtime-comparison");
const evidenceRoot = resolve(repositoryRoot, ".scratch/bun-1-4-review/evidence");
const sharedCommand = "bunx bun@1.4.0 run --cwd backend benchmark:bun-runtime";

export function parsePrototypeResult(stdout: string): PrototypeResult {
  const resultLines = stdout.split(/\r?\n/).filter((line) => line.startsWith(resultPrefix));
  if (resultLines.length === 0) {
    throw new Error("Prototype output did not contain a PROTOTYPE_RESULT record");
  }
  if (resultLines.length !== 1) {
    throw new Error(`Prototype output must contain exactly one PROTOTYPE_RESULT record; received ${resultLines.length}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultLines[0]!.slice(resultPrefix.length));
  } catch (error) {
    throw new Error(
      `Prototype result is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Prototype result must be an object");
  const candidate = parsed as Partial<PrototypeResult>;
  if (!candidate.configuration || !Array.isArray(candidate.results)) {
    throw new Error("Prototype result is missing configuration or results");
  }
  return candidate as PrototypeResult;
}

export function aggregateRuntimeRuns(runs: BunRuntimeRun[]): BunRuntimeAggregate {
  if (runs.length === 0) throw new Error("At least one steady runtime repetition is required");
  return {
    completedTotal: sum(runs.map((run) => run.completed)),
    failedTotal: sum(runs.map((run) => run.failed)),
    lifecycleP50Ms: summarize(runs.map((run) => percentile(run.lifecycleLatencyMs, 0.5))),
    lifecycleP95Ms: summarize(runs.map((run) => percentile(run.lifecycleLatencyMs, 0.95))),
    maxEventLoopLagMs: summarize(runs.map((run) => run.maxEventLoopLagMs)),
    normalizedCpuFraction: summarize(runs.map((run) => run.normalizedCpuFraction)),
    peakRssBytes: summarize(runs.map((run) => run.peakRssBytes)),
    repetitions: runs.length,
    sqliteBusyOutcomes: sum(runs.map((run) => run.sqliteBusyOutcomes)),
    sqliteBusyRetries: sum(runs.map((run) => run.sqliteBusyRetries)),
    throughputJobsPerSecond: summarize(runs.map((run) => run.completed / (run.elapsedMs / 1_000))),
  };
}

export function evaluateRuntimeRegression(
  baseline: BunRuntimeAggregate,
  candidate: BunRuntimeAggregate,
): RegressionAssessment {
  const checks: RegressionCheck[] = [];
  checks.push(lowerBoundCheck(
    "Throughput",
    candidate.throughputJobsPerSecond.mean,
    baseline.throughputJobsPerSecond.mean * 0.9,
    "Bun 1.4 mean must be at least 90% of Bun 1.3.14",
    " jobs/s",
  ));
  checks.push(upperBoundCheck(
    "Lifecycle p95",
    candidate.lifecycleP95Ms.mean,
    baseline.lifecycleP95Ms.mean * 1.15,
    "Bun 1.4 mean must be no more than 115% of Bun 1.3.14",
    " ms",
  ));
  checks.push(upperBoundCheck(
    "Peak RSS",
    candidate.peakRssBytes.mean,
    baseline.peakRssBytes.mean + Math.max(32 * 1024 ** 2, baseline.peakRssBytes.mean * 0.15),
    "Bun 1.4 mean must be within +15% or a 32 MiB noise floor",
    " bytes",
  ));
  checks.push(upperBoundCheck(
    "Normalized CPU",
    candidate.normalizedCpuFraction.mean,
    baseline.normalizedCpuFraction.mean + Math.max(0.02, baseline.normalizedCpuFraction.mean * 0.15),
    "Bun 1.4 mean must be within +15 percentage-relative or a 2-point noise floor",
    "",
  ));
  checks.push(upperBoundCheck(
    "Maximum event-loop lag",
    candidate.maxEventLoopLagMs.mean,
    baseline.maxEventLoopLagMs.mean + Math.max(10, baseline.maxEventLoopLagMs.mean * 0.15),
    "Bun 1.4 mean must be within +15% or a 10 ms noise floor",
    " ms",
  ));
  checks.push({
    actual: `${candidate.failedTotal} failed, ${candidate.sqliteBusyOutcomes} SQLite busy outcomes`,
    metric: "Completion and SQLite integrity",
    passed: candidate.failedTotal === 0 && candidate.sqliteBusyOutcomes === 0,
    threshold: "No failed jobs and no observed SQLITE_BUSY outcome",
  });
  return { checks, passed: checks.every((check) => check.passed) };
}

export function sanitizeBunProfileMarkdown(
  markdown: string,
  options: { repositoryRoot: string; temporaryRoots?: string[] },
): string {
  let sanitized = markdown;
  const replacements = [
    { label: "<repo>", value: options.repositoryRoot },
    ...(options.temporaryRoots ?? []).map((value) => ({ label: "<temp>", value })),
  ].sort((left, right) => right.value.length - left.value.length);
  for (const replacement of replacements) {
    if (replacement.value) {
      sanitized = sanitized.replaceAll(replacement.value, replacement.label);
    }
  }
  sanitized = sanitized
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/\b(?:key|lsk|sk|pk|sess|session)_[A-Za-z0-9._-]{8,}\b/gi, "<redacted-credential>")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<redacted-email>")
    .replace(/\b(?:api[_-]?key|authorization|cookie|password|secret|session|token)(\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,|}]+)/gi, (_match, separator: string) => `<redacted-key>${separator}<redacted>`)
    .replace(/\b(?:prototype-only-012345678901234567|Strong1!)\b/g, "<redacted>")
    .replace(/[A-Za-z0-9+/]{80,}={0,2}/g, "<redacted-long-data>")
    .replace(/(?:\/Users\/[^\s`|)]+|\/home\/[^\s`|)]+|\/private\/var\/folders\/[^\s`|)]+|\/tmp\/[^\s`|)]+)/g, "<absolute-path>");
  return sanitized;
}

export function condenseBunProfileMarkdown(markdown: string, kind: "cpu" | "heap"): string {
  const note = [
    "",
    "---",
    "",
    "> Sanitized decision-rich excerpt. The complete native Bun Markdown profile remains in ignored raw scratch state; exhaustive object, edge, string, and function-detail tables are intentionally not copied into agent-facing evidence.",
    "",
  ].join("\n");
  if (kind === "heap") {
    const graphStart = markdown.indexOf("\n## GC Roots");
    const useful = graphStart >= 0 ? markdown.slice(0, graphStart) : markdown;
    return `${useful.trimEnd()}${note}`;
  }
  const hotStart = markdown.indexOf("## Hot Functions (Self Time)");
  const treeStart = markdown.indexOf("## Call Tree (Total Time)");
  if (hotStart < 0 || treeStart < 0) return `${markdown.trimEnd()}${note}`;
  const introduction = markdown.slice(0, hotStart).trimEnd();
  const hot = markdown.slice(hotStart, treeStart).trim().split(/\r?\n/).slice(0, 31).join("\n");
  const treeEnd = markdown.indexOf("\n## Function Details", treeStart);
  const fullTree = markdown.slice(treeStart, treeEnd >= 0 ? treeEnd : undefined).trim();
  const tree = fullTree.split(/\r?\n/).slice(0, 61).join("\n");
  return `${introduction}\n\n${hot}\n\n${tree}${note}`;
}

export function renderBunRuntimeComparison(evidence: BunRuntimeComparisonEvidence): string {
  if (evidence.runtimes.length !== 2) throw new Error("Exactly two Bun runtimes are required");
  const baseline = evidence.runtimes[0]!;
  const candidate = evidence.runtimes[1]!;
  const assessment = evaluateRuntimeRegression(baseline.aggregate, candidate.aggregate);
  const lines = [
    `# Bounded extraction: Bun ${baseline.version} versus ${candidate.version}`,
    "",
    `- Generated: ${evidence.generatedAt ?? "not recorded"}`,
    `- Repository: \`${evidence.repository.revision}\` (${evidence.repository.dirty ? "dirty working tree" : "clean working tree"})`,
    `- Host: ${evidence.host.platform}/${evidence.host.architecture}; ${evidence.host.cpuCount} × ${evidence.host.cpuModel}; ${formatBytes(evidence.host.memoryBytes)} memory.`,
    `- Reproduce: \`${evidence.command}\``,
    `- Verdict: **${assessment.passed ? "PASS" : "FAIL"}** against the project-local acceptable-regression policy below.`,
    "",
    "This is project-local capacity evidence for one synthetic bounded extraction workload. It is not a production capacity claim and is distinct from Bun's published framework and microbenchmark results.",
    "",
    "## Workload identity and controls",
    "",
    `Both runtimes reuse the exact files below, run ${evidence.settings.warmupRepetitions} discarded warm-up repetition(s), then ${evidence.settings.steadyRepetitions} fresh-state steady repetition(s). Model gateway latency and concurrency are synthetic and fixed; polling jitter is disabled. Jobs/s uses the server interval from first submission receipt through final durable completion, and lifecycle percentiles use persisted server timestamps rather than client polling observation.`,
    "",
    "| Fixture | Pages | Bytes | SHA-256 |",
    "| ---: | ---: | ---: | --- |",
    ...evidence.fixtureIdentities.map((fixture, index) => `| ${index + 1} | ${fixture.pageCount} | ${fixture.bytes} | \`${fixture.sha256}\` |`),
    "",
    "| Control | Value |",
    "| --- | ---: |",
    row("External workers", evidence.settings.workers),
    row("Admission permits", evidence.settings.boundedAdmissionConcurrency),
    row("Runner permits", evidence.settings.boundedRunnerConcurrency),
    row("Model gateway concurrency", evidence.settings.gatewayConcurrency),
    row("Model gateway latency", `${evidence.settings.gatewayLatencyMs} ms`),
    row("Polling interval", `${evidence.settings.pollIntervalMs} ms`),
    "",
    "## Runtime and aggregate results",
    "",
    "| Runtime | Revision | Completed | Failed | Jobs/s mean (CV) | Lifecycle p50 mean | Lifecycle p95 mean | Peak RSS mean | CPU mean | Max lag mean | SQLite busy/retry |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...evidence.runtimes.map((runtime) => {
      const first = runtime.runs[0]!;
      const aggregate = runtime.aggregate;
      return `| Bun ${runtime.version} | \`${first.bunRevision}\` | ${aggregate.completedTotal} | ${aggregate.failedTotal} | ${formatNumber(aggregate.throughputJobsPerSecond.mean)} (${formatPercent(aggregate.throughputJobsPerSecond.coefficientOfVariation)}) | ${formatNumber(aggregate.lifecycleP50Ms.mean)} ms | ${formatNumber(aggregate.lifecycleP95Ms.mean)} ms | ${formatBytes(aggregate.peakRssBytes.mean)} | ${formatPercent(aggregate.normalizedCpuFraction.mean)} | ${formatNumber(aggregate.maxEventLoopLagMs.mean)} ms | ${aggregate.sqliteBusyOutcomes}/${aggregate.sqliteBusyRetries} |`;
    }),
    "",
    "Coefficient of variation (CV) is population standard deviation divided by the mean across steady repetitions. Min/max and each individual result remain below so agents can see noisy or bimodal runs rather than relying on one average.",
    "",
    "| Runtime | Rep | Completed/failed | Jobs/s | Lifecycle p50/p95 | Peak/baseline RSS | CPU | Max lag | Admission rejected/retried | Runner/queue/gateway peak | SQLite busy/retry |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...evidence.runtimes.flatMap((runtime) => runtime.runs.map((run) => `| Bun ${runtime.version} | ${run.repetition} | ${run.completed}/${run.failed} | ${formatNumber(run.completed / (run.elapsedMs / 1_000))} | ${formatNumber(percentile(run.lifecycleLatencyMs, 0.5))}/${formatNumber(percentile(run.lifecycleLatencyMs, 0.95))} ms | ${formatBytes(run.peakRssBytes)}/${formatBytes(run.baselineRssBytes)} | ${formatPercent(run.normalizedCpuFraction)} | ${formatNumber(run.maxEventLoopLagMs)} ms | ${run.admissionRejected}/${run.admissionRetries} | ${run.runnerPeak}/${run.queuePeak}/${run.gatewayPeakActive} | ${run.sqliteBusyOutcomes}/${run.sqliteBusyRetries} |`)),
    "",
    "### Aggregate range and variance",
    "",
    "| Runtime | Metric | Min | Mean | Max | Coefficient of variation |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...evidence.runtimes.flatMap((runtime) => aggregateRows(runtime.version, runtime.aggregate)),
    "",
    "## Acceptable-regression policy",
    "",
    "Throughput may fall by at most 10%. Mean lifecycle p95 may grow by at most 15%. Peak RSS, normalized CPU, and event-loop lag may grow by at most 15%, with 32 MiB, two normalized-CPU percentage points, and 10 ms practical noise floors respectively. Candidate runs must complete every job without an observed SQLite busy outcome.",
    "",
    "| Check | Actual | Threshold | Result |",
    "| --- | --- | --- | --- |",
    ...assessment.checks.map((check) => `| ${check.metric} | ${check.actual} | ${check.threshold} | ${check.passed ? "PASS" : "FAIL"} |`),
    "",
    "## Bun 1.4 native Markdown profiles",
    "",
    "The profiling repetition uses the same synthetic fixtures and bounded settings. Bun's raw Markdown profiles stay under ignored `raw/` scratch state. Shareable copies are path- and credential-scrubbed at [`19-bun-runtime-profiles/cpu.md`](19-bun-runtime-profiles/cpu.md) and [`19-bun-runtime-profiles/heap.md`](19-bun-runtime-profiles/heap.md). Profiles help explain an observed comparison; they are not added to the timed steady repetitions.",
    "",
    "### CPU profile findings",
    "",
    ...(evidence.profileSummary.cpuHotFunctions.length > 0 ? evidence.profileSummary.cpuHotFunctions.map(bullet) : ["- No hot-function rows were available."]),
    "",
    "### Largest retained objects",
    "",
    ...(evidence.profileSummary.heapLargestObjects.length > 0 ? evidence.profileSummary.heapLargestObjects.map(bullet) : ["- No retained-object rows were available."]),
    "",
    "### Heap retention paths",
    "",
    ...(evidence.profileSummary.heapRetentionPaths.length > 0 ? evidence.profileSummary.heapRetentionPaths.map(bullet) : ["- No retainer-chain entries were available."]),
    "",
    "## Reproduction and safety",
    "",
    "```bash",
    evidence.command,
    "```",
    "",
    "The command launches both exact Bun versions with `--no-env-file` and a minimal environment, creates only synthetic PDF attachments, uses a loopback fake Model gateway, resets application state for every repetition, keeps raw artifacts in ignored scratch state, and sanitizes the Markdown copies before publishing them. No Source file content, account identity, session/auth value, or Model gateway credential is intentionally read.",
    "",
  ];
  return lines.join("\n");
}

async function runCoordinator(): Promise<void> {
  const settings = readSettings();
  const fixtureDirectory = join(rawRoot, "fixtures");
  const profileDirectory = join(rawRoot, "profiles");
  const shareableProfileDirectory = join(evidenceRoot, "19-bun-runtime-profiles");
  await Promise.all([
    mkdir(fixtureDirectory, { recursive: true }),
    mkdir(profileDirectory, { recursive: true }),
    mkdir(shareableProfileDirectory, { recursive: true }),
  ]);
  const fixtureIdentities = await createSharedFixtures(fixtureDirectory);
  const runtimes = [] as BunRuntimeComparisonEvidence["runtimes"];
  for (const version of ["1.3.14", "1.4.0"]) {
    process.stdout.write(`Warming Bun ${version}...\n`);
    for (let repetition = 0; repetition < settings.warmupRepetitions; repetition += 1) {
      await runRuntimeInvocation({ fixtureDirectory, fixtureIdentities, repetition: 0, settings, version });
    }
    const runs: BunRuntimeRun[] = [];
    for (let repetition = 1; repetition <= settings.steadyRepetitions; repetition += 1) {
      process.stdout.write(`Measuring Bun ${version}, repetition ${repetition}/${settings.steadyRepetitions}...\n`);
      runs.push(await runRuntimeInvocation({ fixtureDirectory, fixtureIdentities, repetition, settings, version }));
    }
    runtimes.push({ aggregate: aggregateRuntimeRuns(runs), runs, version });
  }

  process.stdout.write("Profiling the Bun 1.4.0 bounded server...\n");
  await runRuntimeInvocation({
    fixtureDirectory,
    fixtureIdentities,
    repetition: 0,
    serverRuntimeFlags: [
      "--cpu-prof-md",
      "--cpu-prof-name", "server-cpu.md",
      "--cpu-prof-dir", profileDirectory,
      "--heap-prof-md",
      "--heap-prof-name", "server-heap.md",
      "--heap-prof-dir", profileDirectory,
    ],
    settings,
    version: "1.4.0",
  });
  const rawCpu = await readFile(join(profileDirectory, "server-cpu.md"), "utf8");
  const rawHeap = await readFile(join(profileDirectory, "server-heap.md"), "utf8");
  const sanitizationOptions = {
    repositoryRoot,
    temporaryRoots: [fixtureDirectory, profileDirectory, rawRoot, tmpdir()],
  };
  const cpu = sanitizeBunProfileMarkdown(condenseBunProfileMarkdown(rawCpu, "cpu"), sanitizationOptions);
  const heap = sanitizeBunProfileMarkdown(condenseBunProfileMarkdown(rawHeap, "heap"), sanitizationOptions);
  await Promise.all([
    writeFile(join(shareableProfileDirectory, "cpu.md"), cpu, "utf8"),
    writeFile(join(shareableProfileDirectory, "heap.md"), heap, "utf8"),
  ]);

  const evidence: BunRuntimeComparisonEvidence = {
    command: sharedCommand,
    fixtureIdentities,
    generatedAt: new Date().toISOString(),
    host: {
      architecture: arch(),
      cpuCount: cpus().length,
      cpuModel: cpus()[0]?.model ?? "unknown CPU",
      memoryBytes: totalmem(),
      platform: platform(),
    },
    profileSummary: summarizeBunProfiles(cpu, heap),
    repository: await repositoryIdentity(),
    runtimes,
    settings,
  };
  const markdown = renderBunRuntimeComparison(evidence);
  await writeFile(join(evidenceRoot, "19-bun-runtime-comparison.md"), markdown, "utf8");
  process.stdout.write(markdown);
  const assessment = evaluateRuntimeRegression(runtimes[0]!.aggregate, runtimes[1]!.aggregate);
  if (!assessment.passed) process.exitCode = 1;
}

async function runRuntimeInvocation({
  fixtureDirectory,
  fixtureIdentities,
  repetition,
  serverRuntimeFlags = [],
  settings,
  version,
}: {
  fixtureDirectory: string;
  fixtureIdentities: BunRuntimeComparisonEvidence["fixtureIdentities"];
  repetition: number;
  serverRuntimeFlags?: string[];
  settings: BunRuntimeComparisonSettings;
  version: string;
}): Promise<BunRuntimeRun> {
  const environment: Record<string, string> = {
    NO_COLOR: "1",
    PATH: process.env.PATH ?? "",
    PROTOTYPE_ADMISSION_CONCURRENCY: String(settings.boundedAdmissionConcurrency),
    PROTOTYPE_DISABLE_JITTER: "1",
    PROTOTYPE_FIXTURE_DIRECTORY: fixtureDirectory,
    PROTOTYPE_GATEWAY_CONCURRENCY: String(settings.gatewayConcurrency),
    PROTOTYPE_GATEWAY_LATENCY_MS: String(settings.gatewayLatencyMs),
    PROTOTYPE_POLL_INTERVAL_MS: String(settings.pollIntervalMs),
    PROTOTYPE_PROFILE: "bounded",
    PROTOTYPE_RUNNER_CONCURRENCY: String(settings.boundedRunnerConcurrency),
    PROTOTYPE_SERVER_RUNTIME_FLAGS: JSON.stringify(serverRuntimeFlags),
    PROTOTYPE_STRUCTURED_ONLY: "1",
    PROTOTYPE_WORKERS: String(settings.workers),
    TMPDIR: tmpdir(),
  };
  const child = Bun.spawn(["bunx", `bun@${version}`, "--no-env-file", prototypePath], {
    cwd: repositoryRoot,
    env: environment,
    stderr: "pipe",
    stdout: "pipe",
  });
  const timeout = setTimeout(() => child.kill(), 120_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).finally(() => clearTimeout(timeout));
  if (exitCode !== 0) {
    throw new Error([
      `Bun ${version} prototype invocation exited with code ${exitCode}`,
      `stdout: ${stdout.slice(-4_000) || "<empty>"}`,
      `stderr: ${stderr.slice(-4_000) || "<empty>"}`,
    ].join("\n"));
  }
  const parsed = parsePrototypeResult(stdout);
  if (parsed.bunVersion !== version) {
    throw new Error(`Requested Bun ${version}, but the prototype reported Bun ${parsed.bunVersion}`);
  }
  const expectedFixtureBytes = fixtureIdentities.map((fixture) => fixture.bytes);
  const expectedFixtureSha256 = fixtureIdentities.map((fixture) => fixture.sha256);
  if (JSON.stringify(parsed.fixtureBytes) !== JSON.stringify(expectedFixtureBytes)
    || JSON.stringify(parsed.fixtureSha256) !== JSON.stringify(expectedFixtureSha256)) {
    throw new Error(`Bun ${version} did not use the coordinator's shared fixture identities`);
  }
  const bounded = parsed.results.find((result) => result.profile === "bounded");
  if (!bounded) throw new Error(`Bun ${version} returned no bounded prototype result`);
  return {
    admissionRejected: bounded.server.admissionRejected,
    admissionRetries: bounded.client.submissionRetries,
    baselineRssBytes: bounded.server.baselineRssBytes,
    bunRevision: parsed.bunRevision,
    bunVersion: parsed.bunVersion,
    completed: bounded.server.completed,
    elapsedMs: bounded.server.timing.measurementElapsedMs,
    failed: bounded.client.failed,
    gatewayPeakActive: bounded.server.gatewayPeakActive,
    lifecycleLatencyMs: bounded.server.timing.lifecycleLatencyMs,
    maxEventLoopLagMs: bounded.server.maxEventLoopLagMs,
    normalizedCpuFraction: bounded.server.normalizedCpuFraction,
    peakRssBytes: bounded.server.peakRssBytes,
    queuePeak: bounded.server.queue.peakPending,
    repetition,
    runnerPeak: bounded.server.queue.peakActive,
    sqliteBusyOutcomes: bounded.server.sqliteBusyOutcomes,
    sqliteBusyRetries: bounded.server.sqliteBusyRetries,
  };
}

async function createSharedFixtures(directory: string): Promise<BunRuntimeComparisonEvidence["fixtureIdentities"]> {
  const definitions = [
    { attachmentBytes: Math.floor(1.8 * 1024 * 1024), pageCount: 2, seed: 0x140001 },
    { attachmentBytes: Math.floor(4.8 * 1024 * 1024), pageCount: 4, seed: 0x140002 },
    { attachmentBytes: Math.floor(9.5 * 1024 * 1024), pageCount: 8, seed: 0x140003 },
  ];
  const identities = [] as BunRuntimeComparisonEvidence["fixtureIdentities"];
  for (const [index, definition] of definitions.entries()) {
    const document = await PDFDocument.create();
    document.setCreationDate(new Date("2026-01-01T00:00:00.000Z"));
    document.setModificationDate(new Date("2026-01-01T00:00:00.000Z"));
    for (let page = 0; page < definition.pageCount; page += 1) document.addPage([612, 792]);
    await document.attach(deterministicBytes(definition.attachmentBytes, definition.seed), "synthetic-payload.bin", {
      description: "Deterministic synthetic benchmark payload",
      mimeType: "application/octet-stream",
    });
    const bytes = await document.save({ useObjectStreams: false });
    await writeFile(join(directory, `fixture-${index}.pdf`), bytes);
    identities.push({
      bytes: bytes.byteLength,
      pageCount: definition.pageCount,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return identities;
}

function deterministicBytes(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

function summarizeBunProfiles(cpu: string, heap: string): BunRuntimeComparisonEvidence["profileSummary"] {
  return {
    cpuHotFunctions: markdownTableRows(cpu, "## Hot Functions (Self Time)", 5),
    heapLargestObjects: markdownTableRows(heap, "## Top 50 Largest Objects", 5),
    heapRetentionPaths: retainerChainSummaries(heap, 5),
  };
}

function markdownTableRows(markdown: string, heading: string, limit: number): string[] {
  const start = markdown.indexOf(heading);
  if (start < 0) return [];
  const section = markdown.slice(start + heading.length).split(/\n## /, 1)[0] ?? "";
  return section.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !line.includes("---") && !line.includes("Rank |") && !line.includes("Self% |"))
    .slice(0, limit);
}

function retainerChainSummaries(markdown: string, limit: number): string[] {
  const section = markdown.split("## Retainer Chains")[1]?.split("\n## ")[0] ?? "";
  const blocks = section.split(/\n(?=### \d+\.)/).filter((block) => block.startsWith("### ")).slice(0, limit);
  return blocks.map((block) => {
    const lines = block.split(/\r?\n/).filter((line) => line && line !== "```");
    const heading = lines.shift()!.replace(/^###\s+/, "");
    const path = lines.join(" ").replace(/\s+/g, " ").trim();
    return path ? `${heading}: ${path}` : heading;
  });
}

function readSettings(): BunRuntimeComparisonSettings {
  return {
    boundedAdmissionConcurrency: positiveEnvironmentInteger("BUN_COMPARISON_ADMISSION_CONCURRENCY", 4),
    boundedRunnerConcurrency: positiveEnvironmentInteger("BUN_COMPARISON_RUNNER_CONCURRENCY", 4),
    gatewayConcurrency: positiveEnvironmentInteger("BUN_COMPARISON_GATEWAY_CONCURRENCY", 4),
    gatewayLatencyMs: positiveEnvironmentInteger("BUN_COMPARISON_GATEWAY_LATENCY_MS", 30),
    pollIntervalMs: positiveEnvironmentInteger("BUN_COMPARISON_POLL_INTERVAL_MS", 10),
    steadyRepetitions: positiveEnvironmentInteger("BUN_COMPARISON_REPETITIONS", 3),
    warmupRepetitions: positiveEnvironmentInteger("BUN_COMPARISON_WARMUPS", 1),
    workers: positiveEnvironmentInteger("BUN_COMPARISON_WORKERS", 40),
  };
}

function positiveEnvironmentInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function repositoryIdentity(): Promise<{ dirty: boolean; revision: string }> {
  const revision = await gitOutput(["rev-parse", "--short=12", "HEAD"]);
  const status = await gitOutput(["status", "--porcelain"]);
  return { dirty: status.length > 0, revision: revision || "unavailable" };
}

async function gitOutput(arguments_: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...arguments_], { cwd: repositoryRoot, stderr: "ignore", stdout: "pipe" });
  const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return code === 0 ? output.trim() : "";
}

function summarize(values: number[]): MetricSummary {
  if (values.length === 0) throw new Error("Cannot summarize an empty metric");
  const mean = sum(values) / values.length;
  const variance = sum(values.map((value) => (value - mean) ** 2)) / values.length;
  return {
    coefficientOfVariation: mean === 0 ? 0 : Math.sqrt(variance) / Math.abs(mean),
    maximum: Math.max(...values),
    mean,
    minimum: Math.min(...values),
  };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  if (fraction === 0.5 && sorted.length % 2 === 0) {
    return (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  }
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

function aggregateRows(version: string, aggregate: BunRuntimeAggregate): string[] {
  return [
    metricRow(version, "Jobs/s", aggregate.throughputJobsPerSecond, ""),
    metricRow(version, "Lifecycle p50", aggregate.lifecycleP50Ms, " ms"),
    metricRow(version, "Lifecycle p95", aggregate.lifecycleP95Ms, " ms"),
    metricRow(version, "Peak RSS", aggregate.peakRssBytes, " bytes", true),
    metricRow(version, "Normalized CPU", aggregate.normalizedCpuFraction, "", false, true),
    metricRow(version, "Maximum event-loop lag", aggregate.maxEventLoopLagMs, " ms"),
  ];
}

function metricRow(
  version: string,
  name: string,
  metric: MetricSummary,
  suffix: string,
  bytes = false,
  percent = false,
): string {
  const display = (value: number) => bytes ? formatBytes(value) : percent ? formatPercent(value) : `${formatNumber(value)}${suffix}`;
  return `| Bun ${version} | ${name} | ${display(metric.minimum)} | ${display(metric.mean)} | ${display(metric.maximum)} | ${formatPercent(metric.coefficientOfVariation)} |`;
}

function lowerBoundCheck(
  metric: string,
  actual: number,
  threshold: number,
  thresholdText: string,
  suffix: string,
): RegressionCheck {
  return { actual: `${formatNumber(actual)}${suffix}`, metric, passed: actual >= threshold, threshold: `${thresholdText} (≥ ${formatNumber(threshold)}${suffix})` };
}

function upperBoundCheck(
  metric: string,
  actual: number,
  threshold: number,
  thresholdText: string,
  suffix: string,
): RegressionCheck {
  return { actual: `${formatNumber(actual)}${suffix}`, metric, passed: actual <= threshold, threshold: `${thresholdText} (≤ ${formatNumber(threshold)}${suffix})` };
}

function row(label: string, value: string | number): string {
  return `| ${label} | ${value} |`;
}

function bullet(value: string): string {
  return `- ${value}`;
}

function formatBytes(value: number): string {
  return `${formatNumber(value / 1024 ** 2)} MiB`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "n/a";
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

if (import.meta.main) await runCoordinator();
