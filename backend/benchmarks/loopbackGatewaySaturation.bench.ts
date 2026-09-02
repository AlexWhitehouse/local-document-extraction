import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Database } from "bun:sqlite";

import { createLocalAuth } from "../src/localAuth";
import { ensureLocalStateDirectories } from "../src/localRuntime";
import { createLocalWorkspaceControl } from "../src/localWorkspaceControl";
import { createLocalWorkspaceProductStore } from "../src/localWorkspaceProductStore";

type BenchmarkMode = "inline-pdf" | "rendered-pages";

type ExtractionQueueSnapshot = {
  active: number;
  deferred: number;
  maxConcurrent: number;
  pending: number;
};

type ResourceSnapshot = {
  completedJobs: number;
  completedJobsPerSecond: number;
  cpuRatio: number;
  eventLoopLagMs: number;
  gateway: { failed: number; success: number; throttled: number; timeout: number };
  memory: { externalBytes: number; heapUsedBytes: number; ratio: number; rssBytes: number };
  permits: { current: number; initial: number; maximum: number };
};

type HealthSnapshot = {
  diagnostics: {
    admission: { active: number; rejected: number; reservedBytes: number };
    extractionQueue: ExtractionQueueSnapshot;
    resources: ResourceSnapshot;
  };
  ok: boolean;
};

type GatewayReport = {
  active: number;
  bytesReceived: number;
  cpuCoreEquivalents: number;
  cpuSystemMs: number;
  cpuUserMs: number;
  elapsedMs: number;
  peakActive: number;
  peakRssBytes: number;
  requests: number;
};

type ProcessSample = {
  cpuPercent: number;
  rssBytes: number;
};

type Observation = {
  appProcess: ProcessSample | null;
  at: string;
  health: HealthSnapshot;
};

type BenchmarkSettings = {
  backlog: number;
  drainTimeoutSeconds: number;
  durationSeconds: number;
  gatewayLatencyMs: number;
  inlinePayloadBytes: number;
  modes: BenchmarkMode[];
  renderPages: number;
  runnerConcurrency: number;
  submitters: number;
  warmupSeconds: number;
};

type FixtureIdentity = {
  bytes: number;
  pages: number;
  sha256: string;
};

type PersistedTiming = {
  completed: number;
  completionSpanJobsPerSecond: number;
  failed: number;
  lifecycleP50Ms: number;
  lifecycleP95Ms: number;
  measurementCompleted: number;
  measurementJobsPerSecond: number;
  other: number;
};

type ModeResult = {
  accepted: number;
  app: {
    minimumPermits: number;
    peakCpuCoreEquivalents: number;
    peakEventLoopLagMs: number;
    peakHealthNormalizedCpu: number;
    peakRssBytes: number;
  };
  client: {
    cpuCoreEquivalents: number;
    networkErrors: number;
    rejected: number;
    unexpectedResponses: string[];
  };
  drainElapsedMs: number;
  fixture: FixtureIdentity;
  gateway: GatewayReport;
  loadElapsedMs: number;
  loadStartedAt: string;
  loadStoppedAt: string;
  mode: BenchmarkMode;
  observations: number;
  profile: {
    path: string;
    topFunctions: string[];
  };
  queue: {
    peakActive: number;
    peakPending: number;
  };
  serverTiming: PersistedTiming;
  stateDirectory: string;
};

type BenchmarkEvidence = {
  command: string;
  generatedAt: string;
  host: {
    architecture: string;
    cpuCount: number;
    cpuModel: string;
    memoryBytes: number;
    platform: string;
  };
  repositoryRevision: string;
  results: ModeResult[];
  settings: BenchmarkSettings;
};

type WorkspaceSetup = {
  apiKey: string;
  sessionCookie: string;
  templateId: string;
  workspaceId: string;
};

type CapturedChild = {
  child: ReturnType<typeof Bun.spawn>;
  output(): { stderr: string; stdout: string };
  streamsDone: Promise<void>;
};

const backendDirectory = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(backendDirectory, "..");
const benchmarkPath = resolve(import.meta.path);
const gatewayToken = "loopback-benchmark-only";
const resultContent = JSON.stringify({
  results: [{
    field_id: "reference",
    status: "ok",
    answer: "LOOPBACK",
    confidence: 1,
    evidence: "Synthetic loopback benchmark response",
  }],
});

