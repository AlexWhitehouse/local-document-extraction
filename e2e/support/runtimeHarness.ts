import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  AsyncCleanupStack,
  startLocalRuntimeSmokeProcess,
} from "../../backend/src/testSupport/localRuntimeProcess";

const rootDirectory = resolve(import.meta.dir, "../..");
const cleanup = new AsyncCleanupStack();
let exitCode = 0;

try {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-browser-journey-"));
  cleanup.defer(async () => {
    console.log("E2E_CLEANUP state_start");
    await rm(stateDirectory, { recursive: true, force: true });
    console.log("E2E_CLEANUP state_done");
  });

  let requestShutdown!: () => void;
  const shutdownRequested = new Promise<void>((resolvePromise) => {
    requestShutdown = resolvePromise;
  });

  const modelGateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/__e2e/shutdown" && request.method === "POST") {
        requestShutdown();
        return new Response(null, { status: 202 });
      }
      if (url.pathname !== "/chat/completions" || request.method !== "POST") {
        return new Response("Not found", { status: 404 });
      }
      if (request.headers.get("authorization") !== "Bearer browser-journey-key") {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      await request.json();
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              results: [{
                field_id: "invoice_number",
                status: "ok",
                answer: "INV-E2E-001",
                confidence: 0.99,
                evidence: "Invoice identifier on the first page.",
              }],
            }),
          },
        }],
      });
    },
  });
  cleanup.defer(async () => {
    console.log("E2E_CLEANUP gateway_start");
    await modelGateway.stop(true);
    console.log("E2E_CLEANUP gateway_done");
  });

  const runtime = await startLocalRuntimeSmokeProcess({
    backendDirectory: resolve(rootDirectory, "backend"),
    timeoutMs: 15_000,
    env: {
      ...process.env,
      BETTER_AUTH_SECRET: "browser-journey-auth-secret-at-least-32-characters",
      DOCUMENT_EXTRACTION_ADMIN_EMAILS: "browser-admin@example.test",
      DOCUMENT_EXTRACTION_STATE_DIR: stateDirectory,
      LITELLM_KEY: "browser-journey-key",
      LOCAL_SHUTDOWN_TIMEOUT_MS: "5000",
      MODEL_GATEWAY_URL: `http://127.0.0.1:${modelGateway.port}`,
      NODE_ENV: "test",
    },
  });
  cleanup.defer(async () => {
    console.log("E2E_CLEANUP runtime_start");
    const runtimeExitCode = await runtime.stop();
    console.log(`E2E_CLEANUP runtime_done code=${runtimeExitCode}`);
    if (runtimeExitCode !== 0) {
      throw new Error(`Local Bun Runtime exited with code ${runtimeExitCode}`);
    }
  });

  console.log(`E2E_RUNTIME_READY ${JSON.stringify({
    bunVersion: Bun.version,
    controlOrigin: `http://127.0.0.1:${modelGateway.port}`,
    origin: runtime.origin,
    stateDirectory,
  })}`);
  await waitForShutdownRequest(shutdownRequested);
} catch (error) {
  exitCode = 1;
  console.error(`E2E_RUNTIME_ERROR ${sanitizeError(error)}`);
} finally {
  try {
    await cleanup.dispose();
  } catch (error) {
    exitCode = 1;
    console.error(`E2E_RUNTIME_CLEANUP_ERROR ${sanitizeError(error)}`);
  }
  process.exitCode = exitCode;
}

// Bun keeps a piped stdin handle referenced after pause; all owned resources are
// disposed above, so terminate the dedicated harness process explicitly.
process.exit(exitCode);

function waitForShutdownRequest(shutdownRequested: Promise<void>): Promise<void> {
  return new Promise((resolvePromise) => {
    let resolved = false;
    const parentPid = Number(process.env.E2E_PARENT_PID || "0");
    const parentWatchdog = parentPid > 0 ? setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        finish();
      }
    }, 1_000) : undefined;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (parentWatchdog) clearInterval(parentWatchdog);
      process.removeListener("SIGINT", finish);
      process.removeListener("SIGTERM", finish);
      process.stdin.removeListener("end", finish);
      process.stdin.removeListener("close", finish);
      process.stdin.pause();
      resolvePromise();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
    process.stdin.once("end", finish);
    process.stdin.once("close", finish);
    void shutdownRequested.then(finish);
    process.stdin.resume();
  });
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, (value) => {
      try {
        const url = new URL(value);
        return `${url.protocol}//${url.host}${url.pathname}`;
      } catch {
        return "[invalid-url]";
      }
    })
    .replace(/\b(Bearer|token|password|secret|api[_-]?key)\s*[:=]?\s*[^\s,;]+/gi, "$1 [REDACTED]")
    .slice(0, 4_000);
}
