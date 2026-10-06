/**
 * Upload inspection runs PDFium in isolated workers. Parsing is lazy: inspection
 * reads the page tree and page sizes, never content or unrelated streams. The
 * deadline and per-process memory ceiling bound whatever PDFium does decode.
 */
export const PDF_INSPECTION_LIMITS = Object.freeze({
  sourceBytes: 32 * 1024 * 1024,
  reservedSourceBytes: 64 * 1024 * 1024,
  pages: 10_000,
  wallTimeMs: 5_000,
  concurrent: 8,
  queued: 8,
  // Starting a worker costs more than many warm inspections; sampled RSS is the memory bound.
  workerDocuments: 2048,
  workerRssBytes: 128 * 1024 * 1024,
  // Ends an inspector during an operation; uploads never need this much.
  workerHardRssBytes: 256 * 1024 * 1024,
  workerIdleMs: 5_000,
});