async function runCoordinator(): Promise<void> {
  const settings = readSettings();
  const configuredOutputDirectory = process.env.LOOPBACK_BENCH_OUTPUT_DIR;
  const runDirectory = configuredOutputDirectory
    ? resolve(repositoryRoot, configuredOutputDirectory)
    : join(repositoryRoot, ".scratch", "loopback-gateway-saturation", "runs", timestampSlug());
  await mkdir(runDirectory, { recursive: true });
  const results: ModeResult[] = [];

  process.stdout.write([
    "Loopback Model gateway saturation benchmark",
    `output=${runDirectory}`,
    `modes=${settings.modes.join(",")}`,
    `duration=${settings.durationSeconds}s per mode`,
    `runner_concurrency=${settings.runnerConcurrency}`,
    `submitters=${settings.submitters}`,
    `backlog=${settings.backlog}`,
    "network_safety=127.0.0.1 only; .env loading disabled",
    "",
  ].join("\n"));

  for (const mode of settings.modes) {
    process.stdout.write(`Starting ${mode} saturation pass...\n`);
    const result = await runMode({ mode, runDirectory, settings });
    results.push(result);
    process.stdout.write([
      `${mode}: ${formatNumber(result.serverTiming.measurementJobsPerSecond)} jobs/s`,
      `accepted=${result.accepted}`,
      `completed=${result.serverTiming.completed}`,
      `app_peak_cpu=${formatNumber(result.app.peakCpuCoreEquivalents)} cores`,
      `gateway_cpu=${formatNumber(result.gateway.cpuCoreEquivalents)} cores`,
      `queue_peak=${result.queue.peakPending}`,
      "",
    ].join(" | "));
  }

  const evidence: BenchmarkEvidence = {
    command: "bun run benchmark:loopback-saturation",
    generatedAt: new Date().toISOString(),
    host: {
      architecture: arch(),
      cpuCount: cpus().length,
      cpuModel: cpus()[0]?.model ?? "unknown CPU",
      memoryBytes: totalmem(),
      platform: platform(),
    },
    repositoryRevision: await gitRevision(),
    results,
    settings,
  };
  const report = renderReport(evidence, runDirectory);
  await Promise.all([
    writeFile(join(runDirectory, "result.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8"),
    writeFile(join(runDirectory, "report.md"), report, "utf8"),
  ]);
  process.stdout.write(`${report}\n`);
  process.stdout.write(`LOOPBACK_BENCHMARK_RESULT ${JSON.stringify({ runDirectory, results })}\n`);

  if (results.some((result) => result.serverTiming.completed !== result.accepted || result.serverTiming.failed > 0)) {
    process.exitCode = 1;
  }
}

async function runMode({
  mode,
  runDirectory,
  settings,
}: {
  mode: BenchmarkMode;
  runDirectory: string;
  settings: BenchmarkSettings;
}): Promise<ModeResult> {
  const modeDirectory = join(runDirectory, mode);
  const stateDirectory = join(modeDirectory, "state");
  const profileDirectory = join(modeDirectory, "profile");
  await Promise.all([
    mkdir(stateDirectory, { recursive: true }),
    mkdir(profileDirectory, { recursive: true }),
  ]);
  const fixture = await createFixture(mode, settings);
  const fixtureIdentity = identityForFixture(fixture, mode === "rendered-pages" ? settings.renderPages : 1);
  await writeFile(join(modeDirectory, "fixture.pdf"), fixture);
  const workspace = await setupWorkspace(stateDirectory, mode);
  const gateway = await startGateway(settings.gatewayLatencyMs);
  let app: Awaited<ReturnType<typeof startApplication>> | null = null;

  try {
    assertLoopbackOrigin(gateway.origin);
    app = await startApplication({
      fixtureBytes: fixture.byteLength,
      profileDirectory,
      settings,
      stateDirectory,
    });
    assertLoopbackOrigin(app.origin);
    const configuration = await fetch(new URL(`/v1/workspaces/${workspace.workspaceId}/model-configuration`, app.origin), {
      method: "PUT",
      headers: { cookie: workspace.sessionCookie, "content-type": "application/json", "if-none-match": "*" },
      body: JSON.stringify({
        gateway_url: new URL("/v1/", gateway.origin).toString(),
        model_name: "benchmark/loopback",
        credential: gatewayToken,
        sequential_calls: false,
        supports_pdf_input: mode === "inline-pdf",
        supports_structured_output: true,
      }),
    });
    if (configuration.status !== 201) throw new Error(`Benchmark Workspace configuration failed (${configuration.status}).`);
    const load = await generateLoad({
      apiKey: workspace.apiKey,
      app,
      fixture,
      sessionCookie: workspace.sessionCookie,
      settings,
      templateId: workspace.templateId,
      workspaceId: workspace.workspaceId,
    });
    const gatewayReport = await readGatewayReport(gateway.origin);
    await stopCapturedChild(app.process, 30_000);
    await app.flushLogs(modeDirectory);
    app = null;
    await gateway.stop();
    await gateway.flushLogs(modeDirectory);

    const serverTiming = readPersistedTiming({
      loadStartedAt: load.loadStartedAt,
      loadStoppedAt: load.loadStoppedAt,
      stateDirectory,
      warmupSeconds: settings.warmupSeconds,
      workspaceId: workspace.workspaceId,
    });
    const profilePath = join(profileDirectory, "app-cpu.md");
    const profileMarkdown = await readFile(profilePath, "utf8");
    const observations = load.observations;
    return {
      accepted: load.accepted,
      app: {
        minimumPermits: min(observations.map((sample) => sample.health.diagnostics.resources.permits.current)),
        peakCpuCoreEquivalents: max(observations.map((sample) => (sample.appProcess?.cpuPercent ?? 0) / 100)),
        peakEventLoopLagMs: max(observations.map((sample) => sample.health.diagnostics.resources.eventLoopLagMs)),
        peakHealthNormalizedCpu: max(observations.map((sample) => sample.health.diagnostics.resources.cpuRatio)),
        peakRssBytes: max(observations.flatMap((sample) => [
          sample.appProcess?.rssBytes ?? 0,
          sample.health.diagnostics.resources.memory.rssBytes,
        ])),
      },
      client: {
        cpuCoreEquivalents: load.clientCpuCoreEquivalents,
        networkErrors: load.networkErrors,
        rejected: load.rejected,
        unexpectedResponses: load.unexpectedResponses,
      },
      drainElapsedMs: load.drainElapsedMs,
      fixture: fixtureIdentity,
      gateway: gatewayReport,
      loadElapsedMs: load.loadElapsedMs,
      loadStartedAt: load.loadStartedAt,
      loadStoppedAt: load.loadStoppedAt,
      mode,
      observations: observations.length,
      profile: {
        path: profilePath,
        topFunctions: readTopProfileFunctions(profileMarkdown),
      },
      queue: {
        peakActive: max(observations.map((sample) => sample.health.diagnostics.extractionQueue.active)),
        peakPending: max(observations.map((sample) => sample.health.diagnostics.extractionQueue.pending)),
      },
      serverTiming,
      stateDirectory,
    };
  } catch (error) {
    if (app) {
      await stopCapturedChild(app.process, 5_000).catch(() => undefined);
      await app.flushLogs(modeDirectory).catch(() => undefined);
    }
    await gateway.stop().catch(() => undefined);
    await gateway.flushLogs(modeDirectory).catch(() => undefined);
    throw error;
  }
}

async function generateLoad({
  apiKey,
  app,
  fixture,
  sessionCookie,
  settings,
  templateId,
  workspaceId,
}: {
  apiKey: string;
  app: Awaited<ReturnType<typeof startApplication>>;
  fixture: Uint8Array;
  sessionCookie: string;
  settings: BenchmarkSettings;
  templateId: string;
  workspaceId: string;
}): Promise<{
  accepted: number;
  clientCpuCoreEquivalents: number;
  drainElapsedMs: number;
  loadElapsedMs: number;
  loadStartedAt: string;
  loadStoppedAt: string;
  networkErrors: number;
  observations: Observation[];
  rejected: number;
  unexpectedResponses: string[];
}> {
  let accepted = 0;
  let rejected = 0;
  let networkErrors = 0;
  let sequence = 0;
  const unexpectedResponses: string[] = [];
  const observations: Observation[] = [];
  const terminalJobIds = new Set<string>();
  const socket = await openLifecycleSocket({
    cookie: sessionCookie,
    onFailure: (message) => unexpectedResponses.push(message),
    onTerminalJob: (jobId) => terminalJobIds.add(jobId),
    origin: app.origin,
    workspaceId,
  });
  const initialHealth = await readHealth(app.origin);
  observations.push({
    appProcess: await sampleProcess(app.process.child.pid),
    at: new Date().toISOString(),
    health: initialHealth,
  });
  let monitoring = true;
  let stopMonitor!: () => void;
  const monitorStopped = new Promise<void>((resolve) => {
    stopMonitor = resolve;
  });
  const monitor = (async () => {
    while (monitoring) {
      await Promise.race([Bun.sleep(5_000), monitorStopped]);
      if (!monitoring) break;
      try {
        const [health, appProcess] = await Promise.all([
          readHealth(app.origin),
          sampleProcess(app.process.child.pid),
        ]);
        observations.push({ appProcess, at: new Date().toISOString(), health });
      } catch (error) {
        if (monitoring) {
          unexpectedResponses.push(`monitor: ${errorMessage(error)}`);
        }
      }
    }
  })();
  const clientCpuStart = process.cpuUsage();
  const loadStartedMs = Date.now();
  const loadStartedAt = new Date(loadStartedMs).toISOString();
  const loadDeadline = loadStartedMs + settings.durationSeconds * 1_000;
  const fixtureBlob = new Blob([Uint8Array.from(fixture).buffer], { type: "application/pdf" });

  const submitters = Array.from({ length: settings.submitters }, async (_, submitter) => {
    while (Date.now() < loadDeadline) {
      if (accepted - terminalJobIds.size >= settings.backlog) {
        await Bun.sleep(5);
        continue;
      }
      const index = sequence;
      sequence += 1;
      const form = new FormData();
      form.append("template_id", templateId);
      form.append(
        "document",
        new File([fixtureBlob], `loopback-${submitter}-${index}.pdf`, { type: "application/pdf" }),
      );
      let response: Response;
      try {
        response = await fetch(`${app.origin}/v1/extract`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}` },
          body: form,
        });
      } catch {
        networkErrors += 1;
        await Bun.sleep(20);
        continue;
      }
      if (response.status === 202) {
        accepted += 1;
        const body = await response.json() as { job_id?: unknown };
        if (typeof body.job_id !== "string" && unexpectedResponses.length < 20) {
          unexpectedResponses.push("submission HTTP 202 returned no job_id");
        }
        continue;
      }
      const body = (await response.text()).slice(0, 300);
      if (response.status === 503) {
        rejected += 1;
        await Bun.sleep(20);
        continue;
      }
      if (unexpectedResponses.length < 20) {
        unexpectedResponses.push(`submission HTTP ${response.status}: ${body}`);
      }
      await Bun.sleep(20);
    }
  });
  await Promise.all(submitters);
  const loadStoppedMs = Date.now();
  const loadStoppedAt = new Date(loadStoppedMs).toISOString();
  const loadElapsedMs = loadStoppedMs - loadStartedMs;
  const clientCpu = process.cpuUsage(clientCpuStart);
  const clientCpuCoreEquivalents = (clientCpu.user + clientCpu.system) / Math.max(1, loadElapsedMs * 1_000);
  const drainStartedAt = Date.now();
  const drainDeadline = drainStartedAt + settings.drainTimeoutSeconds * 1_000;

  while (Date.now() < drainDeadline && terminalJobIds.size < accepted) {
    await Bun.sleep(25);
  }
  const finalHealth = await readHealth(app.origin);
  observations.push({
    appProcess: await sampleProcess(app.process.child.pid),
    at: new Date().toISOString(),
    health: finalHealth,
  });
  monitoring = false;
  stopMonitor();
  await monitor;
  socket.close();
  const finalQueue = finalHealth.diagnostics.extractionQueue;
  if (finalQueue.active !== 0 || finalQueue.pending !== 0 || finalQueue.deferred !== 0) {
    unexpectedResponses.push(
      `drain timeout: active=${finalQueue.active}, pending=${finalQueue.pending}, deferred=${finalQueue.deferred}`,
    );
  }

  return {
    accepted,
    clientCpuCoreEquivalents,
    drainElapsedMs: Date.now() - drainStartedAt,
    loadElapsedMs,
    loadStartedAt,
    loadStoppedAt,
    networkErrors,
    observations,
    rejected,
    unexpectedResponses,
  };
}

async function setupWorkspace(stateDirectory: string, mode: BenchmarkMode): Promise<WorkspaceSetup> {
  await ensureLocalStateDirectories(stateDirectory);
  const authSecret = "loopback-benchmark-auth-secret-0123456789";
  await writeFile(join(stateDirectory, "data", "better-auth-secret"), `${authSecret}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const database = new Database(join(stateDirectory, "data", "control.sqlite"));
  try {
    let verificationResolve!: (url: string) => void;
    const verificationUrl = new Promise<string>((resolve) => {
      verificationResolve = resolve;
    });
    const auth = await createLocalAuth({
      baseURL: "http://127.0.0.1",
      database,
      logger: { error: () => undefined },
      mailSink: {
        capture: async (message) => {
          const url = message.text.match(/https?:\/\/\S+/)?.[0];
          if (url) verificationResolve(url);
        },
      },
      secret: authSecret,
    });
    const response = await auth.handler(new Request("http://127.0.0.1/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `loopback-${mode}@example.invalid`,
        name: "Loopback benchmark",
        password: "Benchmark1!",
      }),
    }));
    if (!response.ok) {
      throw new Error(`Benchmark user setup failed with HTTP ${response.status}: ${await response.text()}`);
    }
    const body = await response.json() as { user?: { id?: string; name?: string } };
    if (!body.user?.id) throw new Error("Benchmark user setup returned no user ID");
    const verificationLink = await Promise.race([
      verificationUrl,
      timeout(5_000, "Benchmark verification email was not captured"),
    ]);
    const verified = await auth.handler(new Request(verificationLink, { redirect: "manual" }));
    if (verified.status >= 400) {
      throw new Error(`Benchmark email verification failed with HTTP ${verified.status}`);
    }
    const signedIn = await auth.handler(new Request("http://127.0.0.1/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `loopback-${mode}@example.invalid`,
        password: "Benchmark1!",
      }),
    }));
    if (!signedIn.ok) {
      throw new Error(`Benchmark sign-in failed with HTTP ${signedIn.status}: ${await signedIn.text()}`);
    }
    const sessionCookie = signedIn.headers.get("set-cookie")?.split(";", 1)[0];
    if (!sessionCookie) throw new Error("Benchmark sign-in returned no session cookie");
    const workspaceControl = createLocalWorkspaceControl(database);
    const workspace = workspaceControl.listAcceptedWorkspaces({
      userId: body.user.id,
      userName: body.user.name || "Loopback benchmark",
    })[0];
    if (!workspace) throw new Error("Benchmark Workspace setup failed");
    workspaceControl.completeStarterTemplateBootstrap({ workspaceId: workspace.id });
    const apiKey = workspaceControl.rotateApiKey({
      userId: body.user.id,
      workspaceId: workspace.id,
    }).api_key;
    const templateId = "tpl_loopback_saturation";
    const productStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: workspace.id });
    try {
      productStore.createTemplate({
        createdAt: new Date().toISOString(),
        description: "Synthetic loopback saturation benchmark Template",
        fields: [{
          data_type: "string",
          description: "Synthetic benchmark reference",
          id: "reference",
          name: "Reference",
        }],
        name: "Loopback saturation",
        templateId,
      });
    } finally {
      productStore.close();
    }
    return { apiKey, sessionCookie, templateId, workspaceId: workspace.id };
  } finally {
    database.close();
  }
}

