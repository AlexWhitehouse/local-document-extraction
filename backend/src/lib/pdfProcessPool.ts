import { fileURLToPath } from "node:url";
import { isJsonObject, isString, parseJson, type JsonObject } from "../../../shared/json";

export type PdfProcessWorker = {
  child: Bun.Subprocess<"pipe", "pipe", "ignore">;
  reader: ReturnType<typeof createPdfFrameReader>;
  idleTimer?: ReturnType<typeof setTimeout>;
};

export type PdfWorkerLimits = {
  /** Operations before a worker retires. */
  documents: number;
  /** Sampled peak RSS that retires a worker after its current operation. */
  recycleRssBytes: number;
  /** Peak RSS that ends a worker during an operation. */
  hardRssBytes: number;
};

/** Workers receive only their own settings, never the API's environment. */
type PdfWorkerEnvironment = {
  GO_PDF_WORKER_DOCUMENTS: string;
  GO_PDF_WORKER_RECYCLE_RSS_MIB: string;
  GO_PDF_WORKER_HARD_RSS_MIB: string;
  PDFIUM_LIBRARY?: string;
};

/** The PDFium worker the Go processor uses; GO_PDF_WORKER_BINARY overrides it for both. */
export function pdfWorkerBinary(): string {
  return process.env.GO_PDF_WORKER_BINARY || fileURLToPath(new URL("../../../backend-go/bin/document-extraction-pdf", import.meta.url));
}

/** The worker exits with this status when it breaches its memory ceiling. */
const MEMORY_CEILING_EXIT = 3;

/** A negative status frame from the worker: 22 is a limit, 24 an invalid selection. */
export class PdfWorkerFailure extends Error {
  constructor(readonly status: number) {
    super(`PDF worker rejected the operation (${status})`);
  }
}

/** Callers admit bounded work before taking a process. Idle processes never keep the API alive. */
export function createPdfProcessPool(idleMs: number, limits: PdfWorkerLimits) {
  const idle: PdfProcessWorker[] = [];
  let spawned = 0;

  const env: PdfWorkerEnvironment = {
    GO_PDF_WORKER_DOCUMENTS: String(limits.documents),
    GO_PDF_WORKER_RECYCLE_RSS_MIB: String(Math.ceil(limits.recycleRssBytes / 2 ** 20)),
    GO_PDF_WORKER_HARD_RSS_MIB: String(Math.ceil(limits.hardRssBytes / 2 ** 20)),
  };

  if (process.env.PDFIUM_LIBRARY) env.PDFIUM_LIBRARY = process.env.PDFIUM_LIBRARY;

  const stop = async (worker: PdfProcessWorker) => {
    clearTimeout(worker.idleTimer);
    worker.child.kill("SIGKILL");
    await worker.child.exited;
    await worker.reader.close();
  };

  return {
    snapshot: () => ({ idle: idle.length, spawned }),
    stop,
    async take(): Promise<PdfProcessWorker> {
      for (;;) {
        const worker = idle.pop();

        if (!worker) break;
        clearTimeout(worker.idleTimer);

        if (worker.child.exitCode !== null) {
          await stop(worker);
          continue;
        }

        worker.child.ref();

        return worker;
      }

      const child = Bun.spawn([pdfWorkerBinary(), "serve"], { stdin: "pipe", stdout: "pipe", stderr: "ignore", env });

      spawned++;

      return { child, reader: createPdfFrameReader(child.stdout) };
    },
    put(worker: PdfProcessWorker) {
      worker.child.unref();
      idle.push(worker);
      worker.idleTimer = setTimeout(() => {
        const index = idle.indexOf(worker);

        if (index < 0) return;
        idle.splice(index, 1);
        void stop(worker);
      }, idleMs);
      worker.idleTimer.unref();
    },
    async close() {
      await Promise.all(idle.splice(0).map(stop));
    },
  };
}

/**
 * One request: a metadata frame, then the source as inline bytes or, with an
 * empty frame, as a private path. Artifacts follow until a zero frame and its
 * retirement flag. Throws PdfWorkerFailure for a status frame, or for a memory
 * ceiling breach as status 22; other protocol failures are plain errors.
 */
export async function exchangePdfWorker(
  worker: PdfProcessWorker,
  request: JsonObject,
  source: Uint8Array | string,
  bounds: { maxArtifacts: number; artifactBytes: number; totalBytes: number },
): Promise<{ artifacts: Uint8Array[]; reusable: boolean }> {
  const metadata = new TextEncoder().encode(JSON.stringify(isString(source) ? { ...request, source_path: source } : request));
  const header = new Uint8Array(4);
  const view = new DataView(header.buffer);
  const { child, reader } = worker;

  view.setUint32(0, metadata.byteLength);
  child.stdin.write(header);
  child.stdin.write(metadata);
  view.setUint32(0, isString(source) ? 0 : source.byteLength);
  child.stdin.write(header);

  if (!isString(source)) child.stdin.write(source);
  await child.stdin.flush();
  const artifacts: Uint8Array[] = [];
  let size = 0;

  const read = async (length: number) => {
    const bytes = await reader.read(length);

    if (bytes) return bytes;

    if ((await child.exited) === MEMORY_CEILING_EXIT) throw new PdfWorkerFailure(22);
    throw new Error("PDF worker ended unexpectedly");
  };

  for (;;) {
    const length = new DataView((await read(4)).buffer).getInt32(0);

    // Renderer phase metrics are diagnostics for the Go processor.
    if (length === -30) {
      const metricsLength = new DataView((await read(4)).buffer).getUint32(0);

      if (metricsLength > 4096 || !isJsonObject(parseJson(new TextDecoder().decode(await read(metricsLength)))))
        throw new Error("Invalid PDF worker metrics");
      continue;
    }

    if (length < 0) throw new PdfWorkerFailure(-length);

    if (length === 0) {
      const retire = await read(1);

      if (retire[0]! > 1) throw new Error("Invalid PDF worker retirement flag");

      return { artifacts, reusable: retire[0] === 0 };
    }

    size += length;

    if (length > bounds.artifactBytes || size > bounds.totalBytes || artifacts.length >= bounds.maxArtifacts)
      throw new PdfWorkerFailure(22);
    artifacts.push(await read(length));
  }
}

/** Exact framing across arbitrary pipe chunk boundaries, with no accumulating input history. */
export function createPdfFrameReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let pending: Uint8Array = new Uint8Array(0);

  return {
    async read(length: number): Promise<Uint8Array<ArrayBuffer> | null> {
      const output = new Uint8Array(length);
      let offset = 0;

      while (offset < length) {
        if (!pending.byteLength) {
          const next = await reader.read();

          if (next.done) {
            if (!offset) return null;
            throw new Error("Incomplete PDF frame");
          }

          pending = next.value;
        }

        const count = Math.min(pending.byteLength, length - offset);
        output.set(pending.subarray(0, count), offset);
        pending = pending.subarray(count);
        offset += count;
      }

      if (!pending.byteLength) pending = new Uint8Array(0);

      return output;
    },
    async close() {
      pending = new Uint8Array(0);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    },
  };
}
