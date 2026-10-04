/** Bounds apply to PDF metadata inspection, not image rendering or whole-process RSS. */
export const PDF_INSPECTION_LIMITS = Object.freeze({
  sourceBytes: 32 * 1024 * 1024,
  reservedSourceBytes: 64 * 1024 * 1024,
  decodedStreamBytes: 16 * 1024 * 1024,
  decodedAllocations: 32 * 1024 * 1024,
  copiedBytes: 64 * 1024 * 1024,
  scannedBytes: 64 * 1024 * 1024,
  tokenBytes: 256 * 1024,
  totalTokenBytes: 8 * 1024 * 1024,
  objects: 100_000,
  nesting: 64,
  streamEntries: 50_000,
  pages: 10_000,
  wallTimeMs: 5_000,
  concurrent: 8,
  queued: 8,
  workerDocuments: 32,
  workerSourceBytes: 64 * 1024 * 1024,
  workerRssBytes: 128 * 1024 * 1024,
  workerIdleMs: 5_000,
});

export type PdfInspectionResult = { pages: number } | { error: "invalid" | "limit" | "configuration" };