async function createFixture(mode: BenchmarkMode, settings: BenchmarkSettings): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = mode === "rendered-pages" ? settings.renderPages : 1;
  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`Loopback saturation benchmark page ${pageIndex + 1}`, {
      color: rgb(0.08, 0.14, 0.25),
      font,
      size: 22,
      x: 40,
      y: 740,
    });
    for (let row = 0; row < 32; row += 1) {
      page.drawRectangle({
        borderColor: rgb(0.2, 0.35, 0.55),
        borderWidth: 0.5,
        color: row % 2 === 0 ? rgb(0.94, 0.97, 1) : rgb(1, 1, 1),
        height: 17,
        width: 532,
        x: 40,
        y: 700 - row * 20,
      });
      page.drawText(`Reference ${pageIndex + 1}-${row + 1}: deterministic synthetic extraction data`, {
        color: rgb(0.1, 0.1, 0.1),
        font,
        size: 8,
        x: 48,
        y: 705 - row * 20,
      });
    }
  }
  if (mode === "inline-pdf" && settings.inlinePayloadBytes > 0) {
    await pdf.attach(deterministicBytes(settings.inlinePayloadBytes), "payload.bin", {
      description: "Incompressible synthetic bytes used to exercise inline base64 and HTTP bodies",
      mimeType: "application/octet-stream",
    });
  }
  return Uint8Array.from(await pdf.save({ useObjectStreams: true }));
}

function deterministicBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = 0x6d2b79f5;
  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

function identityForFixture(fixture: Uint8Array, pages: number): FixtureIdentity {
  return {
    bytes: fixture.byteLength,
    pages,
    sha256: createHash("sha256").update(fixture).digest("hex"),
  };
}

async function startGateway(latencyMs: number): Promise<{
  flushLogs(directory: string): Promise<void>;
  origin: string;
  stop(): Promise<void>;
}> {
  let readyResolve!: (origin: string) => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<string>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const captured = captureChild(Bun.spawn([
    process.execPath,
    "--no-env-file",
    benchmarkPath,
    "--gateway-child",
  ], {
    cwd: backendDirectory,
    env: minimalEnvironment({
      LOOPBACK_GATEWAY_LATENCY_MS: String(latencyMs),
      LOOPBACK_GATEWAY_TOKEN: gatewayToken,
    }),
    stderr: "pipe",
    stdout: "pipe",
  }), (line) => {
    const prefix = "LOOPBACK_GATEWAY_READY ";
    if (!line.startsWith(prefix)) return;
    try {
      const payload = JSON.parse(line.slice(prefix.length)) as { origin?: unknown };
      const origin = String(payload.origin || "");
      assertLoopbackOrigin(origin);
      readyResolve(origin);
    } catch (error) {
      readyReject(new Error(`Invalid loopback Gateway ready event: ${errorMessage(error)}`));
    }
  });
  const origin = await Promise.race([
    ready,
    captured.child.exited.then((code) => {
      throw new Error(`Loopback Gateway exited with code ${code} before readiness`);
    }),
    timeout(10_000, "Loopback Gateway did not become ready"),
  ]);
  return {
    flushLogs: (directory) => flushChildLogs(captured, directory, "gateway"),
    origin,
    stop: async () => {
      await fetch(`${origin}/__benchmark/shutdown`, { method: "POST" }).catch(() => undefined);
      await stopCapturedChild(captured, 10_000, false);
    },
  };
}

