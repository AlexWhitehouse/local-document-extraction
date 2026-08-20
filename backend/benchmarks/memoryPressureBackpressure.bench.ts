import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createLocalExtractionQueue } from "../src/localExtractionQueue";
import { createLocalResourceController } from "../src/localResourceController";

export type MemoryPressureBenchmarkResult = {
  completed: number;
  failed: number;
  mode: "disabled" | "enabled";
  p50QueueLatencyMs: number;
  p95QueueLatencyMs: number;
  pauseDurationMs: number;
  peakRssBytes: number;
  recoveryTimeMs: number;
  rejectedAdmissions: number;
  wallTimeMs: number;
};

type BenchmarkParameters = {
  documentBytes: number;
  documentWorkMs: number;
  jobs: number;
  maxConcurrent: number;
  pressureBytes: number;
  pressureHoldMs: number;
};

const repositoryRoot = resolve(import.meta.dir, "../..");

export function renderMemoryPressureBenchmark({
  bunRevision,
  bunVersion,
  documentBytes,
  jobs,
  maxConcurrent,
  platform,
  pressureBytes,
  pressureHoldMs,
  results,
}: {
  bunRevision: string;
  bunVersion: string;
  documentBytes: number;
  jobs: number;
  maxConcurrent: number;
  platform: string;
  pressureBytes: number;
  pressureHoldMs: number;
  results: MemoryPressureBenchmarkResult[];
}): string {
  const disabled = results.find((result) => result.mode === "disabled");
  const enabled = results.find((result) => result.mode === "enabled");
  if (!disabled || !enabled) throw new Error("Both benchmark policy modes are required");

  return [
    "# OS memory-pressure backpressure comparison",
    "",
    `- Runtime: Bun ${bunVersion} (${bunRevision})`,
    `- Platform: ${platform}`,
    `- Workload: same ${jobs} queued ${formatMiB(documentBytes)} Document simulations, concurrency ${maxConcurrent}.`,
    `- Pressure window: ${formatMiB(pressureBytes)} touched host-pressure allocation held for ${pressureHoldMs} ms.`,
    "- Each mode runs in a fresh child process; OS pressure is injected through the controller seam rather than by exhausting host memory.",
    "",
    "| Mode | Peak RSS | P50 queue latency | P95 queue latency | Pause duration | Recovery time | Completed | Failed | Rejected admissions | Wall time |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    resultRow("Policy disabled", disabled),
    resultRow("Policy enabled", enabled),
    "",
    `- Peak RSS difference (disabled minus enabled): ${formatMiB(disabled.peakRssBytes - enabled.peakRssBytes)}.`,
    `- P95 queue-latency difference (enabled minus disabled): ${(enabled.p95QueueLatencyMs - disabled.p95QueueLatencyMs).toFixed(2)} ms.`,
    "- Rejected admissions are retryable pressure-window probes; completed/failed counts describe the pre-existing durable queue.",
    "- These are focused local measurements, not a production capacity claim; repeat on deployment-class hardware before setting budgets.",
    "",
  ].join("\n");
}

