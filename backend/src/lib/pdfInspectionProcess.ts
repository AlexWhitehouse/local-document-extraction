import { PDF_INSPECTION_LIMITS as limits, type PdfInspectionResult } from "./pdfInspectionLimits";
import { inspectPdfPages, PdfInspectionConfigurationError, PdfInspectionLimitError } from "./pdfInspectionParser";

let result: PdfInspectionResult;
try {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = Bun.stdin.stream().getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limits.sourceBytes) throw new PdfInspectionLimitError();
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  result = { pages: await inspectPdfPages(Buffer.concat(chunks, size)) };
} catch (error) {
  result = { error: error instanceof PdfInspectionLimitError ? "limit" : error instanceof PdfInspectionConfigurationError ? "configuration" : "invalid" };
}
// This bounded protocol contains no source data or dependency exception text.
process.stdout.write(JSON.stringify(result));