async function startApplication({
  fixtureBytes,
  profileDirectory,
  settings,
  stateDirectory,
}: {
  fixtureBytes: number;
  profileDirectory: string;
  settings: BenchmarkSettings;
  stateDirectory: string;
}): Promise<{
  flushLogs(directory: string): Promise<void>;
  origin: string;
  process: CapturedChild;
}> {
  let readyResolve!: (origin: string) => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<string>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const maxSourceBytes = Math.max(2 * 1024 * 1024, fixtureBytes + 1024 * 1024);
  const reservedBytes = Math.max(256 * 1024 * 1024, maxSourceBytes * settings.submitters * 2);
  const captured = captureChild(Bun.spawn([
    process.execPath,
    "--no-env-file",
    "--cpu-prof-md",
    "--cpu-prof-name", "app-cpu.md",
    "--cpu-prof-dir", profileDirectory,
    "src/server.ts",
  ], {
    cwd: backendDirectory,
    env: minimalEnvironment({
      DOCUMENT_EXTRACTION_ASSETS_DIR: resolve(repositoryRoot, "frontend", "dist"),
      DOCUMENT_EXTRACTION_STATE_DIR: stateDirectory,
      EXTRACTION_ADAPTIVE_CONCURRENCY: "false",
      EXTRACTION_MAX_BUFFERED: String(Math.max(1_000, settings.backlog * 2)),
      EXTRACTION_MAX_CONCURRENCY: String(settings.runnerConcurrency),
      EXTRACTION_MAX_CONCURRENCY_LIMIT: String(settings.runnerConcurrency),
      EXTRACTION_RECONCILE_INTERVAL_MS: "60000",
      EXTRACTION_RETRY_DELAY_MS: "100",
      FAILED_SOURCE_RETENTION_MS: "0",
      LOCAL_CPU_LIMIT_RATIO: "1",
      LOCAL_DISK_RESERVE_BYTES: "0",
      LOCAL_MEMORY_LIMIT_RATIO: "0.95",
      LOCAL_SHUTDOWN_TIMEOUT_MS: "30000",
      MAX_SOURCE_FILE_BYTES: String(maxSourceBytes),
      MODEL_GATEWAY_REQUEST_TIMEOUT_MS: "30000",
      PORT: "0",
      SOURCE_RETENTION_SWEEP_INTERVAL_MS: "60000",
      SUBMISSION_MAX_CONCURRENCY: String(settings.submitters),
      SUBMISSION_MAX_RESERVED_BYTES: String(reservedBytes),
    }),
    stderr: "pipe",
    stdout: "pipe",
  }), (line) => {
    const prefix = "LOCAL_RUNTIME_READY ";
    if (!line.startsWith(prefix)) return;
    try {
      const payload = JSON.parse(line.slice(prefix.length)) as { origin?: unknown };
      const origin = String(payload.origin || "");
      assertLoopbackOrigin(origin);
      readyResolve(origin);
    } catch (error) {
      readyReject(new Error(`Invalid application ready event: ${errorMessage(error)}`));
    }
  });
  const origin = await Promise.race([
    ready,
    captured.child.exited.then((code) => {
      throw new Error(`Application exited with code ${code} before readiness`);
    }),
    timeout(20_000, "Application did not become ready"),
  ]);
  await waitForHealthy(origin, 10_000);
  return {
    flushLogs: (directory) => flushChildLogs(captured, directory, "app"),
    origin,
    process: captured,
  };
}

function captureChild(
  child: ReturnType<typeof Bun.spawn>,
  onStdoutLine: (line: string) => void,
): CapturedChild {
  const output = { stderr: "", stdout: "" };
  const stdout = captureStream(child.stdout as ReadableStream<Uint8Array>, (text) => {
    output.stdout += text;
  }, onStdoutLine);
  const stderr = captureStream(child.stderr as ReadableStream<Uint8Array>, (text) => {
    output.stderr += text;
  });
  return {
    child,
    output: () => ({ ...output }),
    streamsDone: Promise.all([stdout, stderr]).then(() => undefined),
  };
}

