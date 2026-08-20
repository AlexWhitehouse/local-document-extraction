import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type StaticAssetBenchmarkResult = {
  currentRssBytes: number;
  mode: "buffered" | "lazy";
  p50LatencyMs: number;
  p95LatencyMs: number;
  peakRssBytes: number;
  requestCount: number;
  wallTimeMs: number;
};

type WorkerMetrics = {
  currentRssBytes: number;
  peakRssBytes: number;
};

const repositoryRoot = resolve(import.meta.dir, "../..");

export function percentile(samples: number[], quantile: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const position = Math.max(0, Math.min(1, quantile)) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const fraction = position - lowerIndex;
  return sorted[lowerIndex]! + (sorted[upperIndex]! - sorted[lowerIndex]!) * fraction;
}

export function renderStaticAssetBenchmark({
  assetBytes,
  bunRevision,
  bunVersion,
  concurrency,
  platform,
  results,
  rounds,
}: {
  assetBytes: number;
  bunRevision: string;
  bunVersion: string;
  concurrency: number;
  platform: string;
  results: StaticAssetBenchmarkResult[];
  rounds: number;
}): string {
  const buffered = results.find((result) => result.mode === "buffered");
  const lazy = results.find((result) => result.mode === "lazy");
  if (!buffered || !lazy) throw new Error("Both buffered and lazy benchmark results are required");
  const rssDifference = buffered.peakRssBytes - lazy.peakRssBytes;
  const rssPercent = buffered.peakRssBytes > 0
    ? (rssDifference / buffered.peakRssBytes) * 100
    : 0;
  const p95Difference = buffered.p95LatencyMs - lazy.p95LatencyMs;

  return [
    "# Static asset concurrency comparison",
    "",
    `- Runtime: Bun ${bunVersion} (${bunRevision})`,
    `- Platform: ${platform}`,
    `- Workload: same ${formatMiB(assetBytes)} asset, concurrency ${concurrency}, ${rounds} rounds (${concurrency * rounds} measured requests per mode)`,
    "- Server RSS is sampled in an isolated child process; client buffering occurs in the coordinator process.",
    "",
    "| Implementation | P50 request | P95 request | Measured wall time | Peak server RSS | Settled server RSS |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    resultRow("Legacy `readFile()` buffer", buffered),
    resultRow("Lazy `Bun.file()` response", lazy),
    "",
    `- RSS reduction (legacy minus lazy): ${formatMiB(rssDifference)} (${rssPercent.toFixed(1)}%).`,
    `- P95 latency reduction (legacy minus lazy): ${p95Difference.toFixed(2)} ms.`,
    "- These are focused local measurements, not a production capacity claim; repeat on CI hardware before setting a budget.",
    "",
  ].join("\n");
}