async function runCoordinator(): Promise<void> {
  const parameters: BenchmarkParameters = {
    documentBytes: readPositiveInteger(process.env.MEMORY_PRESSURE_BENCH_DOCUMENT_BYTES, 8 * 1024 * 1024),
    documentWorkMs: readPositiveInteger(process.env.MEMORY_PRESSURE_BENCH_WORK_MS, 25),
    jobs: readPositiveInteger(process.env.MEMORY_PRESSURE_BENCH_JOBS, 12),
    maxConcurrent: readPositiveInteger(process.env.MEMORY_PRESSURE_BENCH_CONCURRENCY, 4),
    pressureBytes: readPositiveInteger(process.env.MEMORY_PRESSURE_BENCH_PRESSURE_BYTES, 32 * 1024 * 1024),
    pressureHoldMs: readPositiveInteger(process.env.MEMORY_PRESSURE_BENCH_HOLD_MS, 40),
  };
  const results = [] as MemoryPressureBenchmarkResult[];
  for (const mode of ["disabled", "enabled"] as const) {
    results.push(await runIsolatedMode(mode, parameters));
  }
  const markdown = renderMemoryPressureBenchmark({
    bunRevision: Bun.revision,
    bunVersion: Bun.version,
    documentBytes: parameters.documentBytes,
    jobs: parameters.jobs,
    maxConcurrent: parameters.maxConcurrent,
    platform: `${process.platform} ${process.arch}`,
    pressureBytes: parameters.pressureBytes,
    pressureHoldMs: parameters.pressureHoldMs,
    results,
  });
  const evidenceDirectory = resolve(repositoryRoot, ".scratch/bun-1-4-review/evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(join(evidenceDirectory, "16-memory-pressure-backpressure.md"), markdown, "utf8");
  process.stdout.write(markdown);
}

async function runIsolatedMode(
  mode: "disabled" | "enabled",
  parameters: BenchmarkParameters,
): Promise<MemoryPressureBenchmarkResult> {
  const child = Bun.spawn([
    process.execPath,
    "--no-env-file",
    import.meta.path,
    `--worker=${mode}`,
    `--parameters=${encodeURIComponent(JSON.stringify(parameters))}`,
  ], {
    cwd: repositoryRoot,
    env: { NO_COLOR: "1", TMPDIR: tmpdir() },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error([
      `Memory-pressure benchmark ${mode} worker exited with code ${exitCode}`,
      `stdout: ${stdout.slice(-4_000) || "<empty>"}`,
      `stderr: ${stderr.slice(-4_000) || "<empty>"}`,
    ].join("\n"));
  }
  const line = stdout.trim().split(/\r?\n/).findLast((entry) => entry.startsWith("MEMORY_PRESSURE_RESULT "));
  if (!line) throw new Error(`Memory-pressure benchmark ${mode} worker returned no result`);
  return JSON.parse(line.slice("MEMORY_PRESSURE_RESULT ".length)) as MemoryPressureBenchmarkResult;
}

async function runWorker(
  mode: "disabled" | "enabled",
  parameters: BenchmarkParameters,
): Promise<void> {
  const stateDirectory = await mkdtemp(join(tmpdir(), `document-extraction-pressure-${mode}-`));
  const queue = createLocalExtractionQueue({ maxConcurrent: parameters.maxConcurrent });
  queue.setMaxConcurrent(0);
  let completed = 0;
  let failed = 0;
  let firstStartedAt: number | null = null;
  let peakRssBytes = process.memoryUsage().rss;
  const queueLatencies: number[] = [];
  const scheduledAt = performance.now();
  const sampleRss = () => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  };
  const rssSampler = setInterval(sampleRss, 1);
  const controller = createLocalResourceController({
    diskReserveBytes: 0,
    getQueueSnapshot: queue.snapshot,
    initialPermits: parameters.maxConcurrent,
    maximumPermits: parameters.maxConcurrent,
    memoryPressureLargeSubmissionBytes: parameters.documentBytes,
    setPermits: queue.setMaxConcurrent,
    stateDirectory,
  });
  queue.subscribe(async () => {
    const startedAt = performance.now();
    firstStartedAt ??= startedAt;
    queueLatencies.push(startedAt - scheduledAt);
    try {
      const document = new Uint8Array(parameters.documentBytes);
      touchPages(document);
      await Bun.sleep(parameters.documentWorkMs);
      if (document[0] !== 1) throw new Error("Document allocation was not retained");
      completed += 1;
    } catch {
      failed += 1;
    }
  });

  let pressureAllocation: Uint8Array | null = null;
  try {
    for (let index = 0; index < parameters.jobs; index += 1) {
      await queue.schedule({
        attempt: 1,
        enqueued_at: new Date().toISOString(),
        job_id: `job_${index + 1}`,
        template_id: "template_pressure_benchmark",
        template_version: 1,
        workspace_id: `workspace_${(index % parameters.maxConcurrent) + 1}`,
      });
    }

    pressureAllocation = new Uint8Array(parameters.pressureBytes);
    touchPages(pressureAllocation);
    sampleRss();
    const signalAt = performance.now();
    if (mode === "enabled") {
      await controller.handleMemoryPressure("critical");
    } else {
      queue.setMaxConcurrent(parameters.maxConcurrent);
    }

    let rejectedAdmissions = 0;
    for (let probe = 0; probe < parameters.maxConcurrent; probe += 1) {
      const admitted = await controller.canReserveSubmission({
        requestBytes: parameters.documentBytes,
        reservedBytes: probe * parameters.documentBytes,
      });
      if (!admitted) rejectedAdmissions += 1;
    }

    await Bun.sleep(parameters.pressureHoldMs);
    pressureAllocation = null;
    Bun.gc(true);
    sampleRss();
    let recoveryTimeMs = 0;
    if (mode === "enabled") {
      await controller.sampleNow();
      await controller.sampleNow();
      recoveryTimeMs = performance.now() - signalAt;
    }
    await queue.waitForIdle();
    sampleRss();
    const finishedAt = performance.now();
    const result: MemoryPressureBenchmarkResult = {
      completed,
      failed,
      mode,
      p50QueueLatencyMs: percentile(queueLatencies, 0.5),
      p95QueueLatencyMs: percentile(queueLatencies, 0.95),
      pauseDurationMs: Math.max(0, (firstStartedAt ?? signalAt) - signalAt),
      peakRssBytes,
      recoveryTimeMs,
      rejectedAdmissions,
      wallTimeMs: finishedAt - signalAt,
    };
    console.log(`MEMORY_PRESSURE_RESULT ${JSON.stringify(result)}`);
  } finally {
    void pressureAllocation;
    clearInterval(rssSampler);
    controller.stop();
    await queue.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
}

function touchPages(bytes: Uint8Array): void {
  for (let offset = 0; offset < bytes.length; offset += 4_096) bytes[offset] = 1;
  if (bytes.length) bytes[bytes.length - 1] = 1;
}

function percentile(samples: number[], quantile: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.ceil(Math.max(0, Math.min(1, quantile)) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

function resultRow(label: string, result: MemoryPressureBenchmarkResult): string {
  return `| ${label} | ${formatMiB(result.peakRssBytes)} | ${result.p50QueueLatencyMs.toFixed(2)} ms | ${result.p95QueueLatencyMs.toFixed(2)} ms | ${result.pauseDurationMs.toFixed(2)} ms | ${result.recoveryTimeMs.toFixed(2)} ms | ${result.completed} | ${result.failed} | ${result.rejectedAdmissions} | ${result.wallTimeMs.toFixed(2)} ms |`;
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("Memory-pressure benchmark parameters must be positive integers");
  }
  return parsed;
}

function argumentValue(prefix: string): string {
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || "";
}

if (import.meta.main) {
  const workerMode = argumentValue("--worker=");
  if (workerMode === "disabled" || workerMode === "enabled") {
    const rawParameters = argumentValue("--parameters=");
    if (!rawParameters) throw new Error("Memory-pressure benchmark worker requires parameters");
    await runWorker(workerMode, JSON.parse(decodeURIComponent(rawParameters)) as BenchmarkParameters);
  } else {
    await runCoordinator();
  }
}