async function captureStream(
  stream: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  onLine: (line: string) => void = () => undefined,
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

async function stopCapturedChild(
  process: CapturedChild,
  timeoutMs: number,
  sendSignal = true,
): Promise<void> {
  if (sendSignal) process.child.kill("SIGTERM");
  const code = await Promise.race([
    process.child.exited,
    timeout(timeoutMs, "Child process did not exit cleanly"),
  ]).catch(async (error) => {
    process.child.kill("SIGKILL");
    await process.child.exited;
    throw error;
  });
  await process.streamsDone;
  if (code !== 0 && code !== 143) {
    const output = process.output();
    throw new Error([
      `Child process exited with code ${code}`,
      `stdout:\n${output.stdout.slice(-4_000) || "<empty>"}`,
      `stderr:\n${output.stderr.slice(-4_000) || "<empty>"}`,
    ].join("\n"));
  }
}

async function flushChildLogs(process: CapturedChild, directory: string, name: string): Promise<void> {
  await process.streamsDone.catch(() => undefined);
  const output = process.output();
  await Promise.all([
    writeFile(join(directory, `${name}.stdout.log`), output.stdout, "utf8"),
    writeFile(join(directory, `${name}.stderr.log`), output.stderr, "utf8"),
  ]);
}

async function readHealth(origin: string): Promise<HealthSnapshot> {
  const response = await fetch(`${origin}/v1/health`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Health returned HTTP ${response.status}`);
  const health = await response.json() as Partial<HealthSnapshot>;
  if (!health.ok || !health.diagnostics?.extractionQueue || !health.diagnostics.resources) {
    throw new Error("Health response is missing benchmark diagnostics");
  }
  return health as HealthSnapshot;
}

async function openLifecycleSocket({
  cookie,
  onFailure,
  onTerminalJob,
  origin,
  workspaceId,
}: {
  cookie: string;
  onFailure?: (message: string) => void;
  onTerminalJob: (jobId: string) => void;
  origin: string;
  workspaceId: string;
}): Promise<{ close(): void }> {
  const url = new URL(`/v1/workspaces/${encodeURIComponent(workspaceId)}/live`, origin);
  url.protocol = "ws:";
  const BunWebSocket = WebSocket as unknown as {
    new (url: string | URL, options: Bun.WebSocketOptions): WebSocket;
  };
  const socket = new BunWebSocket(url, {
    headers: { cookie },
    perMessageDeflate: false,
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Lifecycle WebSocket did not open")), 5_000);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Lifecycle WebSocket failed to open"));
    };
  });
  let expectedClose = false;
  socket.onmessage = (message) => {
    try {
      const payload = JSON.parse(String(message.data)) as {
        events?: Array<{ job?: { job_id?: unknown; status?: unknown }; type?: unknown }>;
      };
      for (const event of payload.events || []) {
        const job = event.type === "extraction_job_lifecycle" ? event.job : null;
        if (
          typeof job?.job_id === "string"
          && (job.status === "completed" || job.status === "failed")
        ) {
          onTerminalJob(job.job_id);
        }
      }
    } catch (error) {
      onFailure?.(`lifecycle message: ${errorMessage(error)}`);
    }
  };
  socket.onerror = () => onFailure?.("lifecycle WebSocket error");
  socket.onclose = (event) => {
    if (!expectedClose) onFailure?.(`lifecycle WebSocket closed (${event.code})`);
  };
  return {
    close: () => {
      expectedClose = true;
      socket.close();
    },
  };
}

async function waitForHealthy(origin: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      await readHealth(origin);
      return;
    } catch (error) {
      lastError = errorMessage(error);
    }
    await Bun.sleep(25);
  }
  throw new Error(`Application did not become healthy: ${lastError}`);
}

async function readGatewayReport(origin: string): Promise<GatewayReport> {
  const response = await fetch(`${origin}/__benchmark/report`);
  if (!response.ok) throw new Error(`Gateway report returned HTTP ${response.status}`);
  return await response.json() as GatewayReport;
}

async function sampleProcess(pid: number): Promise<ProcessSample | null> {
  try {
    const child = Bun.spawn(["ps", "-p", String(pid), "-o", "%cpu=", "-o", "rss="], {
      stderr: "ignore",
      stdout: "pipe",
    });
    const [text, code] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    if (code !== 0) return null;
    const [cpu, rss] = text.trim().split(/\s+/).map(Number);
    if (!Number.isFinite(cpu) || !Number.isFinite(rss)) return null;
    return { cpuPercent: cpu!, rssBytes: rss! * 1024 };
  } catch {
    return null;
  }
}

function readPersistedTiming({
  loadStartedAt,
  loadStoppedAt,
  stateDirectory,
  warmupSeconds,
  workspaceId,
}: {
  loadStartedAt: string;
  loadStoppedAt: string;
  stateDirectory: string;
  warmupSeconds: number;
  workspaceId: string;
}): PersistedTiming {
  const database = new Database(join(stateDirectory, "data", "workspaces", `${workspaceId}.sqlite`));
  try {
    const rows = database.query(
      "SELECT status, created_at, completed_at FROM jobs ORDER BY created_at ASC",
    ).all() as Array<{ completed_at: string | null; created_at: string; status: string }>;
    const completedRows = rows.filter((row) => row.status === "completed" && row.completed_at);
    const lifecycle = completedRows.map((row) => Math.max(
      0,
      Date.parse(row.completed_at!) - Date.parse(row.created_at),
    ));
    const completionTimes = completedRows.map((row) => Date.parse(row.completed_at!)).sort((left, right) => left - right);
    const loadStartMs = Date.parse(loadStartedAt);
    const loadStopMs = Date.parse(loadStoppedAt);
    const measurementStartMs = Math.min(
      loadStopMs,
      loadStartMs + warmupSeconds * 1_000,
    );
    const measurementCompleted = completionTimes.filter(
      (completedAt) => completedAt >= measurementStartMs && completedAt <= loadStopMs,
    ).length;
    const measurementElapsedMs = Math.max(1, loadStopMs - measurementStartMs);
    const completionSpanMs = completionTimes.length > 1
      ? completionTimes[completionTimes.length - 1]! - completionTimes[0]!
      : 0;
    return {
      completed: completedRows.length,
      completionSpanJobsPerSecond: completionSpanMs > 0
        ? (completionTimes.length - 1) / (completionSpanMs / 1_000)
        : 0,
      failed: rows.filter((row) => row.status === "failed").length,
      lifecycleP50Ms: percentile(lifecycle, 0.5),
      lifecycleP95Ms: percentile(lifecycle, 0.95),
      measurementCompleted,
      measurementJobsPerSecond: measurementCompleted / (measurementElapsedMs / 1_000),
      other: rows.length - completedRows.length - rows.filter((row) => row.status === "failed").length,
    };
  } finally {
    database.close();
  }
}

function renderReport(evidence: BenchmarkEvidence, runDirectory: string): string {
  const lines = [
    "# Loopback Model gateway saturation benchmark",
    "",
    `Generated ${evidence.generatedAt} at revision \`${evidence.repositoryRevision}\` on ${evidence.host.cpuModel} (${evidence.host.cpuCount} logical CPUs, ${formatBytes(evidence.host.memoryBytes)} RAM).`,
    "",
    "The application, load generator, and fake OpenAI-compatible Gateway ran as separate processes. The application was the only profiled process. Both configured Gateway and application origins were rejected unless they were explicit `http://127.0.0.1:<port>` URLs, and every Bun child ran with `.env` loading disabled.",
    "",
    "## Results",
    "",
    "| Mode | Server jobs/s | Completed | Lifecycle p50/p95 | App peak CPU | App peak RSS | Event-loop lag | Queue pending peak | Min permits | Gateway CPU / peak active | Client CPU |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...evidence.results.map((result) => [
      `| ${result.mode}`,
      formatNumber(result.serverTiming.measurementJobsPerSecond),
      `${result.serverTiming.completed}/${result.accepted}`,
      `${formatNumber(result.serverTiming.lifecycleP50Ms)}/${formatNumber(result.serverTiming.lifecycleP95Ms)} ms`,
      `${formatNumber(result.app.peakCpuCoreEquivalents)} cores (${formatPercent(result.app.peakHealthNormalizedCpu)})`,
      formatBytes(result.app.peakRssBytes),
      `${formatNumber(result.app.peakEventLoopLagMs)} ms`,
      String(result.queue.peakPending),
      String(result.app.minimumPermits),
      `${formatNumber(result.gateway.cpuCoreEquivalents)} cores / ${result.gateway.peakActive}`,
      `${formatNumber(result.client.cpuCoreEquivalents)} cores |`,
    ].join(" | ")),
    "",
    "Server jobs/s uses persisted server completion timestamps inside the steady measurement window; it is not derived from client polling. Completion-span throughput and full lifecycle figures remain in `result.json`.",
    "",
    "## Bottleneck signals",
    "",
    ...evidence.results.flatMap((result) => bottleneckFindings(
      result,
      evidence.host.cpuCount,
      evidence.host.memoryBytes,
    ).map((finding) => `- **${result.mode}:** ${finding}`)),
    "",
    "## CPU profile leaders",
    "",
    ...evidence.results.flatMap((result) => [
      `### ${result.mode}`,
      "",
      `Profile: \`${result.profile.path}\``,
      "",
      ...(result.profile.topFunctions.length > 0
        ? result.profile.topFunctions.map((row) => `- ${row}`)
        : ["- Bun emitted no parseable hot-function rows."]),
      "",
    ]),
    "## Reproduce",
    "",
    "```bash",
    evidence.command,
    "```",
    "",
    "Useful controls: `LOOPBACK_BENCH_DURATION_SECONDS`, `LOOPBACK_BENCH_MODES`, `LOOPBACK_BENCH_RUNNER_CONCURRENCY`, `LOOPBACK_BENCH_SUBMITTERS`, `LOOPBACK_BENCH_BACKLOG`, `LOOPBACK_BENCH_INLINE_PAYLOAD_BYTES`, and `LOOPBACK_BENCH_RENDER_PAGES`.",
    "",
    `Raw logs, isolated state, fixtures, profiles, and JSON evidence: \`${runDirectory}\``,
  ];
  return lines.join("\n");
}

