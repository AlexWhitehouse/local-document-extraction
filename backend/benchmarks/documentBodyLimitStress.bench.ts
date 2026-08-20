import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { HttpError } from "../src/lib/http";
import {
  assertKnownDocumentRequestBodyLength,
  localDocumentRequestBodyLimit,
  localDocumentServerBodyLimit,
} from "../src/localDocumentBodyLimit";
import { parseLocalMultipartSubmission } from "../src/localMultipartSubmission";

export type DocumentBodyLimitStressResult = {
  abortedConnectionsSettled: number;
  abortedRequests: number;
  chunkedRequests: number;
  extractionJobsCreated: number;
  knownRequests: number;
  p50ResponseLatencyMs: number;
  p95ResponseLatencyMs: number;
  peakRssBytes: number;
  peakRssGrowthBytes: number;
  pendingHandlers: number;
  promotedSourceFiles: number;
  structuredOversizeResponses: number;
  temporaryFilesRetained: number;
  unexpectedResponses: number;
  wallTimeMs: number;
};

export type DocumentBodyLimitStressParameters = {
  abortedRequests: number;
  chunkedRequests: number;
  concurrency: number;
  knownRequests: number;
  maxSourceBytes: number;
};

const repositoryRoot = resolve(import.meta.dir, "../..");

export function renderDocumentBodyLimitStress({
  bunRevision,
  bunVersion,
  maxSourceBytes,
  platform,
  result,
}: {
  bunRevision: string;
  bunVersion: string;
  maxSourceBytes: number;
  platform: string;
  result: DocumentBodyLimitStressResult;
}): string {
  return [
    "# Document transport body-limit stress",
    "",
    `- Runtime: Bun ${bunVersion} (${bunRevision})`,
    `- Platform: ${platform}`,
    `- Source limit: ${formatKiB(maxSourceBytes)}; logical request limit: ${formatKiB(localDocumentRequestBodyLimit(maxSourceBytes))}; Bun emergency cap: ${formatKiB(localDocumentServerBodyLimit(maxSourceBytes))}.`,
    `- Requests: ${result.knownRequests} known-length oversize, ${result.chunkedRequests} chunked oversize, ${result.abortedRequests} client-aborted partial uploads.`,
    "- The workload runs in an isolated child process against a real loopback Bun server and uses bounded payloads.",
    "",
    "| Metric | Result |",
    "| --- | ---: |",
    row("Structured oversize responses", result.structuredOversizeResponses),
    row("Unexpected responses", result.unexpectedResponses),
    row("P50 response latency", `${result.p50ResponseLatencyMs.toFixed(2)} ms`),
    row("P95 response latency", `${result.p95ResponseLatencyMs.toFixed(2)} ms`),
    row("Peak RSS", formatMiB(result.peakRssBytes)),
    row("Peak RSS growth", formatMiB(result.peakRssGrowthBytes)),
    row("Aborted connections settled", result.abortedConnectionsSettled),
    row("Pending handlers after settlement", result.pendingHandlers),
    row("Temporary files retained", result.temporaryFilesRetained),
    row("Promoted Source files", result.promotedSourceFiles),
    row("Extraction jobs created", result.extractionJobsCreated),
    row("Measured wall time", `${result.wallTimeMs.toFixed(2)} ms`),
    "",
    "All oversize outcomes are expected to be retry-safe and side-effect free. This is focused local evidence, not a production capacity claim.",
    "",
  ].join("\n");
}

export async function runDocumentBodyLimitStress(
  parameters: DocumentBodyLimitStressParameters,
): Promise<DocumentBodyLimitStressResult> {
  validateParameters(parameters);
  const child = Bun.spawn([
    process.execPath,
    "--no-env-file",
    import.meta.path,
    `--worker-parameters=${encodeURIComponent(JSON.stringify(parameters))}`,
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
      `Document body-limit stress worker exited with code ${exitCode}`,
      `stdout: ${stdout.slice(-4_000) || "<empty>"}`,
      `stderr: ${stderr.slice(-4_000) || "<empty>"}`,
    ].join("\n"));
  }
  const line = stdout.trim().split(/\r?\n/).findLast((entry) => entry.startsWith("DOCUMENT_BODY_STRESS_RESULT "));
  if (!line) throw new Error("Document body-limit stress worker returned no result");
  return JSON.parse(line.slice("DOCUMENT_BODY_STRESS_RESULT ".length)) as DocumentBodyLimitStressResult;
}

