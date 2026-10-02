import { fileURLToPath } from "node:url";
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
  concurrent: 1,
  queued: 4,
});

export class PdfPageSelectionError extends Error {
  code = "invalid_page_selection" as const;
}

/** Physical page numbers, preserved in original order. Never silently deduplicate. */
export function validatePdfPageSelection(value: unknown, pageCount: number): number[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > PDF_PAGE_OPERATION_LIMITS.pages) throw new PdfPageSelectionError("Invalid source page count");
  if (!Array.isArray(value) || !value.length || value.length > pageCount) throw new PdfPageSelectionError("Select at least one source page");
  const seen = new Set<number>();
  for (const page of value) {
    if (!Number.isSafeInteger(page) || page < 1 || page > pageCount || seen.has(page)) throw new PdfPageSelectionError("Page selection must contain unique, in-range physical page numbers");
    seen.add(page);
  }
  return [...seen].sort((a, b) => a - b);
}

type PdfInput = Blob | Uint8Array | ArrayBuffer;
export type PdfPageOperation = { operation: "materialize"; groups: number[][] } | { operation: "preview"; page: number } | { operation: "blank"; pages: number[] };

/** Bounded, cancellable subprocess queue. Source bytes are read only after admission. */
export function createPdfPageOperations(options: { timeoutMs?: number; queueTimeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? PDF_PAGE_OPERATION_LIMITS.wallTimeMs;
  const queueTimeoutMs = options.queueTimeoutMs ?? PDF_PAGE_OPERATION_LIMITS.wallTimeMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(queueTimeoutMs) || queueTimeoutMs < 1) throw new Error("Invalid PDF operation timeout");
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (active < PDF_PAGE_OPERATION_LIMITS.concurrent) { active++; return; }
    if (waiting.length >= PDF_PAGE_OPERATION_LIMITS.queued) throw new PdfSourceFileCapacityError();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      const ready = () => { cleanup(); resolve(); };
      const fail = (error: Error) => {
        const index = waiting.indexOf(ready);
        if (index < 0) return;
        waiting.splice(index, 1); cleanup(); reject(error);
      };
      const abort = () => fail(new DOMException("PDF operation cancelled", "AbortError"));
      const timer = setTimeout(() => fail(new PdfSourceFileCapacityError()), queueTimeoutMs);
      waiting.push(ready);
      signal?.addEventListener("abort", abort, { once: true });
    });
  };
  const release = () => { const next = waiting.shift(); if (next) next(); else active--; };
  const run = async (source: PdfInput, operation: PdfPageOperation, signal?: AbortSignal): Promise<Uint8Array[]> => {
    const sourceSize = source instanceof Blob ? source.size : source.byteLength;
    signal?.throwIfAborted();
    if (!sourceSize || sourceSize > PDF_PAGE_OPERATION_LIMITS.sourceBytes) throw new PdfSourceFileLimitError();
    if (operation.operation === "materialize") {
      if (!operation.groups.length || operation.groups.length > PDF_PAGE_OPERATION_LIMITS.groups) throw new PdfSourceFileLimitError();
      const seen = new Set<number>();
      operation = { operation: "materialize", groups: operation.groups.map((group) => {
        const pages = validatePdfPageSelection(group, PDF_PAGE_OPERATION_LIMITS.pages);
        for (const page of pages) { if (seen.has(page)) throw new PdfPageSelectionError("Page groups must not overlap"); seen.add(page); }
        return pages;
      }) };
    } else if (operation.operation === "blank") {
      operation = { operation: "blank", pages: validatePdfPageSelection(operation.pages, PDF_PAGE_OPERATION_LIMITS.pages) };
    } else if (!Number.isSafeInteger(operation.page) || operation.page < 1 || operation.page > PDF_PAGE_OPERATION_LIMITS.pages) throw new PdfPageSelectionError("Invalid preview page");
    await acquire(signal);
    try {
      signal?.throwIfAborted();
      const bytes = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : source instanceof Uint8Array ? source : new Uint8Array(source);
      signal?.throwIfAborted();
      const child = Bun.spawn([process.execPath, "--no-env-file", "--smol", fileURLToPath(new URL("./pdfPageOperationProcess.ts", import.meta.url)), JSON.stringify(operation)], { stdin: bytes, stdout: "pipe", stderr: "ignore", env: {} });
      let timedOut = false;
      const terminate = () => child.kill("SIGKILL");
      const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
      signal?.addEventListener("abort", terminate, { once: true });
      try {
        if (signal?.aborted) terminate();
        const reader = child.stdout.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        const maximum = operation.operation === "materialize" ? PDF_PAGE_OPERATION_LIMITS.totalArtifactBytes + operation.groups.length * 4 : operation.operation === "blank" ? 256 * 1024 : PDF_PAGE_OPERATION_LIMITS.previewBytes + 4;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > maximum) { terminate(); throw new PdfSourceFileLimitError(); }
            chunks.push(chunk.value);
          }
        } finally { reader.releaseLock(); }
        const exit = await child.exited;
        signal?.throwIfAborted();
        if (timedOut || exit === 22) throw new PdfSourceFileLimitError();
        if (exit === 24) throw new PdfPageSelectionError("Page selection must contain unique, in-range physical page numbers");
        if (exit !== 0) throw new InvalidPdfSourceFileError();
        const output = Buffer.concat(chunks, size);
        const artifacts: Uint8Array[] = [];
        let offset = 0;
        while (offset < output.length) {
          if (offset + 4 > output.length) throw new InvalidPdfSourceFileError();
          const length = output.readUInt32BE(offset); offset += 4;
          if (!length || length > PDF_PAGE_OPERATION_LIMITS.artifactBytes || offset + length > output.length) throw new InvalidPdfSourceFileError();
          artifacts.push(output.subarray(offset, offset + length)); offset += length;
        }
        if (artifacts.length !== (operation.operation === "materialize" ? operation.groups.length : 1)) throw new InvalidPdfSourceFileError();
        return artifacts;
      } catch (error) {
        if (signal?.aborted) throw new DOMException("PDF operation cancelled", "AbortError");
        if (timedOut) throw new PdfSourceFileLimitError();
        throw error;
      } finally {
        clearTimeout(timer); signal?.removeEventListener("abort", terminate); terminate(); await child.exited;
      }
    } finally { release(); }
  };
  return {
    snapshot: () => ({ active, queued: waiting.length }),
    async blank(source: PdfInput, pages: number[], signal?: AbortSignal): Promise<number[]> {
      const [output] = await run(source, { operation: "blank", pages }, signal);
      const results: unknown = JSON.parse(new TextDecoder().decode(output));
      if (!Array.isArray(results) || results.some((page) => !pages.includes(page))) throw new InvalidPdfSourceFileError();
      return results;
    },
    async materialize(source: PdfInput, groups: number[][], signal?: AbortSignal) { return run(source, { operation: "materialize", groups }, signal); },
    async preview(source: PdfInput, page: number, signal?: AbortSignal) { return (await run(source, { operation: "preview", page }, signal))[0]!; },
  };
}

const operations = createPdfPageOperations();
export const materializePdfPageGroups = operations.materialize;
export const renderPdfPagePreview = operations.preview;
export const verifyPdfBlankPages = operations.blank;
export const getPdfPageOperationsSnapshot = operations.snapshot;
export async function materializePdfPages(source: PdfInput, pages: number[], signal?: AbortSignal): Promise<Uint8Array> {
  return (await materializePdfPageGroups(source, [pages], signal))[0]!;
}
