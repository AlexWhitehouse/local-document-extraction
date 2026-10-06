import { stat } from "node:fs/promises";
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
    const frame = new DataView(header.buffer).getUint32(0);
    const pathFrame = (frame & 0x80000000) !== 0;
    const size = frame & 0x7fffffff;

    if (!size || size > (pathFrame ? 4096 : limits.sourceBytes)) break;
    let inspectedBytes = size;
    let result: PdfInspectionResult;

    try {
      let bytes = await reader.read(size);

      if (!bytes) break;

      if (pathFrame) {
        const path = new TextDecoder().decode(bytes);
        const info = await stat(path);

        if (!info.isFile() || info.size > limits.sourceBytes) throw new PdfInspectionLimitError();
        bytes = new Uint8Array(await Bun.file(path).arrayBuffer());

        if (bytes.byteLength !== info.size || bytes.byteLength > limits.sourceBytes) throw new PdfInspectionLimitError();
        inspectedBytes = bytes.byteLength;
      }

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
    sourceBytes += inspectedBytes;

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