function bottleneckFindings(result: ModeResult, cpuCount: number, hostMemoryBytes: number): string[] {
  const findings: string[] = [];
  if (result.queue.peakPending > 0 && result.queue.peakActive >= 1) {
    findings.push(`the runner was saturated (active peak ${result.queue.peakActive}, pending peak ${result.queue.peakPending}), so the offered load was sufficient.`);
  } else {
    findings.push("the extraction queue did not build a pending backlog; increase submitters/backlog before treating this as a capacity ceiling.");
  }
  if (result.app.peakCpuCoreEquivalents >= 0.85) {
    findings.push(`application CPU reached ${formatNumber(result.app.peakCpuCoreEquivalents)} core-equivalents, while whole-machine normalized CPU peaked at ${formatPercent(result.app.peakHealthNormalizedCpu)} across ${cpuCount} logical CPUs. A small number of hot runtime/native threads can therefore saturate without a conspicuous whole-machine spike.`);
  } else if (result.queue.peakPending > 0) {
    findings.push(`the queue grew while application CPU stayed below one full core (${formatNumber(result.app.peakCpuCoreEquivalents)}); inspect the profile for SQLite/filesystem/HTTP waits or profiler blind spots.`);
  }
  if (result.app.peakEventLoopLagMs >= 250) {
    findings.push(`event-loop lag reached ${formatNumber(result.app.peakEventLoopLagMs)} ms, which is a software scheduling/backpressure limit.`);
  }
  if (result.app.minimumPermits === 0) {
    findings.push("the production resource controller reduced extraction permits to zero during the run; the configured concurrency exceeded its hard event-loop or memory safety threshold.");
  }
  const hostMemoryFraction = result.app.peakRssBytes / Math.max(1, hostMemoryBytes);
  if (hostMemoryFraction >= 0.2) {
    findings.push(`application RSS reached ${formatBytes(result.app.peakRssBytes)} (${formatPercent(hostMemoryFraction)} of physical memory), so buffer/canvas amplification is a hardware-capacity constraint even when retained benchmark state is small.`);
  }
  if (result.gateway.cpuCoreEquivalents >= Math.max(0.8, result.app.peakCpuCoreEquivalents * 0.8)) {
    findings.push(`the fake Gateway itself consumed ${formatNumber(result.gateway.cpuCoreEquivalents)} core-equivalents; its request-body consumption is material and must remain separately attributed.`);
  } else {
    findings.push(`the fake Gateway used ${formatNumber(result.gateway.cpuCoreEquivalents)} core-equivalents and had no artificial concurrency ceiling, so it was not the configured 80 jobs/s limiter from the older fake.`);
  }
  if (result.client.rejected > 0 || result.client.networkErrors > 0 || result.client.unexpectedResponses.length > 0) {
    findings.push(`load-path anomalies: ${result.client.rejected} admission rejections, ${result.client.networkErrors} network errors, ${result.client.unexpectedResponses.length} unexpected observations.`);
  }
  return findings;
}

function readTopProfileFunctions(markdown: string): string[] {
  const section = markdown.split("## Hot Functions (Self Time)")[1]?.split("## Call Tree")[0] || "";
  return section.split(/\r?\n/)
    .filter((line) => /^\|\s*[0-9.]+%/.test(line))
    .slice(0, 12)
    .map((line) => line.replace(/^\|\s*/, "").replace(/\s*\|\s*$/, "").replace(/\s*\|\s*/g, " — "));
}

