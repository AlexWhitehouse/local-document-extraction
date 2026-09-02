import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  startLocalRuntimeSmokeProcess,
  type LocalRuntimeSmokeProcess,
} from "../src/testSupport/localRuntimeProcess";

const RUN_COUNT = 100;
const CONCURRENCY = 10;
const STATE_PREFIX = "document-extraction-smoke-stress-";
const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateDirectories = new Set<string>();
const runtimes = new Set<LocalRuntimeSmokeProcess>();
const origins: string[] = [];
const beforeEntries = await stressStateEntries();
const startedAt = performance.now();
let nextRun = 0;

try {
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const run = nextRun;
      nextRun += 1;
      if (run >= RUN_COUNT) return;

      const stateDirectory = await mkdtemp(join(tmpdir(), STATE_PREFIX));
      stateDirectories.add(stateDirectory);
      let runtime: LocalRuntimeSmokeProcess | null = null;
      try {
        runtime = await startLocalRuntimeSmokeProcess({
          backendDirectory,
          env: {
            ...process.env,
            DOCUMENT_EXTRACTION_STATE_DIR: stateDirectory,
            EXTRACTION_RECONCILE_INTERVAL_MS: "60000",
            FAILED_SOURCE_RETENTION_MS: "60000",
            LOCAL_SHUTDOWN_TIMEOUT_MS: "250",
            SOURCE_RETENTION_SWEEP_INTERVAL_MS: "60000",
          },
        });
        runtimes.add(runtime);
        origins.push(runtime.origin);
        const response = await fetch(`${runtime.origin}/v1/health`);
        if (!response.ok) throw new Error(`Run ${run} health returned ${response.status}`);
        const exitCode = await runtime.stop();
        if (exitCode !== 0) throw new Error(`Run ${run} exited with code ${exitCode}`);
      } finally {
        if (runtime) {
          runtimes.delete(runtime);
          await runtime.stop().catch(() => undefined);
        }
        await rm(stateDirectory, { recursive: true, force: true });
        stateDirectories.delete(stateDirectory);
      }
    }
  }));
} finally {
  await Promise.all([...runtimes].map((runtime) => runtime.stop("SIGKILL").catch(() => undefined)));
  await Promise.all([...stateDirectories].map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
}

const afterEntries = await stressStateEntries();
const leakedEntries = [...afterEntries].filter((entry) => !beforeEntries.has(entry));
if (leakedEntries.length) {
  throw new Error(`Stress run leaked temporary state: ${leakedEntries.join(", ")}`);
}

const stillListening = await Promise.all(origins.map(async (origin) => {
  try {
    await fetch(`${origin}/v1/health`, { signal: AbortSignal.timeout(100) });
    return origin;
  } catch {
    return null;
  }
}));
const openOrigins = stillListening.filter(Boolean);
if (openOrigins.length) {
  throw new Error(`Stress run left listeners reachable: ${openOrigins.join(", ")}`);
}

console.log([
  `Local Runtime smoke stress passed: ${RUN_COUNT} runs`,
  `concurrency=${CONCURRENCY}`,
  `elapsed_ms=${(performance.now() - startedAt).toFixed(1)}`,
  "address_in_use=0",
  "startup_failures=0",
  "child_processes_remaining=0",
  "listeners_remaining=0",
  "temporary_directories_leaked=0",
].join("\n"));

async function stressStateEntries(): Promise<Set<string>> {
  return new Set((await readdir(tmpdir())).filter((entry) => entry.startsWith(STATE_PREFIX)));
}
