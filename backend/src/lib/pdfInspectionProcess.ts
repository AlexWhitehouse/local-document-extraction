import { createPdfFrameReader } from "./pdfProcessPool";
import { PDF_INSPECTION_LIMITS as limits, type PdfInspectionResult } from "./pdfInspectionLimits";
import { inspectPdfPages, PdfInspectionConfigurationError, PdfInspectionLimitError } from "./pdfInspectionParser";

// A private, bounded protocol; library diagnostics must never become responses.
console.log = console.warn = console.info = () => {};

const reader = createPdfFrameReader(Bun.stdin.stream());

let documents = 0;

let sourceBytes = 0;

try {
  for (;;) {
    const header = await reader.read(4);

    if (!header) break;
    const size = new DataView(header.buffer).getUint32(0);

    if (!size || size > limits.sourceBytes) break;
    let result: PdfInspectionResult;

    try {
      const bytes = await reader.read(size);

      if (!bytes) break;
      result = { pages: await inspectPdfPages(bytes) };
    } catch (error) {
      result = {
        error:
          error instanceof PdfInspectionLimitError
            ? "limit"
            : error instanceof PdfInspectionConfigurationError
              ? "configuration"
              : "invalid",
      };
    }

    documents++;
    sourceBytes += size;

    const retire =
      "error" in result ||
      documents >= limits.workerDocuments ||
      sourceBytes >= limits.workerSourceBytes ||
      process.memoryUsage.rss() >= limits.workerRssBytes;

    const response = new TextEncoder().encode(JSON.stringify({ ...result, retire }));
    const responseHeader = new Uint8Array(4);
    new DataView(responseHeader.buffer).setUint32(0, response.byteLength);
    await Bun.write(Bun.stdout, responseHeader);
    await Bun.write(Bun.stdout, response);

    if (retire) break;
  }
} finally {
  await reader.close();
}
