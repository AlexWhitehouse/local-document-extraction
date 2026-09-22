/**
 * PROTOTYPE — disposable capacity harness.
 *
 * Question: can bounded multipart admission and runner concurrency prevent a
 * remote-gateway backlog from retaining unbounded PDF buffers without giving up
 * material completed-job throughput?
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { PDFDocument } from "pdf-lib";

import { createLocalApplication } from "../src/localApplication";
import { createLocalAuth } from "../src/localAuth";
import {
  createLocalExtractionQueue,
  type LocalExtractionQueue,
  type LocalQueuedExtractionJob,
} from "../src/localExtractionQueue";
import { createLocalExtractionRunner } from "../src/localExtractionRunner";
import { ensureLocalStateDirectories } from "../src/localRuntime";
import { createLocalSourceFileStore } from "../src/localSourceFileStore";
import { createLocalWorkspaceControl } from "../src/localWorkspaceControl";
import { createLocalWorkspaceProductOperations } from "../src/localWorkspaceProductOperations";
import { createLocalWorkspaceProductStore } from "../src/localWorkspaceProductStore";
import { createLocalWorkspaceProductStoreRegistry } from "../src/localWorkspaceProductStoreRegistry";
import { configureTestWorkspace } from "../src/testing/workspaceModelFixture";

type Profile = "baseline" | "bounded";

type PrototypeConfiguration = {
  workers: number;
  gatewayConcurrency: number;
  gatewayLatencyMs: number;
  boundedRunnerConcurrency: number;
  boundedAdmissionConcurrency: number;
  pollIntervalMs: number;
};

type QueueSnapshot = {
  active: number;
  peakActive: number;
  pending: number;
  peakPending: number;
};

type PrototypeQueue = Pick<LocalExtractionQueue, "schedule" | "subscribe"> & {
  snapshot(): QueueSnapshot;
};

type ServerReport = {
  profile: Profile;
  elapsedMs: number;
  completed: number;
  accepted: number;
  admissionRejected: number;
  peakAdmission: number;
  peakRssBytes: number;
  baselineRssBytes: number;
  peakRssFraction: number;
  normalizedCpuFraction: number;
  cpuUserMicroseconds: number;
  cpuSystemMicroseconds: number;
  machineParallelism: number;
  maxEventLoopLagMs: number;
  queue: QueueSnapshot;
  gatewayPeakActive: number;
  pollNotModified: number;
  pollOk: number;
  sqliteBusyOutcomes: number;
  sqliteBusyRetries: number;
  timing: {
    firstSubmissionReceivedAt: string | null;
    firstJobCompletedAt: string | null;
    lastJobCompletedAt: string | null;
    measurementElapsedMs: number;
    lifecycleLatencyMs: number[];
    throughputJobsPerSecond: number;
  };
};

type ClientReport = {
  completed: number;
  failed: number;
  errors: string[];
  submissionRetries: number;
  pollRequests: number;
  submissionLatencyMs: number[];
  pollLatencyMs: number[];
  lifecycleLatencyMs: number[];
  elapsedMs: number;
};

const childProfile = argumentValue("--server") as Profile | null;

if (childProfile) {
  await runServer(childProfile);
} else {
  await runComparison();
}

async function runComparison(): Promise<void> {
  const configuration = readConfiguration();
  const fixtures = await createWorkloadFixtures();
  const fixtureBytes = fixtures.map((fixture) => fixture.byteLength);
  const fixtureSha256 = fixtures.map((fixture) => createHash("sha256").update(fixture).digest("hex"));
  const structuredOnly = process.env.PROTOTYPE_STRUCTURED_ONLY === "1";
  const profiles: Profile[] = process.env.PROTOTYPE_PROFILE === "baseline"
    ? ["baseline"]
    : process.env.PROTOTYPE_PROFILE === "bounded"
      ? ["bounded"]
      : ["baseline", "bounded"];

  if (!structuredOnly) {
    console.log("PROTOTYPE — high-throughput local PDF extraction");
    console.log(JSON.stringify({ configuration, fixtureBytes, fixtureSha256 }, null, 2));
  }

  const results: Array<{ profile: Profile; server: ServerReport; client: ClientReport }> = [];
  for (const profile of profiles) {
    if (!structuredOnly) console.log(`\nRunning ${profile} profile...`);
    results.push(await runProfileClient(profile, configuration, fixtures));
  }

  if (!structuredOnly) {
    console.log("\nResults");
    console.table(results.map(({ profile, server, client }) => ({
      profile,
      completed: server.completed,
      failed: client.failed,
      "server jobs/s": round(server.timing.throughputJobsPerSecond),
      "server lifecycle p95 ms": round(percentile(server.timing.lifecycleLatencyMs, 0.95)),
      "client observation p95 ms": round(percentile(client.lifecycleLatencyMs, 0.95)),
      "submit p95 ms": round(percentile(client.submissionLatencyMs, 0.95)),
      "poll p95 ms": round(percentile(client.pollLatencyMs, 0.95)),
      polls: client.pollRequests,
      "503 retries": client.submissionRetries,
      "server peak RSS MiB": round(server.peakRssBytes / 1024 / 1024),
      "server RSS delta MiB": round((server.peakRssBytes - server.baselineRssBytes) / 1024 / 1024),
      "memory %": round(server.peakRssFraction * 100),
      "CPU % of machine": round(server.normalizedCpuFraction * 100),
      "event-loop max lag ms": round(server.maxEventLoopLagMs),
      "runner peak": server.queue.peakActive,
      "queue peak": server.queue.peakPending,
      "gateway peak": server.gatewayPeakActive,
      "SQLite busy/retry": `${server.sqliteBusyOutcomes}/${server.sqliteBusyRetries}`,
      "poll 304": server.pollNotModified,
    })));
    for (const { profile, client } of results) {
      if (client.errors.length > 0) {
        console.log(`${profile} sample errors:`);
        console.log(client.errors.join("\n"));
      }
    }
  }

  if (!structuredOnly && results.length === 2) {
    const baseline = results[0]!;
    const bounded = results[1]!;
    console.log("\nPrototype verdict inputs");
    console.log(JSON.stringify({
      throughputRatio: round(
        bounded.server.timing.throughputJobsPerSecond
          / baseline.server.timing.throughputJobsPerSecond,
      ),
      peakRssDeltaRatio: round(
        (bounded.server.peakRssBytes - bounded.server.baselineRssBytes)
          / Math.max(1, baseline.server.peakRssBytes - baseline.server.baselineRssBytes),
      ),
      baselineRunnerPeak: baseline.server.queue.peakActive,
      boundedRunnerPeak: bounded.server.queue.peakActive,
      baselineWithinEnvelope: baseline.server.peakRssFraction < 0.8 && baseline.server.normalizedCpuFraction < 0.85,
      boundedWithinEnvelope: bounded.server.peakRssFraction < 0.8 && bounded.server.normalizedCpuFraction < 0.85,
    }, null, 2));
  }
  console.log(`${resultPrefix()}${JSON.stringify({
    bunRevision: Bun.revision,
    bunVersion: Bun.version,
    configuration,
    fixtureBytes,
    fixtureSha256,
    results,
  })}`);
}

async function runProfileClient(
  profile: Profile,
  configuration: PrototypeConfiguration,
  fixtures: Uint8Array[],
): Promise<{ profile: Profile; server: ServerReport; client: ClientReport }> {
  const coordinationDirectory = await mkdtemp(join(tmpdir(), `document-extraction-prototype-${profile}-`));
  const readyFile = join(coordinationDirectory, "ready.json");
  const serverProcess = Bun.spawn([
    process.execPath,
    ...serverRuntimeFlags(),
    import.meta.path,
    "--server",
    profile,
  ], {
    env: {
      ...process.env,
      PROTOTYPE_READY_FILE: readyFile,
      PROTOTYPE_CONFIGURATION: JSON.stringify(configuration),
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  try {
    const ready = await waitForJsonFile<{ origin: string; apiKey: string; templateId: string }>(readyFile, serverProcess);
    const startedAt = performance.now();
    const reports = await Promise.all(Array.from({ length: configuration.workers }, (_, index) =>
      runExternalWorker({
        apiKey: ready.apiKey,
        fixture: chooseFixture(fixtures, index, configuration.workers),
        index,
        origin: ready.origin,
        pollIntervalMs: configuration.pollIntervalMs,
        templateId: ready.templateId,
      })));
    const elapsedMs = performance.now() - startedAt;
    await Bun.sleep(100);
    const server = await fetch(`${ready.origin}/__prototype/report`).then((response) => response.json()) as ServerReport;
    await fetch(`${ready.origin}/__prototype/shutdown`, { method: "POST" });
    await serverProcess.exited;
    const stderr = await new Response(serverProcess.stderr).text();
    if (serverProcess.exitCode !== 0) {
      throw new Error(`Prototype server exited with ${serverProcess.exitCode}: ${stderr}`);
    }
    return {
      profile,
      server,
      client: {
        completed: reports.filter((report) => report.completed).length,
        failed: reports.filter((report) => !report.completed).length,
        errors: reports.flatMap((report) => report.error ? [report.error] : []).slice(0, 5),
        submissionRetries: sum(reports.map((report) => report.submissionRetries)),
        pollRequests: sum(reports.map((report) => report.pollRequests)),
        submissionLatencyMs: reports.map((report) => report.submissionLatencyMs),
        pollLatencyMs: reports.flatMap((report) => report.pollLatencyMs),
        lifecycleLatencyMs: reports.map((report) => report.lifecycleLatencyMs),
        elapsedMs,
      },
    };
  } catch (error) {
    serverProcess.kill();
    await serverProcess.exited;
    const stderr = await new Response(serverProcess.stderr).text().catch(() => "");
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`, { cause: error });
  } finally {
    await rm(coordinationDirectory, { recursive: true, force: true });
  }
}

async function runExternalWorker({
  apiKey,
  fixture,
  index,
  origin,
  pollIntervalMs,
  templateId,
}: {
  apiKey: string;
  fixture: Uint8Array;
  index: number;
  origin: string;
  pollIntervalMs: number;
  templateId: string;
}): Promise<{
  completed: boolean;
  error?: string;
  submissionRetries: number;
  submissionLatencyMs: number;
  lifecycleLatencyMs: number;
  pollRequests: number;
  pollLatencyMs: number[];
}> {
  let submissionRetries = 0;
  const lifecycleStartedAt = performance.now();
  const submissionStartedAt = lifecycleStartedAt;
  let jobId = "";
  while (!jobId) {
    const form = new FormData();
    form.append("template_id", templateId);
    form.append("document", new File([fixture], `prototype-${index}.pdf`, { type: "application/pdf" }));
    let response: Response;
    try {
      response = await fetch(`${origin}/v1/extract`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } catch {
      submissionRetries += 1;
      if (submissionRetries >= 10) {
        return {
          completed: false,
          error: `Submission ${index} exhausted network retries`,
          submissionRetries,
          submissionLatencyMs: performance.now() - submissionStartedAt,
          lifecycleLatencyMs: performance.now() - lifecycleStartedAt,
          pollRequests: 0,
          pollLatencyMs: [],
        };
      }
      await Bun.sleep(Math.min(500, 20 * 2 ** Math.min(4, submissionRetries)) * jitterMultiplier());
      continue;
    }
    if (response.status === 503) {
      await response.arrayBuffer();
      submissionRetries += 1;
      const retryAfterMs = Math.max(0, Number(response.headers.get("retry-after")) * 1_000 || 0);
      await Bun.sleep(Math.max(
        retryAfterMs,
        Math.min(1_000, 25 * 2 ** Math.min(5, submissionRetries)),
      ) * jitterMultiplier());
      continue;
    }
    if (response.status !== 202) {
      return {
        completed: false,
        error: `Submission ${index} failed (${response.status}): ${await response.text()}`,
        submissionRetries,
        submissionLatencyMs: performance.now() - submissionStartedAt,
        lifecycleLatencyMs: performance.now() - lifecycleStartedAt,
        pollRequests: 0,
        pollLatencyMs: [],
      };
    }
    jobId = ((await response.json()) as { job_id: string }).job_id;
  }
  const submissionLatencyMs = performance.now() - submissionStartedAt;
  let pollRequests = 0;
  const pollLatencyMs: number[] = [];
  let entityTag = "";
  let pollNetworkFailures = 0;
  let nextPollDelayMs = pollIntervalMs;
  for (;;) {
    await Bun.sleep(nextPollDelayMs);
    const pollStartedAt = performance.now();
    const pollHeaders = new Headers({ authorization: `Bearer ${apiKey}` });
    if (entityTag) pollHeaders.set("if-none-match", entityTag);
    let response: Response;
    try {
      response = await fetch(`${origin}/v1/jobs/${encodeURIComponent(jobId)}`, { headers: pollHeaders });
      pollNetworkFailures = 0;
    } catch {
      pollNetworkFailures += 1;
      if (pollNetworkFailures >= 5) {
        return {
          completed: false,
          error: `Poll ${jobId} exhausted network retries`,
          submissionRetries,
          submissionLatencyMs,
          lifecycleLatencyMs: performance.now() - lifecycleStartedAt,
          pollRequests,
          pollLatencyMs,
        };
      }
      await Bun.sleep(Math.min(1000, 50 * 2 ** pollNetworkFailures) * jitterMultiplier());
      continue;
    }
    pollLatencyMs.push(performance.now() - pollStartedAt);
    pollRequests += 1;
    nextPollDelayMs = Math.max(
      pollIntervalMs,
      Math.max(0, Number(response.headers.get("retry-after")) * 1_000 || 0),
    ) * jitterMultiplier();
    if (response.status === 304) {
      continue;
    }
    if (!response.ok) {
      return {
        completed: false,
        error: `Poll ${jobId} failed (${response.status}): ${await response.text()}`,
        submissionRetries,
        submissionLatencyMs,
        lifecycleLatencyMs: performance.now() - lifecycleStartedAt,
        pollRequests,
        pollLatencyMs,
      };
    }
    entityTag = response.headers.get("etag") || entityTag;
    const job = await response.json() as { status: string };
    if (job.status === "completed") {
      return {
        completed: true,
        submissionRetries,
        submissionLatencyMs,
        lifecycleLatencyMs: performance.now() - lifecycleStartedAt,
        pollRequests,
        pollLatencyMs,
      };
    }
    if (job.status === "failed") {
      return {
        completed: false,
        error: `Prototype job ${jobId} failed`,
        submissionRetries,
        submissionLatencyMs,
        lifecycleLatencyMs: performance.now() - lifecycleStartedAt,
        pollRequests,
        pollLatencyMs,
      };
    }
  }
}

async function runServer(profile: Profile): Promise<void> {
  if (profile !== "baseline" && profile !== "bounded") {
    throw new Error(`Unknown prototype profile: ${profile}`);
  }
  const configuration = JSON.parse(process.env.PROTOTYPE_CONFIGURATION || "null") as PrototypeConfiguration | null;
  const readyFile = process.env.PROTOTYPE_READY_FILE;
  if (!configuration || !readyFile) {
    throw new Error("Prototype child configuration is missing");
  }

  const stateDirectory = await mkdtemp(join(tmpdir(), `document-extraction-prototype-server-${profile}-`));
  await ensureLocalStateDirectories(stateDirectory);
  const controlDatabase = new Database(":memory:");
  const auth = await createLocalAuth({
    baseURL: "http://127.0.0.1",
    database: controlDatabase,
    mailSink: { capture: async () => undefined },
    secret: "prototype-only-012345678901234567",
  });
  const workspaceControl = createLocalWorkspaceControl(controlDatabase);
  const signUp = await auth.handler(new Request("http://127.0.0.1/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Prototype", email: "prototype@example.com", password: "Strong1!" }),
  }));
  if (!signUp.ok) {
    throw new Error(`Prototype sign-up failed: ${signUp.status}`);
  }
  const user = await signUp.json() as { user: { id: string; name: string } };
  const workspace = workspaceControl.listAcceptedWorkspaces({ userId: user.user.id, userName: user.user.name })[0]!;
  workspaceControl.completeStarterTemplateBootstrap({ workspaceId: workspace.id });
  const apiKey = workspaceControl.rotateApiKey({ workspaceId: workspace.id, userId: user.user.id }).api_key;
  const templateId = "tpl_throughput_prototype";
  configureTestWorkspace({ stateDirectory, workspaceId: workspace.id });
  const setupStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: workspace.id });
  setupStore.createTemplate({
    templateId,
    name: "Throughput prototype",
    description: "Disposable load-test Template",
    fields: [{ id: "reference", name: "Reference", description: "Reference", data_type: "string" }],
    createdAt: new Date().toISOString(),
  });
  setupStore.close();

  const sourceFileStore = createLocalSourceFileStore({ stateDirectory });
  const workspaceProductOperations = createLocalWorkspaceProductOperations();
  const productStoreRegistry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  const queue = profile === "baseline"
    ? createInstrumentedBaselineQueue()
    : createBoundedPrototypeQueue(configuration.boundedRunnerConcurrency);
  const gateway = createFakeGateway(configuration.gatewayConcurrency, configuration.gatewayLatencyMs);
  const completedJobIds = new Set<string>();
  const lifecycleLatencyMs: number[] = [];
  let firstSubmissionReceivedAt: string | null = null;
  let firstSubmissionReceivedAtMs: number | null = null;
  let firstJobCompletedAt: string | null = null;
  let lastJobCompletedAt: string | null = null;
  let lastJobCompletedAtMs: number | null = null;
  let completed = 0;
  const runner = createLocalExtractionRunner({
    extract: gateway.extract,
    onJobLifecycleChange: (_workspaceId, job) => {
      if (job.status !== "completed" || completedJobIds.has(job.job_id)) return;
      const recordedAtMs = performance.now();
      const completedAt = job.completed_at ?? new Date().toISOString();
      const createdAtMs = Date.parse(job.created_at);
      const completedAtMs = Date.parse(completedAt);
      completedJobIds.add(job.job_id);
      completed = completedJobIds.size;
      firstJobCompletedAt ??= completedAt;
      lastJobCompletedAt = completedAt;
      lastJobCompletedAtMs = recordedAtMs;
      if (Number.isFinite(createdAtMs) && Number.isFinite(completedAtMs)) {
        lifecycleLatencyMs.push(Math.max(0, completedAtMs - createdAtMs));
      }
    },
    sourceFileStore,
    stateDirectory,
    workspaceControl,
    workspaceProductOperations,
    productStoreRegistry,
  });
  queue.subscribe((job) => runner.run(job));
  const application = createLocalApplication({
    auth,
    scheduleQueuedJob: queue.schedule,
    sourceFileStore,
    stateDirectory,
    workspaceControl,
    workspaceProductOperations,
    productStoreRegistry,
  });

  let admissionActive = 0;
  let peakAdmission = 0;
  let accepted = 0;
  let admissionRejected = 0;
  let pollNotModified = 0;
  let pollOk = 0;
  let sqliteBusyOutcomes = 0;
  const sqliteBusyRetries = 0;
  const sampler = createResourceSampler();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/__prototype/report") {
        const measurementElapsedMs = firstSubmissionReceivedAtMs !== null && lastJobCompletedAtMs !== null
          ? Math.max(0, lastJobCompletedAtMs - firstSubmissionReceivedAtMs)
          : 0;
        return Response.json({
          profile,
          ...sampler.snapshot(),
          completed,
          accepted,
          admissionRejected,
          peakAdmission,
          queue: queue.snapshot(),
          gatewayPeakActive: gateway.peakActive(),
          pollNotModified,
          pollOk,
          sqliteBusyOutcomes,
          sqliteBusyRetries,
          timing: {
            firstSubmissionReceivedAt,
            firstJobCompletedAt,
            lastJobCompletedAt,
            measurementElapsedMs,
            lifecycleLatencyMs: [...lifecycleLatencyMs],
            throughputJobsPerSecond: measurementElapsedMs > 0
              ? completed / (measurementElapsedMs / 1_000)
              : 0,
          },
        } satisfies ServerReport);
      }
      if (pathname === "/__prototype/shutdown" && request.method === "POST") {
        setTimeout(() => {
          sampler.stop();
          server.stop(true);
          productStoreRegistry.closeAll();
          controlDatabase.close();
          void rm(stateDirectory, { recursive: true, force: true }).finally(() => process.exit(0));
        }, 10);
        return Response.json({ ok: true });
      }
      const isSubmission = pathname === "/v1/extract" && request.method === "POST";
      if (isSubmission && firstSubmissionReceivedAtMs === null) {
        firstSubmissionReceivedAtMs = performance.now();
        firstSubmissionReceivedAt = new Date().toISOString();
      }
      if (isSubmission && profile === "bounded" && admissionActive >= configuration.boundedAdmissionConcurrency) {
        admissionRejected += 1;
        await drainRequestBody(request.body);
        return Response.json(
          { error: { code: "local_capacity_unavailable", message: "Prototype admission capacity is full" } },
          { status: 503, headers: { "retry-after": "1" } },
        );
      }
      if (isSubmission) {
        admissionActive += 1;
        peakAdmission = Math.max(peakAdmission, admissionActive);
      }
      try {
        let response: Response;
        try {
          response = await application(request);
        } catch (error) {
          if (isSqliteBusy(error)) sqliteBusyOutcomes += 1;
          throw error;
        }
        if (isSubmission && response.status === 202) {
          accepted += 1;
        }
        if (pathname.startsWith("/v1/jobs/") && request.method === "GET" && response.status === 200) {
          pollOk += 1;
        }
        if (pathname.startsWith("/v1/jobs/") && request.method === "GET" && response.status === 304) {
          pollNotModified += 1;
        }
        return response;
      } finally {
        if (isSubmission) {
          admissionActive -= 1;
        }
      }
    },
  });

  await writeFile(readyFile, JSON.stringify({
    origin: `http://127.0.0.1:${server.port}`,
    apiKey,
    templateId,
  }));
  await new Promise(() => {});
}

async function drainRequestBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;
  const reader = body.getReader();
  try {
    while (!(await reader.read()).done) {
      // Discard bounded stream chunks without materializing multipart fields.
    }
  } finally {
    reader.releaseLock();
  }
}

function createInstrumentedBaselineQueue(): PrototypeQueue {
  const handlers = new Set<(job: LocalQueuedExtractionJob) => void | Promise<void>>();
  let active = 0;
  let peakActive = 0;
  return {
    schedule: async (job) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      void Promise.all(Array.from(handlers, (handler) => handler(job))).finally(() => {
        active -= 1;
      });
    },
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    snapshot: () => ({ active, peakActive, pending: 0, peakPending: 0 }),
  };
}

function createBoundedPrototypeQueue(maxConcurrent: number): PrototypeQueue {
  const queue = createLocalExtractionQueue({ maxConcurrent });
  let active = 0;
  let peakActive = 0;
  let peakPending = 0;

  return {
    schedule: async (job) => {
      await queue.schedule(job);
      peakPending = Math.max(peakPending, queue.snapshot().pending);
    },
    subscribe: (handler) => queue.subscribe(async (job) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      try {
        await handler(job);
      } finally {
        active -= 1;
      }
    }),
    snapshot: () => ({ active, peakActive, pending: queue.snapshot().pending, peakPending }),
  };
}

function createFakeGateway(maxConcurrent: number, latencyMs: number) {
  const waiters: Array<() => void> = [];
  let active = 0;
  let peak = 0;
  const acquire = async () => {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    active += 1;
    peak = Math.max(peak, active);
  };
  const release = () => {
    active -= 1;
    waiters.shift()?.();
  };
  return {
    extract: async () => {
      await acquire();
      try {
        await Bun.sleep(latencyMs);
        return [{ field_id: "reference", status: "ok" as const, answer: "PROTOTYPE" }];
      } finally {
        release();
      }
    },
    peakActive: () => peak,
  };
}

function createResourceSampler() {
  const startedAt = performance.now();
  const startedCpu = process.cpuUsage();
  const baselineRssBytes = process.memoryUsage.rss();
  let peakRssBytes = baselineRssBytes;
  let maxEventLoopLagMs = 0;
  let expectedAt = performance.now() + 10;
  const timer = setInterval(() => {
    const now = performance.now();
    maxEventLoopLagMs = Math.max(maxEventLoopLagMs, Math.max(0, now - expectedAt));
    expectedAt = now + 10;
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
  }, 10);
  return {
    snapshot: () => {
      const elapsedMs = performance.now() - startedAt;
      const cpu = process.cpuUsage(startedCpu);
      const cpuMs = (cpu.user + cpu.system) / 1_000;
      const machineParallelism = Math.max(1, cpus().length);
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
      return {
        elapsedMs,
        peakRssBytes,
        baselineRssBytes,
        peakRssFraction: peakRssBytes / totalmem(),
        normalizedCpuFraction: cpuMs / elapsedMs / machineParallelism,
        cpuUserMicroseconds: cpu.user,
        cpuSystemMicroseconds: cpu.system,
        machineParallelism,
        maxEventLoopLagMs,
      };
    },
    stop: () => clearInterval(timer),
  };
}

async function createWorkloadFixtures(): Promise<Uint8Array[]> {
  const fixtureDirectory = process.env.PROTOTYPE_FIXTURE_DIRECTORY;
  if (fixtureDirectory) {
    return Promise.all([0, 1, 2].map(async (index) => new Uint8Array(
      await readFile(join(fixtureDirectory, `fixture-${index}.pdf`)),
    )));
  }
  return Promise.all([
    createPdfFixture(2, Math.floor(1.8 * 1024 * 1024)),
    createPdfFixture(4, Math.floor(4.8 * 1024 * 1024)),
    createPdfFixture(8, Math.floor(9.5 * 1024 * 1024)),
  ]);
}

async function createPdfFixture(pageCount: number, attachmentBytes: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let page = 0; page < pageCount; page += 1) {
    document.addPage([612, 792]);
  }
  await document.attach(randomBytes(attachmentBytes), "prototype-payload.bin", {
    mimeType: "application/octet-stream",
    description: "Random payload used only to reach the prototype byte distribution",
  });
  return document.save({ useObjectStreams: false });
}

function chooseFixture(fixtures: Uint8Array[], index: number, total: number): Uint8Array {
  const percentilePosition = (index + 0.5) / total;
  if (percentilePosition <= 0.9) return fixtures[0]!;
  if (percentilePosition <= 0.98) return fixtures[1]!;
  return fixtures[2]!;
}

function readConfiguration(): PrototypeConfiguration {
  return {
    workers: readPositiveInteger("PROTOTYPE_WORKERS", 100),
    gatewayConcurrency: readPositiveInteger("PROTOTYPE_GATEWAY_CONCURRENCY", 8),
    gatewayLatencyMs: readPositiveInteger("PROTOTYPE_GATEWAY_LATENCY_MS", 100),
    boundedRunnerConcurrency: readPositiveInteger("PROTOTYPE_RUNNER_CONCURRENCY", 8),
    boundedAdmissionConcurrency: readPositiveInteger("PROTOTYPE_ADMISSION_CONCURRENCY", 8),
    pollIntervalMs: readPositiveInteger("PROTOTYPE_POLL_INTERVAL_MS", 50),
  };
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function argumentValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

async function waitForJsonFile<T>(path: string, processHandle: Bun.Subprocess): Promise<T> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const text = await readFile(path, "utf8").catch(() => "");
    if (text) return JSON.parse(text) as T;
    if (processHandle.exitCode !== null) {
      const stderr = await new Response(processHandle.stderr).text().catch(() => "");
      throw new Error(`Prototype server exited before becoming ready: ${stderr}`);
    }
    await Bun.sleep(20);
  }
  throw new Error("Timed out waiting for prototype server");
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function jitterMultiplier(): number {
  return process.env.PROTOTYPE_DISABLE_JITTER === "1" ? 1 : 1 + Math.random() * 0.2;
}

function serverRuntimeFlags(): string[] {
  const raw = process.env.PROTOTYPE_SERVER_RUNTIME_FLAGS;
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error("PROTOTYPE_SERVER_RUNTIME_FLAGS must be a JSON string array");
  }
  return parsed;
}

function isSqliteBusy(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "SQLITE_BUSY"
    || (typeof candidate.message === "string" && /\bSQLITE_BUSY\b|database is locked/i.test(candidate.message));
}

function resultPrefix(): string {
  return "PROTOTYPE_RESULT ";
}
