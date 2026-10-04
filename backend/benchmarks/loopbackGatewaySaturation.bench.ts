import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Database } from "bun:sqlite";

import { createLocalAuth } from "../src/localAuth";
import { ensureLocalStateDirectories } from "../src/localRuntime";
import { createLocalWorkspaceControl } from "../src/localWorkspaceControl";
import { createLocalWorkspaceProductStore } from "../src/localWorkspaceProductStore";
import { PDF_INSPECTION_LIMITS } from "../src/lib/pdfInspectionLimits";
import { PDF_PAGE_OPERATION_LIMITS } from "../src/lib/pdfPageOperations";

import {
  benchmarkModelName, benchmarkScenarios, benchmarkTemplateId, benchmarkTemplateTag,
  scenarioWorkload, simulateModelResponse, submissionRetryDelayMs, summarizeOutcomes, waitForBenchmarkDrain,
  type BenchmarkScenario, type ModelStage, type TimedOutcome,
} from "./loopbackWorkload";

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
  requestsByStage: Record<ModelStage, number>;
  invalidRequests: number;
};

type ProcessSample = {
  childCpuPercent: number;
  childRssBytes: number;
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
  memoryLimitRatio: number;
  preparationMaxBytes: number;
  cpuProfile: boolean;
  modes: BenchmarkMode[];
  scenarios: BenchmarkScenario[];
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

type PersistedTiming = ReturnType<typeof summarizeOutcomes> & {
  submissions: ReturnType<typeof summarizeOutcomes>;
};

type ModeResult = {
  accepted: number;
  scenario: BenchmarkScenario;
  jobsPerSubmission: number;
  app: {
    peakProcessTreeRssBytes: number;
    peakProcessTreeCpuCoreEquivalents: number;
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
    path: string | null;
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
  runtime: { version: string; revision: string };
  processingLimits: { inspection: typeof PDF_INSPECTION_LIMITS; pageOperations: typeof PDF_PAGE_OPERATION_LIMITS };
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
    `scenarios=${settings.scenarios.join(",")}`,
    `duration=${settings.durationSeconds}s per mode/scenario`,
    `runner_concurrency=${settings.runnerConcurrency}`,
    `submitters=${settings.submitters}`,
    `backlog=${settings.backlog}`,
    "network_safety=127.0.0.1 only; .env loading disabled",
    "",
  ].join("\n"));

  for (const mode of settings.modes) {
    // Reuse identical PDF bytes across scenarios so routing/splitting is the changed variable.
    const fixture = await createFixture(mode, settings);
    for (const scenario of settings.scenarios) {
      process.stdout.write(`Starting ${mode}/${scenario} saturation pass...\n`);
      const result = await runMode({ mode, scenario, fixture, runDirectory, settings });
      results.push(result);
      await writeFile(join(runDirectory, mode, scenario, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(`${mode}/${scenario}: ${formatNumber(result.serverTiming.submissions.measurementJobsPerSecond)} uploads/s | ${formatNumber(result.serverTiming.measurementJobsPerSecond)} jobs/s | completed=${result.serverTiming.completed}\n`);
    }
  }

  const evidence: BenchmarkEvidence = {
    command: [
      `LOOPBACK_BENCH_DURATION_SECONDS=${settings.durationSeconds}`,
      `LOOPBACK_BENCH_WARMUP_SECONDS=${settings.warmupSeconds}`,
      `LOOPBACK_BENCH_MODES=${settings.modes.join(",")}`,
      `LOOPBACK_BENCH_SCENARIOS=${settings.scenarios.join(",")}`,
      `LOOPBACK_BENCH_RUNNER_CONCURRENCY=${settings.runnerConcurrency}`,
      `LOOPBACK_BENCH_SUBMITTERS=${settings.submitters}`,
      `LOOPBACK_BENCH_BACKLOG=${settings.backlog}`,
      `LOOPBACK_BENCH_GATEWAY_LATENCY_MS=${settings.gatewayLatencyMs}`,
      `LOOPBACK_BENCH_INLINE_PAYLOAD_BYTES=${settings.inlinePayloadBytes}`,
      `LOOPBACK_BENCH_CPU_PROFILE=${settings.cpuProfile ? "true" : "false"}`,
      `LOOPBACK_BENCH_MEMORY_LIMIT_RATIO=${settings.memoryLimitRatio}`,
      `LOOPBACK_BENCH_PREPARATION_MAX_BYTES=${settings.preparationMaxBytes}`,
      `LOOPBACK_BENCH_RENDER_PAGES=${settings.renderPages}`,
      `LOOPBACK_BENCH_DRAIN_TIMEOUT_SECONDS=${settings.drainTimeoutSeconds}`,
      "bun run benchmark:loopback-saturation",
    ].join(" "),
    generatedAt: new Date().toISOString(),
    host: {
      architecture: arch(),
      cpuCount: cpus().length,
      cpuModel: cpus()[0]?.model ?? "unknown CPU",
      memoryBytes: totalmem(),
      platform: platform(),
    },
    repositoryRevision: await gitRevision(),
    runtime: { version: Bun.version, revision: Bun.revision },
    processingLimits: { inspection: PDF_INSPECTION_LIMITS, pageOperations: PDF_PAGE_OPERATION_LIMITS },
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

  if (results.some((result) => resultFailures(result).length > 0)) {
    process.exitCode = 1;
  }
}

async function runMode({
  mode,
  scenario,
  fixture,
  runDirectory,
  settings,
}: {
  mode: BenchmarkMode;
  scenario: BenchmarkScenario;
  fixture: Uint8Array;
  runDirectory: string;
  settings: BenchmarkSettings;
}): Promise<ModeResult> {
  const modeDirectory = join(runDirectory, mode, scenario);
  const stateDirectory = join(modeDirectory, "state");
  const profileDirectory = join(modeDirectory, "profile");
  await Promise.all([
    mkdir(stateDirectory, { recursive: true }),
    mkdir(profileDirectory, { recursive: true }),
  ]);
  const fixtureIdentity = identityForFixture(fixture, settings.renderPages);
  const workload = scenarioWorkload(scenario, fixtureIdentity.pages);
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
      headers: { cookie: workspace.sessionCookie, origin: app.origin, "content-type": "application/json", "if-none-match": "*" },
      body: JSON.stringify({
        gateway_url: new URL("/v1/", gateway.origin).toString(),
        // Exercise the named JSON-schema contracts used to identify simulated stages.
        model_name: benchmarkModelName,
        credential: gatewayToken,
        sequential_calls: false,
        supports_pdf_input: mode === "inline-pdf",
        supports_structured_output: true,
      }),
    });
    if (configuration.status !== 201) throw new Error(`Benchmark Workspace configuration failed (${configuration.status}).`);
    const processing = await fetch(new URL(`/v1/workspaces/${workspace.workspaceId}/document-processing-settings`, app.origin), {
      method: "PUT",
      headers: { cookie: workspace.sessionCookie, origin: app.origin, "content-type": "application/json" },
      body: JSON.stringify({ enable_smart_splitting: workload.splitting, exclude_blank_pages: false }),
    });
    if (!processing.ok) throw new Error(`Benchmark document processing configuration failed (${processing.status}).`);
    const load = await generateLoad({
      observationPath: join(modeDirectory, "observations.jsonl"),
      workload,
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
      jobsPerSubmission: workload.jobsPerSubmission,
      splitting: workload.splitting,
      loadStartedAt: load.loadStartedAt,
      loadStoppedAt: load.loadStoppedAt,
      stateDirectory,
      warmupSeconds: settings.warmupSeconds,
      workspaceId: workspace.workspaceId,
    });
    const profilePath = join(profileDirectory, "app-cpu.md");
    const profileMarkdown = settings.cpuProfile ? await readFile(profilePath, "utf8") : "";
    const observations = load.observations;
    return {
      accepted: load.accepted,
      scenario,
      jobsPerSubmission: workload.jobsPerSubmission,
      app: {
        peakProcessTreeRssBytes: max(observations.map(({ appProcess }) => (appProcess?.rssBytes ?? 0) + (appProcess?.childRssBytes ?? 0))),
        peakProcessTreeCpuCoreEquivalents: max(observations.map(({ appProcess }) => ((appProcess?.cpuPercent ?? 0) + (appProcess?.childCpuPercent ?? 0)) / 100)),
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
        path: settings.cpuProfile ? profilePath : null,
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
    await writeFile(join(modeDirectory, "error.json"), JSON.stringify({ error: errorMessage(error), exitCode: app?.process.child.exitCode, limits: { inspection: PDF_INSPECTION_LIMITS, pageOperations: PDF_PAGE_OPERATION_LIMITS } }, null, 2)).catch(() => undefined);
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
  observationPath,
  workload,
  apiKey,
  app,
  fixture,
  sessionCookie,
  settings,
  templateId,
  workspaceId,
}: {
  observationPath: string;
  workload: ReturnType<typeof scenarioWorkload>;
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
      await Promise.race([Bun.sleep(1_000), monitorStopped]);
      if (!monitoring) break;
      try {
        const [health, appProcess] = await Promise.all([
          readHealth(app.origin),
          sampleProcess(app.process.child.pid),
        ]);
        const observation = { appProcess, at: new Date().toISOString(), health };
        observations.push(observation);
        await appendFile(observationPath, `${JSON.stringify(observation)}\n`);
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
      if (accepted - terminalJobIds.size / workload.jobsPerSubmission >= settings.backlog) {
        await Bun.sleep(5);
        continue;
      }
      const index = sequence;
      sequence += 1;
      const form = new FormData();
      if (workload.automatic) form.append("template_tags", JSON.stringify([benchmarkTemplateTag]));
      else form.append("template_id", templateId);
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
        const body = await response.json() as { job_id?: unknown; packet_id?: unknown };
        const id = workload.splitting ? body.packet_id : body.job_id;
        if (typeof id !== "string" && unexpectedResponses.length < 20) {
          unexpectedResponses.push(`submission HTTP 202 returned no ${workload.splitting ? "packet_id" : "job_id"}`);
        }
        continue;
      }
      const body = (await response.text()).slice(0, 300);
      if (response.status === 503) {
        rejected += 1;
        const delay = submissionRetryDelayMs(response.headers.get("retry-after")) + Math.floor(Math.random() * 250);
        await Bun.sleep(Math.min(delay, Math.max(0, loadDeadline - Date.now())));
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

  while (Date.now() < drainDeadline && terminalJobIds.size < accepted * workload.jobsPerSubmission) {
    await Bun.sleep(25);
  }
  await waitForBenchmarkDrain(async () => ({
    ...(await readHealth(app.origin)).diagnostics.extractionQueue,
    terminalJobs: terminalJobIds.size,
  }), accepted * workload.jobsPerSubmission, drainDeadline);
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
  if (terminalJobIds.size !== accepted * workload.jobsPerSubmission) {
    unexpectedResponses.push(`drain incomplete: ${terminalJobIds.size}/${accepted * workload.jobsPerSubmission} terminal jobs`);
  }
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
      requireEmailVerification: true,
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
    const templateId = benchmarkTemplateId;
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
        tags: [benchmarkTemplateTag],
        templateId,
      });
      productStore.createTemplate({
        createdAt: new Date().toISOString(), templateId: "tpl_loopback_alternative",
        name: "Unrelated document", description: "A different synthetic document category",
        tags: [benchmarkTemplateTag],
        fields: [{ id: "other", name: "Other", description: "Other", data_type: "string" }],
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
  const pages = settings.renderPages;
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
    ...(settings.cpuProfile ? ["--cpu-prof-md", "--cpu-prof-name", "app-cpu.md", "--cpu-prof-dir", profileDirectory] : []),
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
      LOCAL_MEMORY_LIMIT_RATIO: String(settings.memoryLimitRatio),
      MODEL_PREPARATION_MAX_BYTES: String(settings.preparationMaxBytes),
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
    const child = Bun.spawn(["ps", "-eo", "pid=,ppid=,pcpu=,rss="], {
      stderr: "ignore",
      stdout: "pipe",
    });
    const [text, code] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    if (code !== 0) return null;
    const rows = text.trim().split("\n").map((line) => {
      const [id, parent, cpu, rss] = line.trim().split(/\s+/).map(Number);
      return { id: id!, parent: parent!, cpu: cpu!, rss: rss! };
    }).filter((row) => Object.values(row).every(Number.isFinite));
    const app = rows.find((row) => row.id === pid);
    if (!app) return null;
    const descendants = new Set([pid]);
    for (let previous = 0; previous !== descendants.size;) {
      previous = descendants.size;
      for (const row of rows) if (descendants.has(row.parent)) descendants.add(row.id);
    }
    const children = rows.filter((row) => row.id !== pid && descendants.has(row.id));
    return {
      cpuPercent: app.cpu, rssBytes: app.rss * 1024,
      childCpuPercent: children.reduce((sum, row) => sum + row.cpu, 0),
      childRssBytes: children.reduce((sum, row) => sum + row.rss * 1024, 0),
    };
  } catch {
    return null;
  }
}

export function readPersistedTiming({
  loadStartedAt, loadStoppedAt, stateDirectory, warmupSeconds, workspaceId, splitting, jobsPerSubmission,
}: {
  loadStartedAt: string; loadStoppedAt: string; stateDirectory: string; warmupSeconds: number;
  workspaceId: string; splitting: boolean; jobsPerSubmission: number;
}): PersistedTiming {
  const database = new Database(join(stateDirectory, "data", "workspaces", `${workspaceId}.sqlite`), { readonly: true });
  try {
    const rows = database.query("SELECT status, created_at, completed_at FROM jobs").all() as TimedOutcome[];
    const stopMs = Date.parse(loadStoppedAt);
    const startMs = Math.min(stopMs, Date.parse(loadStartedAt) + warmupSeconds * 1_000);
    let submissions = rows;
    if (splitting) {
      // Packet status may be refreshed lazily by GET. Durable child completions determine completion.
      const packets = database.query(`
        SELECT p.status, p.created_at, MAX(j.completed_at) AS completed_at,
          COUNT(c.job_id) AS children,
          SUM(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END) AS completed_children,
          SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) AS failed_children
        FROM document_packets p
        LEFT JOIN document_packet_children c ON c.packet_id = p.id
        LEFT JOIN jobs j ON j.id = c.job_id
        GROUP BY p.id
      `).all() as Array<TimedOutcome & { children: number; completed_children: number; failed_children: number }>;
      submissions = packets.map((packet) => ({
        ...packet,
        status: packet.status === "failed" || packet.failed_children > 0 ? "failed"
          : ["completed", "processing_children"].includes(packet.status)
            && packet.children === jobsPerSubmission && packet.completed_children === jobsPerSubmission
            ? "completed" : "incomplete",
      }));
    }
    return { ...summarizeOutcomes(rows, startMs, stopMs), submissions: summarizeOutcomes(submissions, startMs, stopMs) };
  } finally {
    database.close();
  }
}

export function resultFailures(result: Pick<ModeResult, "accepted" | "scenario" | "jobsPerSubmission" | "serverTiming" | "gateway" | "client">): string[] {
  const failures: string[] = [];
  const expected = result.accepted * result.jobsPerSubmission;
  const workload = scenarioWorkload(result.scenario, result.jobsPerSubmission);
  if (result.accepted === 0) failures.push("No uploads were accepted");
  if (result.serverTiming.submissions.completed !== result.accepted) failures.push("Not all uploads completed");
  if (result.serverTiming.completed !== expected || result.serverTiming.failed > 0 || result.serverTiming.other > 0) failures.push("Unexpected extraction job outcomes");
  const expectedCalls = { extraction: expected, classification: workload.automatic ? expected : 0, splitting: workload.splitting ? result.accepted : 0 };
  for (const stage of Object.keys(expectedCalls) as ModelStage[]) {
    if (result.gateway.requestsByStage[stage] !== expectedCalls[stage]) failures.push(`Unexpected ${stage} call count: ${result.gateway.requestsByStage[stage]}/${expectedCalls[stage]}`);
  }
  if (result.gateway.invalidRequests > 0) failures.push("Unrecognized simulated model requests");
  if (result.client.networkErrors > 0 || result.client.unexpectedResponses.length > 0) failures.push("Load or drain errors");
  return failures;
}

export function renderReport(evidence: BenchmarkEvidence, runDirectory: string): string {
  const lines = [
    "# Loopback Model gateway saturation benchmark",
    "",
    `Generated ${evidence.generatedAt} at revision \`${evidence.repositoryRevision}\` on ${evidence.host.cpuModel} (${evidence.host.cpuCount} logical CPUs, ${formatBytes(evidence.host.memoryBytes)} RAM).`,
    "",
    "The application, load generator, and fake OpenAI-compatible Gateway ran as separate processes. CPU profiling is opt-in: Bun 1.4.2 retains sampled closures and inflates memory under --cpu-prof. Profiled runs are diagnostic and must not be used as capacity or memory baselines. Both configured Gateway and application origins were rejected unless they were explicit `http://127.0.0.1:<port>` URLs, and every Bun child ran with `.env` loading disabled.",
    "",
    `Runtime: Bun ${evidence.runtime.version} (${evidence.runtime.revision}).`,
    "",
    "## Results",
    "",
    "| Mode / scenario | Uploads/s | Jobs/s | Completed uploads / jobs | Upload lifecycle p50/p95 | App peak CPU | App / process tree peak RSS | Event-loop lag | Queue pending peak | Min permits | Gateway CPU / peak active | Client CPU |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...evidence.results.map((result) => [
      `| ${result.mode} / ${result.scenario}`,
      formatNumber(result.serverTiming.submissions.measurementJobsPerSecond),
      formatNumber(result.serverTiming.measurementJobsPerSecond),
      `${result.serverTiming.submissions.completed}/${result.accepted} uploads; ${result.serverTiming.completed}/${result.accepted * result.jobsPerSubmission} jobs`,
      `${formatNumber(result.serverTiming.submissions.lifecycleP50Ms)}/${formatNumber(result.serverTiming.submissions.lifecycleP95Ms)} ms`,
      `${formatNumber(result.app.peakCpuCoreEquivalents)} cores (${formatPercent(result.app.peakHealthNormalizedCpu)})`,
      `${formatBytes(result.app.peakRssBytes)} / ${formatBytes(result.app.peakProcessTreeRssBytes)}`,
      `${formatNumber(result.app.peakEventLoopLagMs)} ms`,
      String(result.queue.peakPending),
      String(result.app.minimumPermits),
      `${formatNumber(result.gateway.cpuCoreEquivalents)} cores / ${result.gateway.peakActive}`,
      `${formatNumber(result.client.cpuCoreEquivalents)} cores |`,
    ].join(" | ")),
    "",
    "Uploads/s counts fully completed submissions in the steady window. A split upload completes at its last child's persisted completion timestamp; upload latency starts at persisted acceptance and includes assessment, materialization, routing, and all child extractions. Jobs/s counts extracted Documents, so splitting can increase jobs per upload. Warm-up and drain completions are excluded from both rates; latency percentiles include all completed work. Full job latency and completion-span figures remain in `result.json`. Process-tree RSS includes PDF subprocesses; it sums resident pages, so shared pages can be counted more than once. CPU samples from ps are process-lifetime averages; short-lived children between samples may be missed.",
    "",
    `Every scenario within a PDF mode uses identical ${evidence.settings.renderPages}-page fixture bytes, two tagged candidate Templates, and fresh state. The simulated split produces one Document per page with no exclusions. Real production classification, PDF preparation, child materialization, and extraction paths run against deterministic model replies. Each model call delays ${evidence.settings.gatewayLatencyMs} ms. This measures processing overhead, not model decision quality. Adaptive tuning is disabled; production resource limits and memory-pressure pauses remain active. Differences are single-pass observations and should be repeated before drawing capacity conclusions.`,
    "",
    "## Impact relative to explicit template without splitting",
    "",
    "| Mode / scenario | Upload throughput change | Upload p95 change | Extraction / classification / split calls | Validation |",
    "| --- | ---: | ---: | ---: | --- |",
    ...evidence.results.map((result) => {
      const baseline = evidence.results.find((candidate) => candidate.mode === result.mode && candidate.scenario === "explicit");
      const baseRate = baseline?.serverTiming.submissions.measurementJobsPerSecond ?? 0;
      const rateChange = baseRate > 0 && result.serverTiming.submissions.measurementCompleted > 0
        ? formatPercent(result.serverTiming.submissions.measurementJobsPerSecond / baseRate - 1)
        : "n/a (no measured completions or baseline)";
      const latencyChange = baseline ? `${formatNumber(result.serverTiming.submissions.lifecycleP95Ms - baseline.serverTiming.submissions.lifecycleP95Ms)} ms` : "n/a";
      const calls = result.gateway.requestsByStage;
      const failures = resultFailures(result);
      return `| ${result.mode} / ${result.scenario} | ${rateChange} | ${latencyChange} | ${calls.extraction} / ${calls.classification} / ${calls.splitting} | ${failures.length ? failures.join("; ") : "PASS"} |`;
    }),
    "",
    "## Bottleneck signals",
    "",
    ...evidence.results.flatMap((result) => bottleneckFindings(
      result,
      evidence.host.cpuCount,
      evidence.host.memoryBytes,
    ).map((finding) => `- **${result.mode}/${result.scenario}:** ${finding}`)),
    "",
    "## CPU profile leaders",
    "",
    ...evidence.results.flatMap((result) => [
      `### ${result.mode}/${result.scenario}`,
      "",
      result.profile.path ? `Profile: \`${result.profile.path}\`` : "CPU profiling disabled for capacity measurement.",
      "",
      ...(result.profile.topFunctions.length > 0
        ? result.profile.topFunctions.map((row) => `- ${row}`)
        : result.profile.path ? ["- Bun emitted no parseable hot-function rows."] : []),
      "",
    ]),
    "## Reproduce",
    "",
    "```bash",
    evidence.command,
    "```",
    "",
    "Useful controls: `LOOPBACK_BENCH_SCENARIOS`, `LOOPBACK_BENCH_GATEWAY_LATENCY_MS`, `LOOPBACK_BENCH_DURATION_SECONDS`, `LOOPBACK_BENCH_MODES`, `LOOPBACK_BENCH_RUNNER_CONCURRENCY`, `LOOPBACK_BENCH_SUBMITTERS`, `LOOPBACK_BENCH_BACKLOG`, `LOOPBACK_BENCH_INLINE_PAYLOAD_BYTES`, and `LOOPBACK_BENCH_RENDER_PAGES`.",
    "",
    `Raw logs, isolated state, fixtures, profiles, and JSON evidence: \`${runDirectory}\``,
  ];
  return lines.join("\n");
}

function bottleneckFindings(result: ModeResult, cpuCount: number, hostMemoryBytes: number): string[] {
  const findings: string[] = [];
  if (result.serverTiming.submissions.measurementCompleted === 0) {
    findings.push("no uploads completed inside the measurement window; increase duration before interpreting throughput changes. Validation only confirms that accepted work eventually completed.");
  }
  if (result.queue.peakPending > 0 && result.queue.peakActive >= 1) {
    findings.push(`the extraction queue built a backlog (active peak ${result.queue.peakActive}, pending peak ${result.queue.peakPending}); inspect PDF and preparation admission before raising runner concurrency.`);
  } else if (result.client.rejected > 0) {
    findings.push("admission rejected excess uploads before they could enter the extraction queue; an empty pending queue does not imply insufficient offered load.");
  } else {
    findings.push("the extraction queue did not build a pending backlog; increase submitters/backlog before treating this as a capacity ceiling.");
  }
  if (result.app.peakCpuCoreEquivalents >= 0.85) {
    findings.push(`sampled API CPU reached ${formatNumber(result.app.peakCpuCoreEquivalents)} core-equivalents; the resource controller measured API CPU up to ${formatPercent(result.app.peakHealthNormalizedCpu)} of ${cpuCount} logical CPUs. A small number of hot runtime/native threads can therefore saturate without a conspicuous whole-machine spike.`);
  } else if (result.queue.peakPending > 0) {
    findings.push(`the queue grew while application CPU stayed below one full core (${formatNumber(result.app.peakCpuCoreEquivalents)}); inspect stage queues and SQLite/filesystem/HTTP waits before attributing the limit to CPU.`);
  }
  if (result.app.peakEventLoopLagMs >= 250) {
    findings.push(`event-loop lag reached ${formatNumber(result.app.peakEventLoopLagMs)} ms, which is a software scheduling/backpressure limit.`);
  }
  if (result.app.minimumPermits === 0) {
    findings.push("the production resource controller paused extraction during the run; raw health samples distinguish event-loop, RSS, and operating-system pressure causes.");
  }
  const hostMemoryFraction = result.app.peakRssBytes / Math.max(1, hostMemoryBytes);
  if (hostMemoryFraction >= 0.2) {
    findings.push(`application RSS reached ${formatBytes(result.app.peakRssBytes)} (${formatPercent(hostMemoryFraction)} of physical memory), which must be compared with the configured memory threshold and pressure samples before concluding that memory constrained throughput.`);
  }
  if (result.gateway.cpuCoreEquivalents >= Math.max(0.8, result.app.peakCpuCoreEquivalents * 0.8)) {
    findings.push(`the fake Gateway itself consumed ${formatNumber(result.gateway.cpuCoreEquivalents)} core-equivalents; its request-body consumption is material and must remain separately attributed.`);
  } else {
    findings.push(`the fake Gateway used ${formatNumber(result.gateway.cpuCoreEquivalents)} core-equivalents and had no imposed concurrency ceiling; the configured simulated response delay still applies.`);
  }
  if (result.client.rejected > 0 || result.client.networkErrors > 0 || result.client.unexpectedResponses.length > 0) {
    findings.push(`admission backpressure: ${result.client.rejected} retryable rejections; load errors: ${result.client.networkErrors} network errors and ${result.client.unexpectedResponses.length} unexpected observations.`);
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
  const memoryLimitRatio = Number(process.env.LOOPBACK_BENCH_MEMORY_LIMIT_RATIO ?? "0.25");
  if (!Number.isFinite(memoryLimitRatio) || memoryLimitRatio <= 0 || memoryLimitRatio > 1) throw new Error("LOOPBACK_BENCH_MEMORY_LIMIT_RATIO must be greater than zero and no greater than one");
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
  if (modes.length === 0 || new Set(modes).size !== modes.length
    || modes.some((mode) => mode !== "inline-pdf" && mode !== "rendered-pages")) {
    throw new Error("LOOPBACK_BENCH_MODES must contain inline-pdf and/or rendered-pages");
  }
  const scenarios = (process.env.LOOPBACK_BENCH_SCENARIOS || benchmarkScenarios.join(","))
    .split(",").map((value) => value.trim()).filter(Boolean);
  if (!scenarios.length || new Set(scenarios).size !== scenarios.length
    || scenarios.some((scenario) => !benchmarkScenarios.includes(scenario as BenchmarkScenario))) {
    throw new Error(`LOOPBACK_BENCH_SCENARIOS must contain unique values from ${benchmarkScenarios.join(",")}`);
  }
  return {
    cpuProfile: process.env.LOOPBACK_BENCH_CPU_PROFILE === "true",
    memoryLimitRatio,
    preparationMaxBytes: positiveInteger(process.env.LOOPBACK_BENCH_PREPARATION_MAX_BYTES,
      Math.min(512 * 1024 * 1024, Math.floor(totalmem() * memoryLimitRatio * 0.9)), "LOOPBACK_BENCH_PREPARATION_MAX_BYTES"),
    scenarios: scenarios as BenchmarkScenario[],
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
  let invalidRequests = 0;
  const requestsByStage: Record<ModelStage, number> = { extraction: 0, classification: 0, splitting: 0 };
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
      requestsByStage: { ...requestsByStage },
      invalidRequests,
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
        const simulated = simulateModelResponse(JSON.parse(new TextDecoder().decode(body)));
        requestsByStage[simulated.stage] += 1;
        if (latencyMs > 0) await Bun.sleep(latencyMs);
        return Response.json({
          choices: [{ message: { content: simulated.content, role: "assistant" } }],
          created: Math.floor(Date.now() / 1_000),
          id: `loopback-${requests}`,
          model: benchmarkModelName,
          object: "chat.completion",
        });
      } catch (error) {
        invalidRequests += 1;
        return Response.json({ error: { message: errorMessage(error) } }, { status: 400 });
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
} else if (import.meta.main) {
  await runCoordinator();
}
