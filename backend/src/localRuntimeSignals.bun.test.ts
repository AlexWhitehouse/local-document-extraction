import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entrypoint = resolve(import.meta.dir, "server.ts");

for (const watch of [false, true]) {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    test(`${signal} exits the real server${watch ? " in watch mode" : ""} and releases its port`, async () => {
      const stateDirectory = await mkdtemp(join(tmpdir(), "local-runtime-signals-"));
      const child = Bun.spawn([
        process.execPath, "--no-env-file", ...(watch ? ["--watch"] : []), entrypoint,
      ], {
        cwd: stateDirectory,
        env: {
          PATH: process.env.PATH,
          PORT: "0",
          DOCUMENT_EXTRACTION_STATE_DIR: stateDirectory,
          LOCAL_SHUTDOWN_TIMEOUT_MS: "100",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      let output = "";
      let reportReady!: (origin: string) => void;
      const ready = new Promise<string>((resolveReady) => { reportReady = resolveReady; });
      const stdoutDone = (async () => {
        const decoder = new TextDecoder();
        const reader = child.stdout.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            output += decoder.decode(value, { stream: true });
            const match = output.match(/LOCAL_RUNTIME_READY (.+)\n/);
            if (match) reportReady(JSON.parse(match[1]!).origin);
          }
        } finally {
          reader.releaseLock();
        }
      })();
      const stderrDone = new Response(child.stderr).text();

      try {
        const origin = await within(ready, 5_000, "server readiness");
        const response = await fetch(`${origin}/v1/health`);
        expect(response.status).toBe(200);
        await response.text();

        child.kill(signal);
        expect(await within(child.exited, 2_000, `process exit after ${signal}`)).toBe(0);
        // Prove the interrupted application no longer owns the listener.
        const replacement = Bun.serve({
          hostname: "127.0.0.1",
          port: Number(new URL(origin).port),
          fetch: () => new Response("replacement"),
        });
        await replacement.stop(true);
      } finally {
        if (child.exitCode === null) child.kill("SIGKILL");
        await child.exited;
        await Promise.all([stdoutDone, stderrDone]);
        await rm(stateDirectory, { recursive: true, force: true });
      }
    }, 10_000);
  }
}

async function within<T>(promise: Promise<T>, timeoutMs: number, description: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
