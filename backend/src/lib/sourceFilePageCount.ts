import { fileURLToPath } from "node:url";
import { PDF_INSPECTION_LIMITS as limits, type PdfInspectionResult } from "./pdfInspectionLimits";

export class InvalidPdfSourceFileError extends Error {
  code = "invalid_pdf_source_file" as const;

  constructor() {
    super("PDF Source file could not be read");
  }
}

export class PdfSourceFileLimitError extends Error {
  code = "pdf_source_file_limit_exceeded" as const;
  constructor() { super("PDF Source file exceeds safe processing limits"); }
}

export class PdfSourceFileCapacityError extends Error {
  code = "pdf_validation_capacity_unavailable" as const;
  constructor() { super("PDF validation capacity is temporarily full"); }
}

/** One process per input prevents PDF intern pools accumulating in the API. */
export function createPdfSourceFilePageCounter({
  maxConcurrent = limits.concurrent,
  maxQueued = limits.queued,
  timeoutMs = limits.wallTimeMs,
  queueTimeoutMs = limits.wallTimeMs,
}: { maxConcurrent?: number; maxQueued?: number; timeoutMs?: number; queueTimeoutMs?: number } = {}) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || !Number.isSafeInteger(maxQueued) || maxQueued < 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(queueTimeoutMs) || queueTimeoutMs < 1) throw new Error("Invalid PDF inspection capacity");
  let active = 0;
  let reservedBytes = 0;
  const waiting: Array<() => void> = [];
  const acquire = async (bytes: number, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (reservedBytes + bytes > limits.reservedSourceBytes || (active >= maxConcurrent && waiting.length >= maxQueued)) throw new PdfSourceFileCapacityError();
    reservedBytes += bytes;
    if (active < maxConcurrent) { active++; return; }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      const ready = () => { cleanup(); resolve(); };
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
  };
  return {
    snapshot: () => ({ active, queued: waiting.length, reservedBytes }),
    async count(sourceBytes: ArrayBuffer | Uint8Array, signal?: AbortSignal): Promise<number> {
      signal?.throwIfAborted();
      if (sourceBytes.byteLength > limits.sourceBytes) throw new PdfSourceFileLimitError();
      const sourceSize = sourceBytes.byteLength;
      await acquire(sourceSize, signal);
      try {
        signal?.throwIfAborted();
        const source = sourceBytes instanceof Uint8Array ? sourceBytes : new Uint8Array(sourceBytes);
        const child = Bun.spawn([process.execPath, "--no-env-file", "--smol", fileURLToPath(new URL("./pdfInspectionProcess.ts", import.meta.url))], {
          stdin: source, stdout: "pipe", stderr: "ignore",
          // No installation credentials or user shell environment in the parser.
          env: {},
        });
        let timedOut = false;
        const terminate = () => { child.kill("SIGKILL"); };
        const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
        signal?.addEventListener("abort", terminate, { once: true });
        try {
          if (signal?.aborted) terminate();
          const reader = child.stdout.getReader();
          let output = "";
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              if (output.length + chunk.value.byteLength > 256) { terminate(); throw new InvalidPdfSourceFileError(); }
              output += new TextDecoder().decode(chunk.value);
            }
          } finally { reader.releaseLock(); }
          const exitCode = await child.exited;
          if (signal?.aborted) throw new DOMException("PDF inspection cancelled", "AbortError");
          if (timedOut) throw new PdfSourceFileLimitError();
          if (exitCode !== 0) throw new InvalidPdfSourceFileError();
          let result: PdfInspectionResult;
          try { result = JSON.parse(output); } catch { throw new InvalidPdfSourceFileError(); }
          if (!result || typeof result !== "object") throw new InvalidPdfSourceFileError();
          if ("error" in result) {
            if (result.error === "limit") throw new PdfSourceFileLimitError();
            if (result.error === "configuration") console.error("PDF inspection adapter requires the qualified pdf-lib 1.17.1 implementation.");
            throw new InvalidPdfSourceFileError();
          }
          if (!Number.isSafeInteger(result.pages) || result.pages < 1 || result.pages > limits.pages) throw new InvalidPdfSourceFileError();
          return result.pages;
        } catch (error) {
          if (signal?.aborted) throw new DOMException("PDF inspection cancelled", "AbortError");
          if (timedOut) throw new PdfSourceFileLimitError();
          if (error instanceof InvalidPdfSourceFileError || error instanceof PdfSourceFileLimitError) throw error;
          throw new InvalidPdfSourceFileError();
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", terminate);
          terminate();
          await child.exited;
        }
      } catch (error) {
        if (signal?.aborted) throw new DOMException("PDF inspection cancelled", "AbortError");
        if (error instanceof InvalidPdfSourceFileError || error instanceof PdfSourceFileLimitError) throw error;
        throw new InvalidPdfSourceFileError();
      } finally { release(sourceSize); }
    },
  };
}

const counter = createPdfSourceFilePageCounter();
export const countPdfSourceFilePages = counter.count;
