type CapturedOutput = {
  stderr: string;
  stdout: string;
};

export type LocalRuntimeSmokeProcess = {
  origin: string;
  output(): CapturedOutput;
  stop(signal?: NodeJS.Signals): Promise<number>;
};

export async function startLocalRuntimeSmokeProcess({
  backendDirectory,
  env,
  timeoutMs = 10_000,
}: {
  backendDirectory: string;
  env: Record<string, string | undefined>;
  timeoutMs?: number;
}): Promise<LocalRuntimeSmokeProcess> {
  const startedAt = performance.now();
  const output: CapturedOutput = { stderr: "", stdout: "" };
  let reportedOrigin: string | null = null;
  let lastHealthResult = "not attempted";
  let resolveOrigin!: (origin: string) => void;
  let rejectOrigin!: (error: Error) => void;
  const originReported = new Promise<string>((resolve, reject) => {
    resolveOrigin = resolve;
    rejectOrigin = reject;
  });
  const child = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: backendDirectory,
    env: {
      ...env,
      PORT: "0",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  let stopped = false;
  const stdoutDone = captureOutput(child.stdout, (text) => {
    output.stdout += text;
  }, (line) => {
    const prefix = "LOCAL_RUNTIME_READY ";
    if (!line.startsWith(prefix) || reportedOrigin) return;
    try {
      const payload = JSON.parse(line.slice(prefix.length)) as { origin?: unknown };
      const origin = new URL(String(payload.origin || ""));
      if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.port === "") {
        throw new Error("ready origin must be an explicit 127.0.0.1 HTTP listener");
      }
      reportedOrigin = origin.origin;
      resolveOrigin(reportedOrigin);
    } catch (error) {
      rejectOrigin(new Error(`Invalid Local Bun Runtime ready event: ${errorMessage(error)}`));
    }
  });
  const stderrDone = captureOutput(child.stderr, (text) => {
    output.stderr += text;
  });
  const stop = async (signal: NodeJS.Signals = "SIGTERM"): Promise<number> => {
    if (!stopped) {
      stopped = true;
      child.kill(signal);
    }
    const exitCode = await child.exited;
    await Promise.all([stdoutDone, stderrDone]);
    return exitCode;
  };

  try {
    const deadline = startedAt + timeoutMs;
    const origin = await Promise.race([
      originReported,
      child.exited.then((exitCode) => {
        throw new Error(`child exited with code ${exitCode} before reporting readiness`);
      }),
      timeoutAt(deadline, "child did not report an origin"),
    ]);

    while (performance.now() < deadline) {
      try {
        const response = await fetch(`${origin}/v1/health`);
        lastHealthResult = `HTTP ${response.status}`;
        if (response.ok) {
          return {
            origin,
            output: () => ({ ...output }),
            stop,
          };
        }
      } catch (error) {
        lastHealthResult = errorMessage(error);
      }
      await Bun.sleep(25);
    }
    throw new Error("health check did not become ready");
  } catch (error) {
    await stop("SIGKILL");
    const elapsedMs = performance.now() - startedAt;
    throw new Error([
      `Local Bun Runtime startup failed: ${errorMessage(error)}`,
      `elapsed_ms=${elapsedMs.toFixed(1)}`,
      `origin=${reportedOrigin || "not reported"}`,
      `last_health=${lastHealthResult}`,
      `stdout:\n${output.stdout || "<empty>"}`,
      `stderr:\n${output.stderr || "<empty>"}`,
    ].join("\n"), { cause: error });
  }
}

async function captureOutput(
  stream: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  onLine: (line: string) => void = () => {},
): Promise<void> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let pendingLine = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      onText(text);
      pendingLine += text;
      const lines = pendingLine.split(/\r?\n/);
      pendingLine = lines.pop() || "";
      for (const line of lines) onLine(line);
    }
    const finalText = decoder.decode();
    if (finalText) {
      onText(finalText);
      pendingLine += finalText;
    }
    if (pendingLine) onLine(pendingLine);
  } finally {
    reader.releaseLock();
  }
}

function timeoutAt(deadline: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), Math.max(0, deadline - performance.now()));
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AsyncCleanupStack {
  readonly #cleanups: Array<() => void | Promise<void>> = [];
  #disposed = false;

  defer(cleanup: () => void | Promise<void>): void {
    if (this.#disposed) throw new Error("Cleanup stack is already disposed");
    this.#cleanups.push(cleanup);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const failures: unknown[] = [];
    for (const cleanup of this.#cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) {
      throw new AggregateError(failures, "Smoke harness cleanup failed");
    }
  }
}