async function runCoordinator(): Promise<void> {
  const parameters: DocumentBodyLimitStressParameters = {
    abortedRequests: positiveEnvironmentInteger("DOCUMENT_BODY_STRESS_ABORTED", 4),
    chunkedRequests: positiveEnvironmentInteger("DOCUMENT_BODY_STRESS_CHUNKED", 12),
    concurrency: positiveEnvironmentInteger("DOCUMENT_BODY_STRESS_CONCURRENCY", 8),
    knownRequests: positiveEnvironmentInteger("DOCUMENT_BODY_STRESS_KNOWN", 12),
    maxSourceBytes: positiveEnvironmentInteger("DOCUMENT_BODY_STRESS_SOURCE_BYTES", 256 * 1024),
  };
  const result = await runDocumentBodyLimitStress(parameters);
  const markdown = renderDocumentBodyLimitStress({
    bunRevision: Bun.revision,
    bunVersion: Bun.version,
    maxSourceBytes: parameters.maxSourceBytes,
    platform: `${process.platform} ${process.arch}`,
    result,
  });
  const evidenceDirectory = resolve(repositoryRoot, ".scratch/bun-1-4-review/evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(join(evidenceDirectory, "17-document-body-limit-stress.md"), markdown, "utf8");
  process.stdout.write(markdown);
}

async function runWorker(parameters: DocumentBodyLimitStressParameters): Promise<void> {
  validateParameters(parameters);
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-body-stress-"));
  let activeHandlers = 0;
  let chunkedRequests = 0;
  let extractionJobsCreated = 0;
  let knownRequests = 0;
  let promotedSourceFiles = 0;
  const initialRssBytes = process.memoryUsage().rss;
  let peakRssBytes = initialRssBytes;
  const rssSampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 1);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    maxRequestBodySize: localDocumentServerBodyLimit(parameters.maxSourceBytes),
    port: 0,
    async fetch(request) {
      activeHandlers += 1;
      const kind = request.headers.get("x-stress-kind");
      if (kind === "known") knownRequests += 1;
      if (kind === "chunked" && request.headers.get("content-length") === null) chunkedRequests += 1;
      try {
        assertKnownDocumentRequestBodyLength(request, parameters.maxSourceBytes);
        const parsed = await parseLocalMultipartSubmission({
          maxSourceFileBytes: parameters.maxSourceBytes,
          request,
          stateDirectory,
        });
        promotedSourceFiles += 1;
        extractionJobsCreated += 1;
        await rm(parsed.source.temporaryPath, { force: true });
        return new Response(null, { status: 202 });
      } catch (error) {
        if (error instanceof HttpError) {
          return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
        }
        return Response.json(
          { error: { code: "document_submission_failed", message: "Document submission failed" } },
          { status: 500 },
        );
      } finally {
        activeHandlers -= 1;
      }
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const latencies: number[] = [];
  let structuredOversizeResponses = 0;
  let unexpectedResponses = 0;
  const startedAt = performance.now();

  try {
    const probes: Array<() => Promise<void>> = [];
    for (let index = 0; index < parameters.knownRequests; index += 1) {
      probes.push(async () => {
        const requestStartedAt = performance.now();
        const response = await fetch(`${origin}/v1/extract`, {
          body: new Uint8Array(localDocumentRequestBodyLimit(parameters.maxSourceBytes) + 1),
          headers: {
            "content-type": "multipart/form-data; boundary=known-oversize",
            "x-stress-kind": "known",
          },
          method: "POST",
        });
        latencies.push(performance.now() - requestStartedAt);
        if (await isStructuredOversize(response)) structuredOversizeResponses += 1;
        else unexpectedResponses += 1;
      });
    }
    for (let index = 0; index < parameters.chunkedRequests; index += 1) {
      probes.push(async () => {
        const requestStartedAt = performance.now();
        const { body, contentType } = chunkedOversizeMultipart(parameters.maxSourceBytes);
        const response = await fetch(`${origin}/v1/extract`, {
          body,
          duplex: "half",
          headers: { "content-type": contentType, "x-stress-kind": "chunked" },
          method: "POST",
        } as RequestInit);
        latencies.push(performance.now() - requestStartedAt);
        if (await isStructuredOversize(response)) structuredOversizeResponses += 1;
        else unexpectedResponses += 1;
      });
    }
    await runWithConcurrency(probes, parameters.concurrency);
    const abortedConnectionsSettled = (await Promise.all(Array.from(
      { length: parameters.abortedRequests },
      () => abortPartialMultipart(server.port, parameters.maxSourceBytes),
    ))).filter(Boolean).length;
    await waitFor(() => activeHandlers === 0, 2_000);
    await Bun.sleep(10);
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    const temporaryDirectory = join(stateDirectory, "temporary", "submissions");
    const temporaryFilesRetained = (await readdir(temporaryDirectory).catch(() => [])).length;
    const result: DocumentBodyLimitStressResult = {
      abortedConnectionsSettled,
      abortedRequests: parameters.abortedRequests,
      chunkedRequests,
      extractionJobsCreated,
      knownRequests,
      p50ResponseLatencyMs: percentile(latencies, 0.5),
      p95ResponseLatencyMs: percentile(latencies, 0.95),
      peakRssBytes,
      peakRssGrowthBytes: Math.max(0, peakRssBytes - initialRssBytes),
      pendingHandlers: activeHandlers,
      promotedSourceFiles,
      structuredOversizeResponses,
      temporaryFilesRetained,
      unexpectedResponses,
      wallTimeMs: performance.now() - startedAt,
    };
    console.log(`DOCUMENT_BODY_STRESS_RESULT ${JSON.stringify(result)}`);
  } finally {
    clearInterval(rssSampler);
    await server.stop(true);
    await rm(stateDirectory, { recursive: true, force: true });
  }
}

function chunkedOversizeMultipart(maxSourceBytes: number): {
  body: ReadableStream<Uint8Array>;
  contentType: string;
} {
  const boundary = `document-extraction-${crypto.randomUUID()}`;
  const prefix = new TextEncoder().encode([
    `--${boundary}`,
    'Content-Disposition: form-data; name="template_id"',
    "",
    "template_stress",
    `--${boundary}`,
    'Content-Disposition: form-data; name="document"; filename="oversized.png"',
    "Content-Type: image/png",
    "",
    "",
  ].join("\r\n"));
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const bytes = new Uint8Array(prefix.byteLength + maxSourceBytes + 1 + suffix.byteLength);
  bytes.set(prefix, 0);
  bytes.set(suffix, prefix.byteLength + maxSourceBytes + 1);
  let offset = 0;
  return {
    body: new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        const end = Math.min(bytes.length, offset + 4 * 1024);
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
    }),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function abortPartialMultipart(port: number, maxSourceBytes: number): Promise<boolean> {
  const boundary = `aborted-${crypto.randomUUID()}`;
  const partialBody = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="template_id"',
    "",
    "template_aborted",
    `--${boundary}`,
    'Content-Disposition: form-data; name="document"; filename="aborted.pdf"',
    "Content-Type: application/pdf",
    "",
    "%PDF-partial",
  ].join("\r\n");
  return new Promise((resolvePromise) => {
    const socket = connect({ host: "127.0.0.1", port });
    let settled = false;
    let destroyTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (destroyTimer) clearTimeout(destroyTimer);
      resolvePromise(true);
    };
    deadlineTimer = setTimeout(() => {
      socket.destroy();
      settle();
    }, 1_000);
    socket.once("connect", () => {
      socket.write([
        "POST /v1/extract HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        `Content-Type: multipart/form-data; boundary=${boundary}`,
        `Content-Length: ${localDocumentRequestBodyLimit(maxSourceBytes)}`,
        "X-Stress-Kind: aborted",
        "Connection: close",
        "",
        partialBody,
      ].join("\r\n"));
      destroyTimer = setTimeout(() => socket.destroy(), 2);
    });
    socket.once("close", settle);
    socket.once("error", settle);
  });
}

async function isStructuredOversize(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null;
  return body?.error?.code === "source_file_too_large";
}

async function runWithConcurrency(tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++]!;
      await task();
    }
  }));
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() >= deadline) throw new Error("Timed out waiting for body-limit handlers to settle");
    await Bun.sleep(2);
  }
}

function percentile(samples: number[], quantile: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.ceil(Math.max(0, Math.min(1, quantile)) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

function row(label: string, value: string | number): string {
  return `| ${label} | ${value} |`;
}

function formatKiB(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function positiveEnvironmentInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function validateParameters(parameters: DocumentBodyLimitStressParameters): void {
  for (const [name, value] of Object.entries(parameters)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  }
}

function argumentValue(prefix: string): string {
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || "";
}

if (import.meta.main) {
  const rawParameters = argumentValue("--worker-parameters=");
  if (rawParameters) {
    await runWorker(JSON.parse(decodeURIComponent(rawParameters)) as DocumentBodyLimitStressParameters);
  } else {
    await runCoordinator();
  }
}