async function runCoordinator(): Promise<void> {
  const assetBytes = readPositiveInteger(process.env.STATIC_ASSET_BENCH_BYTES, 8 * 1024 * 1024);
  const concurrency = readPositiveInteger(process.env.STATIC_ASSET_BENCH_CONCURRENCY, 12);
  const rounds = readPositiveInteger(process.env.STATIC_ASSET_BENCH_ROUNDS, 2);
  const directory = await mkdtemp(join(tmpdir(), "document-extraction-asset-benchmark-"));
  const assetPath = join(directory, "large-app.js");

  try {
    const asset = await open(assetPath, "w");
    try {
      await asset.truncate(assetBytes);
    } finally {
      await asset.close();
    }
    const results = [] as StaticAssetBenchmarkResult[];
    for (const mode of ["buffered", "lazy"] as const) {
      results.push(await measureMode({ assetBytes, assetPath, concurrency, mode, rounds }));
    }
    const markdown = renderStaticAssetBenchmark({
      assetBytes,
      bunRevision: Bun.revision,
      bunVersion: Bun.version,
      concurrency,
      platform: `${process.platform} ${process.arch}`,
      results,
      rounds,
    });
    const evidenceDirectory = resolve(repositoryRoot, ".scratch/bun-1-4-review/evidence");
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(join(evidenceDirectory, "15-static-asset-concurrency.md"), markdown, "utf8");
    process.stdout.write(markdown);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function measureMode({
  assetBytes,
  assetPath,
  concurrency,
  mode,
  rounds,
}: {
  assetBytes: number;
  assetPath: string;
  concurrency: number;
  mode: "buffered" | "lazy";
  rounds: number;
}): Promise<StaticAssetBenchmarkResult> {
  const worker = await startWorker({ assetPath, mode });
  const latencies: number[] = [];
  let wallTimeMs = 0;
  try {
    await consumeAsset(worker.origin, assetBytes);
    for (let round = 0; round < rounds; round += 1) {
      const roundStarted = performance.now();
      await Promise.all(Array.from({ length: concurrency }, async () => {
        const requestStarted = performance.now();
        await consumeAsset(worker.origin, assetBytes);
        latencies.push(performance.now() - requestStarted);
      }));
      wallTimeMs += performance.now() - roundStarted;
    }
    await Bun.sleep(25);
    const metrics = await fetch(`${worker.origin}/metrics`).then((response) => {
      if (!response.ok) throw new Error(`Metrics request failed with HTTP ${response.status}`);
      return response.json() as Promise<WorkerMetrics>;
    });
    return {
      currentRssBytes: metrics.currentRssBytes,
      mode,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      peakRssBytes: metrics.peakRssBytes,
      requestCount: latencies.length,
      wallTimeMs,
    };
  } finally {
    await worker.stop();
  }
}

async function consumeAsset(origin: string, expectedBytes: number): Promise<void> {
  const response = await fetch(`${origin}/asset`);
  if (!response.ok) throw new Error(`Asset request failed with HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(`Asset response contained ${bytes.byteLength} bytes, expected ${expectedBytes}`);
  }
}

async function startWorker({
  assetPath,
  mode,
}: {
  assetPath: string;
  mode: "buffered" | "lazy";
}): Promise<{ origin: string; stop(): Promise<void> }> {
  const child = Bun.spawn([
    process.execPath,
    import.meta.path,
    `--worker=${mode}`,
    `--asset=${assetPath}`,
  ], {
    cwd: repositoryRoot,
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  let stderr = "";
  let stdout = "";
  let resolveReady!: (origin: string) => void;
  let rejectReady!: (error: Error) => void;
  let readySettled = false;
  const ready = new Promise<string>((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  const stdoutDone = captureStream(child.stdout, (text) => {
    stdout += text;
  }, (line) => {
    const prefix = "STATIC_ASSET_BENCH_READY ";
    if (!line.startsWith(prefix) || readySettled) return;
    try {
      const payload = JSON.parse(line.slice(prefix.length)) as { origin?: unknown };
      const origin = new URL(String(payload.origin || ""));
      if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port) {
        throw new Error("worker reported a non-loopback origin");
      }
      readySettled = true;
      resolveReady(origin.origin);
    } catch (error) {
      readySettled = true;
      rejectReady(error instanceof Error ? error : new Error(String(error)));
    }
  });
  const stderrDone = captureStream(child.stderr, (text) => {
    stderr += text;
  });
  void child.exited.then((exitCode) => {
    if (readySettled) return;
    readySettled = true;
    rejectReady(new Error(`worker exited with code ${exitCode} before readiness`));
  });
  const readinessTimeout = setTimeout(() => {
    if (readySettled) return;
    readySettled = true;
    rejectReady(new Error("worker readiness timed out"));
  }, 10_000);

  let origin: string;
  try {
    origin = await ready;
  } catch (error) {
    child.kill("SIGKILL");
    await child.exited;
    await Promise.all([stdoutDone, stderrDone]);
    throw new Error([
      `Static asset benchmark worker failed: ${errorMessage(error)}`,
      `stdout:\n${stdout || "<empty>"}`,
      `stderr:\n${stderr || "<empty>"}`,
    ].join("\n"), { cause: error });
  } finally {
    clearTimeout(readinessTimeout);
  }

  let stopPromise: Promise<void> | null = null;
  return {
    origin,
    stop: () => {
      stopPromise ??= (async () => {
        if (child.exitCode === null) {
          await fetch(`${origin}/shutdown`, { method: "POST" }).catch(() => {
            child.kill("SIGTERM");
          });
        }
        const exitCode = await child.exited;
        await Promise.all([stdoutDone, stderrDone]);
        if (exitCode !== 0) {
          throw new Error(`Static asset benchmark worker exited with code ${exitCode}: ${stderr}`);
        }
      })();
      return stopPromise;
    },
  };
}

async function runWorker(mode: "buffered" | "lazy", assetPath: string): Promise<void> {
  let peakRssBytes = process.memoryUsage().rss;
  const sample = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 1);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/asset") {
        return mode === "buffered"
          ? new Response(await readFile(assetPath))
          : new Response(Bun.file(assetPath));
      }
      if (pathname === "/metrics") {
        sampleRss();
        return Response.json({
          currentRssBytes: process.memoryUsage().rss,
          peakRssBytes,
        });
      }
      if (pathname === "/shutdown" && request.method === "POST") {
        setTimeout(() => {
          clearInterval(sample);
          void server.stop(true).finally(() => process.exit(0));
        }, 0);
        return new Response(null, { status: 202 });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  const sampleRss = () => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  };
  console.log(`STATIC_ASSET_BENCH_READY ${JSON.stringify({
    mode,
    origin: `http://127.0.0.1:${server.port}`,
  })}`);
}

async function captureStream(
  stream: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  onLine: (line: string) => void = () => {},
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      onText(text);
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) onLine(line);
    }
    const finalText = decoder.decode();
    if (finalText) {
      onText(finalText);
      pending += finalText;
    }
    if (pending) onLine(pending);
  } finally {
    reader.releaseLock();
  }
}

function resultRow(label: string, result: StaticAssetBenchmarkResult): string {
  return `| ${label} | ${result.p50LatencyMs.toFixed(2)} ms | ${result.p95LatencyMs.toFixed(2)} ms | ${result.wallTimeMs.toFixed(2)} ms | ${formatMiB(result.peakRssBytes)} | ${formatMiB(result.currentRssBytes)} |`;
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("Static asset benchmark parameters must be positive integers");
  }
  return parsed;
}

function argumentValue(prefix: string): string {
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.main) {
  const workerMode = argumentValue("--worker=");
  if (workerMode === "buffered" || workerMode === "lazy") {
    const assetPath = argumentValue("--asset=");
    if (!assetPath) throw new Error("Static asset benchmark worker requires --asset");
    await runWorker(workerMode, assetPath);
  } else {
    await runCoordinator();
  }
}
