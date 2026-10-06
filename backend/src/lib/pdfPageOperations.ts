import { isNumber, isJsonArray, isString, parseJson, type JsonValue } from "../../../shared/json";
import { createPdfProcessPool, exchangePdfWorker, PdfWorkerFailure, type PdfProcessWorker } from "./pdfProcessPool";
import { PDF_INSPECTION_LIMITS } from "./pdfInspectionLimits";
import { InvalidPdfSourceFileError, PdfSourceFileCapacityError, PdfSourceFileLimitError } from "./sourceFilePageCount";

export const PDF_PAGE_OPERATION_LIMITS = Object.freeze({
  sourceBytes: PDF_INSPECTION_LIMITS.sourceBytes,
  artifactBytes: 32 * 1024 * 1024,
  totalArtifactBytes: 64 * 1024 * 1024,
  previewBytes: 16 * 1024 * 1024,
  groups: 100,
  pages: PDF_INSPECTION_LIMITS.pages,
  wallTimeMs: 20_000,
  // Rendering a whole Document for a model call can take far longer than one page.
  renderWallTimeMs: 300_000,
  concurrent: 4,
  queued: 8,
  metadataBytes: 128 * 1024,
  workerDocuments: 128,
  workerRssBytes: 384 * 1024 * 1024,
  workerHardRssBytes: 1024 * 1024 * 1024,
  workerIdleMs: 5_000,
});

export class PdfPageSelectionError extends Error {
  code = "invalid_page_selection" as const;
}

/** Physical page numbers, preserved in original order. Never silently deduplicate. */
export function validatePdfPageSelection(value: JsonValue | undefined, pageCount: number): number[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > PDF_PAGE_OPERATION_LIMITS.pages)
    throw new PdfPageSelectionError("Invalid source page count");

  if (!isJsonArray(value) || !value.length || value.length > pageCount)
    throw new PdfPageSelectionError("Select at least one source page");
  const seen = new Set<number>();

  for (const page of value) {
    if (!isNumber(page) || !Number.isSafeInteger(page) || page < 1 || page > pageCount || seen.has(page))
      throw new PdfPageSelectionError("Page selection must contain unique, in-range physical page numbers");
    seen.add(page);
  }

  return [...seen].sort((a, b) => a - b);
}

/** A private file path is read by the worker directly, without copying bytes through the API. */
type PdfInput = string | Blob | Uint8Array | ArrayBuffer;

export type PdfPageOperation =
  | { operation: "materialize"; groups: number[][] }
  | { operation: "preview"; page: number }
  | { operation: "blank"; pages: number[] }
  | { operation: "render"; compression?: "best" };