function readSettings(): BenchmarkSettings {
  const runnerConcurrency = positiveInteger(
    process.env.LOOPBACK_BENCH_RUNNER_CONCURRENCY,
    Math.max(16, Math.min(64, cpus().length * 4)),
    "LOOPBACK_BENCH_RUNNER_CONCURRENCY",
  );
  const durationSeconds = positiveInteger(
    process.env.LOOPBACK_BENCH_DURATION_SECONDS,
    60,
    "LOOPBACK_BENCH_DURATION_SECONDS",
  );
  const modes = (process.env.LOOPBACK_BENCH_MODES || "inline-pdf,rendered-pages")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (modes.length === 0 || modes.some((mode) => mode !== "inline-pdf" && mode !== "rendered-pages")) {
    throw new Error("LOOPBACK_BENCH_MODES must contain inline-pdf and/or rendered-pages");
  }
  return {
    backlog: positiveInteger(
      process.env.LOOPBACK_BENCH_BACKLOG,
      runnerConcurrency * 4,
      "LOOPBACK_BENCH_BACKLOG",
    ),
    drainTimeoutSeconds: positiveInteger(
      process.env.LOOPBACK_BENCH_DRAIN_TIMEOUT_SECONDS,
      180,
      "LOOPBACK_BENCH_DRAIN_TIMEOUT_SECONDS",
    ),
    durationSeconds,
    gatewayLatencyMs: nonNegativeInteger(
      process.env.LOOPBACK_BENCH_GATEWAY_LATENCY_MS,
      0,
      "LOOPBACK_BENCH_GATEWAY_LATENCY_MS",
    ),
    inlinePayloadBytes: nonNegativeInteger(
      process.env.LOOPBACK_BENCH_INLINE_PAYLOAD_BYTES,
      1024 * 1024,
      "LOOPBACK_BENCH_INLINE_PAYLOAD_BYTES",
    ),
    modes: modes as BenchmarkMode[],
    renderPages: positiveInteger(
      process.env.LOOPBACK_BENCH_RENDER_PAGES,
      2,
      "LOOPBACK_BENCH_RENDER_PAGES",
    ),
    runnerConcurrency,
    submitters: positiveInteger(
      process.env.LOOPBACK_BENCH_SUBMITTERS,
      Math.min(128, runnerConcurrency * 2),
      "LOOPBACK_BENCH_SUBMITTERS",
    ),
    warmupSeconds: Math.min(
      Math.max(0, durationSeconds - 1),
      nonNegativeInteger(
        process.env.LOOPBACK_BENCH_WARMUP_SECONDS,
        Math.min(10, Math.floor(durationSeconds / 6)),
        "LOOPBACK_BENCH_WARMUP_SECONDS",
      ),
    ),
  };
}

function minimalEnvironment(extra: Record<string, string>): Record<string, string> {
  return {
    NO_COLOR: "1",
    PATH: process.env.PATH || "",
    TMPDIR: process.env.TMPDIR || tmpdir(),
    ...extra,
  };
}

function assertLoopbackOrigin(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) {
    throw new Error(`Benchmark network target must be explicit loopback HTTP, received ${url.origin}`);
  }
}

async function gitRevision(): Promise<string> {
  const child = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    stderr: "ignore",
    stdout: "pipe",
  });
  const [revision, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  return code === 0 ? revision.trim() : "unknown";
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

function max(values: number[]): number {
  return values.length > 0 ? Math.max(...values) : 0;
}

function min(values: number[]): number {
  return values.length > 0 ? Math.min(...values) : 0;
}

function timeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runGatewayChild(): Promise<void> {
  const latencyMs = nonNegativeInteger(
    process.env.LOOPBACK_GATEWAY_LATENCY_MS,
    0,
    "LOOPBACK_GATEWAY_LATENCY_MS",
  );
  const expectedToken = process.env.LOOPBACK_GATEWAY_TOKEN || gatewayToken;
  const startedAt = performance.now();
  const cpuStartedAt = process.cpuUsage();
  let active = 0;
  let bytesReceived = 0;
  let peakActive = 0;
  let peakRssBytes = process.memoryUsage.rss();
  let requests = 0;
  const report = (): GatewayReport => {
    const elapsedMs = Math.max(1, performance.now() - startedAt);
    const cpu = process.cpuUsage(cpuStartedAt);
    return {
      active,
      bytesReceived,
      cpuCoreEquivalents: (cpu.user + cpu.system) / (elapsedMs * 1_000),
      cpuSystemMs: cpu.system / 1_000,
      cpuUserMs: cpu.user / 1_000,
      elapsedMs,
      peakActive,
      peakRssBytes,
      requests,
    };
  };
  const stop = () => {
    void server.stop(true).finally(() => process.exit(0));
  };
  const server = Bun.serve({
    fetch: async (request) => {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/__benchmark/report") {
        return Response.json(report());
      }
      if (request.method === "POST" && url.pathname === "/__benchmark/shutdown") {
        setTimeout(stop, 10);
        return Response.json({ ok: true });
      }
      if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
        return Response.json({ error: { message: "Not found" } }, { status: 404 });
      }
      if (request.headers.get("authorization") !== `Bearer ${expectedToken}`) {
        return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
      }
      active += 1;
      peakActive = Math.max(peakActive, active);
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
      try {
        const body = await request.arrayBuffer();
        bytesReceived += body.byteLength;
        requests += 1;
        if (latencyMs > 0) await Bun.sleep(latencyMs);
        return Response.json({
          choices: [{ message: { content: resultContent, role: "assistant" } }],
          created: Math.floor(Date.now() / 1_000),
          id: `loopback-${requests}`,
          model: "benchmark/loopback",
          object: "chat.completion",
        });
      } finally {
        active -= 1;
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
      }
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(`LOOPBACK_GATEWAY_READY ${JSON.stringify({ origin: `http://127.0.0.1:${server.port}` })}`);
}

if (process.argv.includes("--gateway-child")) {
  await runGatewayChild();
} else {
  await runCoordinator();
}
