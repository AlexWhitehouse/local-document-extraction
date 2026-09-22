import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { sanitizeConsoleText } from "./browserEvidence";

const expectedBunVersion: string = JSON.parse(
  readFileSync(resolve("package.json"), "utf8"),
).packageManager.replace(/^bun@/, "");

type ReadyPayload = {
  bunVersion: string;
  controlOrigin: string;
  origin: string;
  stateDirectory: string;
};

export async function startRuntimeHarness({ timeoutMs = 20_000, requireEmailVerification }: { timeoutMs?: number; requireEmailVerification?: boolean } = {}) {
  const rootDirectory = resolve(process.cwd());
  const child = spawn(process.env.E2E_BUN_EXECUTABLE || "bun", [
    "e2e/support/runtimeHarness.ts",
  ], {
    cwd: rootDirectory,
    env: { ...process.env, AUTH_REQUIRE_EMAIL_VERIFICATION: requireEmailVerification === undefined ? "" : String(requireEmailVerification), E2E_PARENT_PID: String(process.pid) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdout = "";
  let stderr = "";
  let pendingLine = "";
  let resolveReady!: (payload: ReadyPayload) => void;
  let rejectReady!: (error: Error) => void;
  let readySettled = false;
  const ready = new Promise<ReadyPayload>((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise) => {
    child.once("exit", (code, signal) => {
      resolvePromise({ code, signal });
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error(`harness exited before readiness (code=${code}, signal=${signal || "none"})`));
      }
    });
  });
  child.once("error", (error) => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
  });
  child.stdout.on("data", (chunk: string) => {
    stdout = boundedTail(stdout + chunk);
    pendingLine += chunk;
    const lines = pendingLine.split(/\r?\n/);
    pendingLine = lines.pop() || "";
    for (const line of lines) {
      const prefix = "E2E_RUNTIME_READY ";
      if (!line.startsWith(prefix) || readySettled) continue;
      try {
        const payload = validateReadyPayload(JSON.parse(line.slice(prefix.length)));
        readySettled = true;
        resolveReady(payload);
      } catch (error) {
        readySettled = true;
        rejectReady(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr = boundedTail(stderr + chunk);
  });

  const timer = setTimeout(() => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(new Error("harness did not report readiness before the deadline"));
    }
  }, timeoutMs);

  let payload: ReadyPayload;
  try {
    payload = await ready;
  } catch (error) {
    await terminateChild(child, exited);
    throw new Error([
      `Browser runtime harness startup failed: ${errorMessage(error)}`,
      `stdout:\n${sanitizeProcessOutput(stdout)}`,
      `stderr:\n${sanitizeProcessOutput(stderr)}`,
    ].join("\n"), { cause: error });
  } finally {
    clearTimeout(timer);
  }

  let stopPromise: Promise<void> | undefined;
  return {
    bunVersion: payload.bunVersion,
    origin: payload.origin,
    gatewayOrigin: payload.controlOrigin,
    stateDirectory: payload.stateDirectory,
    waitForVerificationMail: (email: string) => waitForVerificationMail({
      email,
      origin: payload.origin,
      stateDirectory: payload.stateDirectory,
    }),
    waitForPasswordResetMail: (email: string) => waitForPasswordResetMail({
      email,
      origin: payload.origin,
      stateDirectory: payload.stateDirectory,
    }),
    stop(): Promise<void> {
      stopPromise ??= stopHarness(child, exited, payload.controlOrigin, () => ({ stderr, stdout }));
      return stopPromise;
    },
  };
}

async function waitForVerificationMail({
  email,
  origin,
  stateDirectory,
}: {
  email: string;
  origin: string;
  stateDirectory: string;
}): Promise<{ actionUrl: string }> {
  return waitForTransactionalMail({
    email,
    expectedPath: "/api/auth/verify-email",
    origin,
    stateDirectory,
    type: "account_email_verification",
  });
}

async function waitForPasswordResetMail({
  email,
  origin,
  stateDirectory,
}: {
  email: string;
  origin: string;
  stateDirectory: string;
}): Promise<{ actionUrl: string }> {
  return waitForTransactionalMail({
    email,
    expectedPath: "/api/auth/reset-password/",
    pathMatch: "prefix",
    origin,
    stateDirectory,
    type: "account_password_reset",
  });
}

async function waitForTransactionalMail({
  email,
  expectedPath,
  origin,
  pathMatch = "exact",
  stateDirectory,
  type,
}: {
  email: string;
  expectedPath: string;
  origin: string;
  stateDirectory: string;
  type: "account_email_verification" | "account_password_reset";
  pathMatch?: "exact" | "prefix";
}): Promise<{ actionUrl: string }> {
  const mailDirectory = join(stateDirectory, "mail");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const fileNames = await readdir(mailDirectory).catch(() => []);
    for (const fileName of fileNames.filter((value) => value.endsWith(".jsonl")).sort()) {
      const content = await readFile(join(mailDirectory, fileName), "utf8");
      for (const line of content.trim().split("\n").filter(Boolean)) {
        const record = JSON.parse(line) as {
          action_url?: unknown;
          to?: unknown;
          type?: unknown;
        };
        if (record.type !== type || record.to !== email) continue;
        const actionUrl = new URL(String(record.action_url || ""));
        const pathMatches = pathMatch === "prefix"
          ? actionUrl.pathname.startsWith(expectedPath)
          : actionUrl.pathname === expectedPath;
        if (actionUrl.origin !== origin || !pathMatches) {
          throw new Error(`Local ${type} mail contained an unexpected action origin or path`);
        }
        return { actionUrl: actionUrl.toString() };
      }
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for isolated ${type} mail`);
}

function validateReadyPayload(input: unknown): ReadyPayload {
  if (!input || typeof input !== "object") throw new Error("ready payload must be an object");
  const candidate = input as Partial<ReadyPayload>;
  const origin = new URL(String(candidate.origin || ""));
  const controlOrigin = new URL(String(candidate.controlOrigin || ""));
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port) {
    throw new Error("ready origin must be an explicit loopback HTTP listener");
  }
  if (controlOrigin.protocol !== "http:" || controlOrigin.hostname !== "127.0.0.1" || !controlOrigin.port) {
    throw new Error("ready control origin must be an explicit loopback HTTP listener");
  }
  if (candidate.bunVersion !== expectedBunVersion) {
    throw new Error(`browser harness requires Bun ${expectedBunVersion}, received ${String(candidate.bunVersion || "unknown")}`);
  }
  if (typeof candidate.stateDirectory !== "string" || !candidate.stateDirectory) {
    throw new Error("ready payload did not include an isolated state directory");
  }
  return {
    bunVersion: expectedBunVersion,
    controlOrigin: controlOrigin.origin,
    origin: origin.origin,
    stateDirectory: candidate.stateDirectory,
  };
}

async function stopHarness(
  child: ChildProcessWithoutNullStreams,
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
  controlOrigin: string,
  output: () => { stderr: string; stdout: string },
): Promise<void> {
  if (!child.killed && child.exitCode === null) {
    await fetch(`${controlOrigin}/__e2e/shutdown`, { method: "POST" }).catch(() => {
      child.kill("SIGTERM");
    });
  }
  const result = await Promise.race([
    exited,
    delay(10_000).then(() => null),
  ]);
  if (!result) {
    child.kill("SIGKILL");
    await exited;
    const captured = output();
    throw new Error([
      "Browser runtime harness did not stop within 10 seconds and was killed",
      `stdout:\n${sanitizeProcessOutput(captured.stdout)}`,
      `stderr:\n${sanitizeProcessOutput(captured.stderr)}`,
    ].join("\n"));
  }
  if (result.code !== 0) {
    const captured = output();
    throw new Error([
      `Browser runtime harness exited with code ${result.code} (signal=${result.signal || "none"})`,
      `stdout:\n${sanitizeProcessOutput(captured.stdout)}`,
      `stderr:\n${sanitizeProcessOutput(captured.stderr)}`,
    ].join("\n"));
  }
}

async function terminateChild(
  child: ChildProcessWithoutNullStreams,
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await exited;
}

function sanitizeProcessOutput(input: string): string {
  return sanitizeConsoleText(input || "<empty>");
}

function boundedTail(input: string): string {
  return input.length > 40_000 ? input.slice(-40_000) : input;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