/** Bounded, cancellable subprocess queue. Source bytes are read only after admission. */
export function createPdfPageOperations(
  options: { timeoutMs?: number; queueTimeoutMs?: number; maxConcurrent?: number; maxQueued?: number; workerHardRssBytes?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? PDF_PAGE_OPERATION_LIMITS.wallTimeMs;
  const queueTimeoutMs = options.queueTimeoutMs ?? PDF_PAGE_OPERATION_LIMITS.wallTimeMs;

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(queueTimeoutMs) || queueTimeoutMs < 1)
    throw new Error("Invalid PDF operation timeout");
  const maxConcurrent = options.maxConcurrent ?? PDF_PAGE_OPERATION_LIMITS.concurrent;
  const maxQueued = options.maxQueued ?? PDF_PAGE_OPERATION_LIMITS.queued;

  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || !Number.isSafeInteger(maxQueued) || maxQueued < 0)
    throw new Error("Invalid PDF operation capacity");

  const pool = createPdfProcessPool(PDF_PAGE_OPERATION_LIMITS.workerIdleMs, {
    documents: PDF_PAGE_OPERATION_LIMITS.workerDocuments,
    recycleRssBytes: PDF_PAGE_OPERATION_LIMITS.workerRssBytes,
    hardRssBytes: options.workerHardRssBytes ?? PDF_PAGE_OPERATION_LIMITS.workerHardRssBytes,
  });

  let active = 0;
  let accepting = true;
  const closeWaiters: Array<() => void> = [];
  const waiting: Array<() => void> = [];

  const acquire = async (signal?: AbortSignal) => {
    signal?.throwIfAborted();

    if (!accepting) throw new PdfSourceFileCapacityError();

    if (active < maxConcurrent) {
      active++;

      return;
    }

    if (waiting.length >= maxQueued) throw new PdfSourceFileCapacityError();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };

      const ready = () => {
        cleanup();
        resolve();
      };

      const fail = (error: Error) => {
        const index = waiting.indexOf(ready);

        if (index < 0) return;
        waiting.splice(index, 1);
        cleanup();
        reject(error);
      };

      const abort = () => fail(new DOMException("PDF operation cancelled", "AbortError"));
      const timer = setTimeout(() => fail(new PdfSourceFileCapacityError()), queueTimeoutMs);
      waiting.push(ready);
      signal?.addEventListener("abort", abort, { once: true });
    });
  };

  const release = () => {
    const next = waiting.shift();

    if (next) next();
    else active--;

    if (!active) for (const resolve of closeWaiters.splice(0)) resolve();
  };

  const run = async (source: PdfInput, operation: PdfPageOperation, signal?: AbortSignal): Promise<Uint8Array[]> => {
    const sourceSize = isString(source) ? Bun.file(source).size : source instanceof Blob ? source.size : source.byteLength;
    signal?.throwIfAborted();

    if (!sourceSize || sourceSize > PDF_PAGE_OPERATION_LIMITS.sourceBytes) throw new PdfSourceFileLimitError();

    if (operation.operation === "materialize") {
      if (!operation.groups.length || operation.groups.length > PDF_PAGE_OPERATION_LIMITS.groups)
        throw new PdfSourceFileLimitError();
      const seen = new Set<number>();
      operation = {
        operation: "materialize",
        groups: operation.groups.map((group) => {
          const pages = validatePdfPageSelection(group, PDF_PAGE_OPERATION_LIMITS.pages);

          for (const page of pages) {
            if (seen.has(page)) throw new PdfPageSelectionError("Page groups must not overlap");
            seen.add(page);
          }

          return pages;
        }),
      };
    } else if (operation.operation === "blank") {
      operation = {
        operation: "blank",
        pages: validatePdfPageSelection(operation.pages, PDF_PAGE_OPERATION_LIMITS.pages),
      };
    } else if (
      operation.operation === "preview" &&
      (!Number.isSafeInteger(operation.page) || operation.page < 1 || operation.page > PDF_PAGE_OPERATION_LIMITS.pages)
    )
      throw new PdfPageSelectionError("Invalid preview page");

    if (new TextEncoder().encode(JSON.stringify(operation)).byteLength > PDF_PAGE_OPERATION_LIMITS.metadataBytes)
      throw new PdfSourceFileLimitError();
    await acquire(signal);
    let worker: PdfProcessWorker | undefined;
    let reusable = false;

    try {
      signal?.throwIfAborted();

      const bytes =
        isString(source)
          ? source
          : source instanceof Blob
            ? new Uint8Array(await source.arrayBuffer())
            : source instanceof Uint8Array
              ? source
              : new Uint8Array(source);

      signal?.throwIfAborted();
      worker = await pool.take();
      const child = worker.child;
      let timedOut = false;
      const terminate = () => child.kill("SIGKILL");

      const timer = setTimeout(
        () => {
          timedOut = true;
          terminate();
        },
        operation.operation === "render" ? Math.max(timeoutMs, PDF_PAGE_OPERATION_LIMITS.renderWallTimeMs) : timeoutMs,
      );

      signal?.addEventListener("abort", terminate, { once: true });

      try {
        if (signal?.aborted) terminate();

        const bounds =
          operation.operation === "materialize"
            ? { maxArtifacts: operation.groups.length, totalBytes: PDF_PAGE_OPERATION_LIMITS.totalArtifactBytes }
            : operation.operation === "render"
              ? { maxArtifacts: PDF_PAGE_OPERATION_LIMITS.pages, totalBytes: PDF_PAGE_OPERATION_LIMITS.totalArtifactBytes }
              : operation.operation === "blank"
                ? { maxArtifacts: 1, totalBytes: 256 * 1024 }
                : { maxArtifacts: 1, totalBytes: PDF_PAGE_OPERATION_LIMITS.previewBytes };

        const result = await exchangePdfWorker(worker, operation, bytes, { ...bounds, artifactBytes: PDF_PAGE_OPERATION_LIMITS.artifactBytes });

        if (operation.operation !== "render" && result.artifacts.length !== bounds.maxArtifacts) throw new InvalidPdfSourceFileError();
        signal?.throwIfAborted();

        if (timedOut) throw new PdfSourceFileLimitError();
        reusable = result.reusable;

        return result.artifacts;
      } catch (error) {
        if (signal?.aborted) throw new DOMException("PDF operation cancelled", "AbortError");

        if (timedOut) throw new PdfSourceFileLimitError();

        if (error instanceof PdfWorkerFailure && error.status === 22) throw new PdfSourceFileLimitError();

        if (error instanceof PdfWorkerFailure && error.status === 24)
          throw new PdfPageSelectionError("Page selection must contain unique, in-range physical page numbers");

        if (error instanceof PdfSourceFileLimitError || error instanceof PdfPageSelectionError) throw error;
        throw new InvalidPdfSourceFileError();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", terminate);
      }
    } finally {
      if (worker) {
        if (reusable && accepting && !signal?.aborted) pool.put(worker);
        else await pool.stop(worker);
      }

      release();
    }
  };

  return {
    snapshot: () => ({ active, queued: waiting.length }),
    diagnostics: () => ({ active, queued: waiting.length, ...pool.snapshot() }),
    close: async () => {
      accepting = false;
      await pool.close();

      if (active) await new Promise<void>((resolve) => closeWaiters.push(resolve));
    },
    async blank(source: PdfInput, pages: number[], signal?: AbortSignal): Promise<number[]> {
      const [output] = await run(source, { operation: "blank", pages }, signal);
      const results = parseJson(new TextDecoder().decode(output));

      if (!isJsonArray(results) || !results.every((page): page is number => isNumber(page) && pages.includes(page)))
        throw new InvalidPdfSourceFileError();

      return results;
    },
    async materialize(source: PdfInput, groups: number[][], signal?: AbortSignal) {
      return run(source, { operation: "materialize", groups }, signal);
    },
    async preview(source: PdfInput, page: number, signal?: AbortSignal) {
      return (await run(source, { operation: "preview", page }, signal))[0]!;
    },
    /** Every page as lossless PNG, exactly as the Go processor sends rendered pages to models. */
    async render(source: PdfInput, signal?: AbortSignal) {
      try {
        return await run(source, { operation: "render" }, signal);
      } catch (error) {
        // Maximum DEFLATE effort keeps pages within the payload limit when fast compression alone does not.
        if (!(error instanceof PdfSourceFileLimitError) || signal?.aborted) throw error;

        return run(source, { operation: "render", compression: "best" }, signal);
      }
    },
  };
}

const operations = createPdfPageOperations();

export const materializePdfPageGroups = operations.materialize;

export const renderPdfPagePreview = operations.preview;

export const verifyPdfBlankPages = operations.blank;

export const renderPdfPages = operations.render;

/** The most rendered PNG bytes one Document may produce for a model request. */
export const MAX_RENDERED_PDF_BYTES = PDF_PAGE_OPERATION_LIMITS.totalArtifactBytes;

export const getPdfPageOperationsSnapshot = operations.diagnostics;

export async function materializePdfPages(
  source: PdfInput,
  pages: number[],
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return (await materializePdfPageGroups(source, [pages], signal))[0]!;
}

/** Retry only local admission, before PDF work starts; never repeat a model decision. */
export async function withPdfOperationCapacity<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const deadline = performance.now() + PDF_PAGE_OPERATION_LIMITS.wallTimeMs * 3;

  for (;;) {
    signal.throwIfAborted();

    try {
      return await work();
    } catch (error) {
      signal.throwIfAborted();

      if (!(error instanceof PdfSourceFileCapacityError) || performance.now() >= deadline) throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };

        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, 100);

        signal.addEventListener("abort", abort, { once: true });
      });
    }
  }
}
