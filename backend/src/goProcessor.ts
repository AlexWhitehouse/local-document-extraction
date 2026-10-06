import { cpus, totalmem } from "node:os";
import { Agent, request as httpRequest } from "node:http";
import { hasFilesystemErrorCode } from "./localStatePaths";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, mkdtemp, rm, readdir, statfs } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isJsonObject, parseJson, type JsonValue } from "../../shared/json";
import { RetryableError } from "./consumer/modelGateway";
import { HttpError } from "./lib/http";
import { createGoProcessingSession, type GoProcessingContext, type GoProcessingOptions } from "./goProcessingSession";

export const defaultGoProcessorBinary = fileURLToPath(new URL("../../backend-go/bin/document-extraction", import.meta.url));

/** A private authenticated callback listener keeps product stores owned by Bun.
 * No callback route is exposed by the public application server.
 */
export async function startGoProcessor(binary: string, options: GoProcessingOptions) {
  if (!(await Bun.file(binary).exists())) throw new Error(`Go processor missing at ${binary}. Run bun run build before starting the application.`);

  const token = randomBytes(32).toString("hex");
  const runConnections = new Agent({ keepAlive: true, maxFreeSockets: 24 });
  const sessions = new Map<string, ReturnType<typeof createGoProcessingSession>>();

  const bridge = Bun.serve({
    hostname: "127.0.0.1", port: 0, idleTimeout: 0, maxRequestBodySize: 34 * 1024 * 1024,
    fetch: async (request) => {
      const supplied = Buffer.from(request.headers.get("authorization") ?? "");
      const expected = Buffer.from(`Bearer ${token}`);

      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return new Response(null, { status: 401 });
      const [, id, ...parts] = new URL(request.url).pathname.split("/");
      const session = sessions.get(id ?? "");

      if (!session || request.method !== "POST") return new Response(null, { status: 404 });

      try {
        const body: JsonValue = parseJson(await request.text());
        const result = await session(parts.join("/"), body);

        return Response.json(result);
      } catch (error) {
        return Response.json({
          message: error instanceof HttpError || error instanceof RetryableError ? error.message : "Document processing operation failed",
          retryable: error instanceof RetryableError,
          code: error instanceof HttpError ? error.code : undefined,
          retry_after_ms: error instanceof RetryableError ? error.retryAfterMs ?? 0 : 0,
          status: error instanceof RetryableError ? error.status ?? 0 : 0,
        }, { status: 409 });
      }
    },
  });

  const filesystem = await statfs(options.stateDirectory);
  const artifactMiB = Math.max(96, Math.min(4096, Math.floor(filesystem.bavail * filesystem.bsize / (4 * 1024 * 1024))));

  const temporaryRoot = join(options.stateDirectory, "temporary", "submissions");
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });

  const launch = async () => {
    const cacheDirectory = await mkdtemp(join(temporaryRoot, `go-processing-${process.pid}-pages-`));


    const child = Bun.spawn([binary], {
      env: {
        ...process.env,
        GO_PROCESSOR_TOKEN: token,
        GO_PROCESSOR_PAGE_CACHE: cacheDirectory,
        GO_PROCESSOR_BUN: process.execPath,
        GO_PROCESSOR_PDF_SCRIPT: fileURLToPath(new URL("./lib/pdfPageOperationProcess.ts", import.meta.url)),
        GO_RESPONSE_BUFFER_MIB: process.env.GO_RESPONSE_BUFFER_MIB ?? String(Math.max(64, Math.min(512, Math.floor(totalmem() / (16 * 1024 * 1024))))),
        GO_PREPARED_ARTIFACT_MIB: process.env.GO_PREPARED_ARTIFACT_MIB ?? String(artifactMiB),
        GO_PDF_WORKERS: process.env.GO_PDF_WORKERS ?? String(Math.max(1, Math.min(cpus().length, Math.floor(totalmem() / (4 * 384 * 1024 * 1024))))),
        GO_MODEL_CONCURRENCY: process.env.GO_MODEL_CONCURRENCY ?? process.env.EXTRACTION_MAX_CONCURRENCY ?? "96",
      },
      stdin: "pipe", stdout: "pipe", stderr: "inherit",
    });

    let origin = "";
    const reader = child.stdout.getReader();
    const timer = setTimeout(() => child.kill(), 20_000);

    try {
      let output = "";

      while (!origin) {
        const { done, value } = await reader.read();

        if (done) throw new Error("Go processor exited before readiness");
        output += new TextDecoder().decode(value);
        const address = output.match(/^GO_PROCESSOR_READY (127\.0\.0\.1:\d+)$/m)?.[1];

        if (address) origin = `http://${address}`;

        if (output.length > 4096) throw new Error("Invalid Go processor readiness output");
      }
    } catch (error) {
      child.kill();
      await child.exited;
      await rm(cacheDirectory, { recursive: true, force: true });
      throw error;
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }

    return { child, origin, cacheDirectory };
  };

  let current: Awaited<ReturnType<typeof launch>>;

  try { current = await launch(); } catch (error) { await bridge.stop(true); throw error; }

  let restart: Promise<Awaited<ReturnType<typeof launch>>> | null = null;
  let closed = false;

  const processForRun = async () => {
    if (closed) throw new Error("Go processor is closed");

    if (current.child.exitCode !== null || current.child.signalCode !== null) {
      restart ??= (async () => {
        const previous = current;
        await rm(previous.cacheDirectory, { recursive: true, force: true });
        const replacement = await launch();
        current = replacement;

        return replacement;
      })().finally(() => { restart = null; });
      await restart;
    }

    return current;
  };

  for (const entry of await readdir(temporaryRoot, { withFileTypes: true })) {
    const owner = entry.name.match(/^go-processing-(\d+)-/);

    if (!entry.isDirectory() || !owner) continue;

    try { process.kill(Number(owner[1]), 0); }
    catch (error) {
      if (hasFilesystemErrorCode(error, "ESRCH")) await rm(join(temporaryRoot, entry.name), { recursive: true, force: true });
    }
  }


  return {
    run: async (context: GoProcessingContext) => {
      const service = await processForRun();
      const { origin } = service;
      const id = randomBytes(24).toString("hex");
      const directory = await mkdtemp(join(temporaryRoot, `go-processing-${process.pid}-`));
      sessions.set(id, createGoProcessingSession(context, options, directory));

      try {
        // Long-lived control requests must not consume Bun fetch's shared 256-request
        // allowance. Model traffic is separately bounded by the Go transport.
        await new Promise<void>((resolve, reject) => {
          const request = httpRequest(`${origin}/run`, {
            agent: runConnections,
            method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            signal: context.signal,
          }, (response) => {
            response.on("error", reject);
            response.on("end", () => {
              if (response.statusCode === 200) resolve();
              else reject(new Error("Go processor interrupted; durable recovery will resume unfinished work"));
            });
            response.resume();
          });

          request.on("error", reject);
          request.end(JSON.stringify({ bridge: `http://127.0.0.1:${bridge.port}/${id}`, token, workspace: context.job.workspace_id, directory }));
        });
      } catch (error) {
        // Socket failure can precede Bun's child-exit notification. Observe that
        // notification before the queue can immediately attempt durable recovery.
        if (!context.signal.aborted) await Promise.race([service.child.exited, Bun.sleep(50)]);
        throw error;
      } finally {
        sessions.delete(id);
        await rm(directory, { recursive: true, force: true });
      }
    },
    diagnostics: async () => {
      const { origin } = await processForRun();
      const response = await fetch(`${origin}/health`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2_000) });
      const body = parseJson(await response.text());

      return isJsonObject(body) ? body : {};
    },
    close: async () => {
      closed = true;

      if (restart) current = await restart;
      const { child } = current;
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);

      try { await child.exited; } finally { runConnections.destroy(); clearTimeout(timeout); await bridge.stop(true); await rm(current.cacheDirectory, { recursive: true, force: true }); }
    },
  };
}
