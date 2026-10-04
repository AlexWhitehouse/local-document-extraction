import { isBoolean, isNumber, isJsonObject, parseJson } from "../../../shared/json";
import { createPdfProcessPool, type PdfProcessWorker } from "./pdfProcessPool";
import { PDF_INSPECTION_LIMITS as limits } from "./pdfInspectionLimits";

export class InvalidPdfSourceFileError extends Error {
  code = "invalid_pdf_source_file" as const;
  constructor() {
    super("PDF Source file could not be read");
  }
}

export class PdfSourceFileLimitError extends Error {
  code = "pdf_source_file_limit_exceeded" as const;
  constructor() {
    super("PDF Source file exceeds safe processing limits");
  }
}

export class PdfSourceFileCapacityError extends Error {
  code = "pdf_validation_capacity_unavailable" as const;
  constructor() {
    super("PDF validation capacity is temporarily full");
  }
}

/** Recycled subprocesses keep PDF intern pools bounded and outside the API. */
export function createPdfSourceFilePageCounter({
  maxConcurrent = limits.concurrent,
  maxQueued = limits.queued,
  timeoutMs = limits.wallTimeMs,
  queueTimeoutMs = limits.wallTimeMs,
}: { maxConcurrent?: number; maxQueued?: number; timeoutMs?: number; queueTimeoutMs?: number } = {}) {
  if (
    !Number.isSafeInteger(maxConcurrent) ||
    maxConcurrent < 1 ||
    !Number.isSafeInteger(maxQueued) ||
    maxQueued < 0 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(queueTimeoutMs) ||
    queueTimeoutMs < 1
  )
    throw new Error("Invalid PDF inspection capacity");
  const pool = createPdfProcessPool(new URL("./pdfInspectionProcess.ts", import.meta.url), limits.workerIdleMs);
  let accepting = true;
  const closeWaiters: Array<() => void> = [];
  let active = 0;
  let reservedBytes = 0;
  const waiting: Array<() => void> = [];

  const acquire = async (bytes: number, signal?: AbortSignal) => {
    signal?.throwIfAborted();

    if (!accepting) throw new PdfSourceFileCapacityError();

    if (reservedBytes + bytes > limits.reservedSourceBytes || (active >= maxConcurrent && waiting.length >= maxQueued))
      throw new PdfSourceFileCapacityError();
    reservedBytes += bytes;

    if (active < maxConcurrent) {
      active++;

      return;
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };

      const ready = () => {
        cleanup();
        resolve();
      };

      const rejectWaiting = (error: Error) => {
        const index = waiting.indexOf(ready);

        if (index < 0) return;
        waiting.splice(index, 1);
        reservedBytes -= bytes;
        cleanup();
        reject(error);
      };

      const abort = () => rejectWaiting(new DOMException("PDF inspection cancelled", "AbortError"));
      const timer = setTimeout(() => rejectWaiting(new PdfSourceFileCapacityError()), queueTimeoutMs);
      waiting.push(ready);
      signal?.addEventListener("abort", abort, { once: true });
    });
  };

  const release = (bytes: number) => {
    reservedBytes -= bytes;
    const next = waiting.shift();

    if (next) next();
    else active--;

    if (!active) for (const resolve of closeWaiters.splice(0)) resolve();
  };

  return {
    snapshot: () => ({ active, queued: waiting.length, reservedBytes }),
    diagnostics: () => ({ active, queued: waiting.length, reservedBytes, ...pool.snapshot() }),
    close: async () => {
      accepting = false;
      await pool.close();

      if (active) await new Promise<void>((resolve) => closeWaiters.push(resolve));
    },
    async count(sourceBytes: ArrayBuffer | Uint8Array, signal?: AbortSignal): Promise<number> {
      signal?.throwIfAborted();

      if (sourceBytes.byteLength > limits.sourceBytes) throw new PdfSourceFileLimitError();
      const sourceSize = sourceBytes.byteLength;
      await acquire(sourceSize, signal);
      let worker: PdfProcessWorker | undefined;
      let reusable = false;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const terminate = () => {
        worker?.child.kill("SIGKILL");
      };

      try {
        signal?.throwIfAborted();
        worker = await pool.take();
        timer = setTimeout(() => {
          timedOut = true;
          terminate();
        }, timeoutMs);
        signal?.addEventListener("abort", terminate, { once: true });
        signal?.throwIfAborted();
        const header = new Uint8Array(4);
        new DataView(header.buffer).setUint32(0, sourceSize);
        worker.child.stdin.write(header);
        worker.child.stdin.write(sourceBytes);
        await worker.child.stdin.flush();
        const responseHeader = await worker.reader.read(4);

        if (!responseHeader) throw new InvalidPdfSourceFileError();
        const responseSize = new DataView(responseHeader.buffer).getUint32(0);

        if (!responseSize || responseSize > 256) throw new InvalidPdfSourceFileError();
        const response = await worker.reader.read(responseSize);

        if (!response) throw new InvalidPdfSourceFileError();

        if (timedOut) throw new PdfSourceFileLimitError();
        const output = new TextDecoder().decode(response);
        signal?.throwIfAborted();
        const result = parseJson(output);

        if (!isJsonObject(result) || !isBoolean(result.retire)) throw new InvalidPdfSourceFileError();

        if ("error" in result) {
          if (result.error === "limit") throw new PdfSourceFileLimitError();

          if (result.error === "configuration")
            console.error("PDF inspection adapter requires the qualified pdf-lib 1.17.1 implementation.");
          throw new InvalidPdfSourceFileError();
        }

        if (
          !isNumber(result.pages) ||
          !Number.isSafeInteger(result.pages) ||
          result.pages < 1 ||
          result.pages > limits.pages
        )
          throw new InvalidPdfSourceFileError();
        reusable = !result.retire;

        return result.pages;
      } catch (error) {
        if (signal?.aborted) throw new DOMException("PDF inspection cancelled", "AbortError");

        if (timedOut) throw new PdfSourceFileLimitError();

        if (error instanceof InvalidPdfSourceFileError || error instanceof PdfSourceFileLimitError) throw error;
        throw new InvalidPdfSourceFileError();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", terminate);

        if (worker) {
          if (reusable && accepting && !signal?.aborted) pool.put(worker);
          else await pool.stop(worker);
        }

        release(sourceSize);
      }
    },
  };
}

const pdfSourceFilePageCounter = createPdfSourceFilePageCounter();

export const countPdfSourceFilePages = pdfSourceFilePageCounter.count;

export const getPdfInspectionSnapshot = pdfSourceFilePageCounter.diagnostics;

export const closePdfInspection = pdfSourceFilePageCounter.close;
