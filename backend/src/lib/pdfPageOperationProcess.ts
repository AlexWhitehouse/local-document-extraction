import { createRequire } from "node:module";
import { once } from "node:events";
import { loadInspectedPdf, PdfInspectionConfigurationError, PdfInspectionLimitError } from "./pdfInspectionParser";
import { PDF_PAGE_OPERATION_LIMITS as limits, PdfPageSelectionError, validatePdfPageSelection, type PdfPageOperation } from "./pdfPageOperations";
import { PdfPreparationLimitError, iteratePdfPagesToPng, inspectPdfPageBlankness } from "../consumer/pdfPageRenderer";

// PDF.js diagnostics must never contaminate the private binary output protocol.
console.log = console.warn = console.info = () => {};

// Only a bounded binary frame protocol leaves this disposable child. No PDF text,
// exception messages, environment credentials, JavaScript, or source metadata.
try {
  const operation = JSON.parse(process.argv[2] ?? "") as PdfPageOperation;
  if (!operation || !["preview", "materialize", "blank"].includes(operation.operation)) throw new Error();
  const reader = Bun.stdin.stream().getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limits.sourceBytes) throw new PdfInspectionLimitError();
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks, size);
  const inspected = await loadInspectedPdf(bytes);
  let written = 0;
  const writeArtifact = async (artifact: Uint8Array) => {
    written += artifact.byteLength;
    if (artifact.byteLength > limits.artifactBytes || written > limits.totalArtifactBytes) throw new PdfInspectionLimitError();
    const header = Buffer.alloc(4); header.writeUInt32BE(artifact.byteLength);
    if (!process.stdout.write(header)) await once(process.stdout, "drain");
    if (!process.stdout.write(artifact)) await once(process.stdout, "drain");
  };
  if (operation.operation === "preview") {
    const pages = validatePdfPageSelection([operation.page], inspected.pages);
    for await (const png of iteratePdfPagesToPng(Uint8Array.from(bytes).buffer, undefined, limits.previewBytes, pages)) await writeArtifact(new Uint8Array(png));
  } else if (operation.operation === "blank") {
    const pages = validatePdfPageSelection(operation.pages, inspected.pages);
    const results = await inspectPdfPageBlankness(Uint8Array.from(bytes).buffer, pages);
    await writeArtifact(Buffer.from(JSON.stringify(results.filter((result) => result.blank).map((result) => result.page))));
  } else {
    if (!Array.isArray(operation.groups) || !operation.groups.length || operation.groups.length > limits.groups) throw new PdfInspectionLimitError();
    const groups = operation.groups.map((group) => validatePdfPageSelection(group, inspected.pages));
    const all = groups.flat();
    if (new Set(all).size !== all.length) throw new PdfPageSelectionError("Groups overlap");
    const library = createRequire(import.meta.url)("pdf-lib/cjs/index.js") as typeof import("pdf-lib");
    for (const pages of groups) {
      inspected.checkLimits();
      const output = await library.PDFDocument.create();
      const copied = await output.copyPages(inspected.document, pages.map((page) => page - 1));
      copied.forEach((page) => output.addPage(page));
      // Serialize without object-stream compression: this provides an allocation
      // estimate before save rather than discovering a huge output afterward.
      const estimate = output.context.enumerateIndirectObjects().reduce((sum, [, value]) => sum + value.sizeInBytes() + 128, 1024);
      if (estimate > limits.artifactBytes || written + estimate > limits.totalArtifactBytes) throw new PdfInspectionLimitError();
      inspected.checkLimits();
      await writeArtifact(await output.save({ useObjectStreams: false, addDefaultPage: false }));
    }
  }
} catch (error) {
  process.exitCode = error instanceof PdfInspectionLimitError || error instanceof PdfPreparationLimitError ? 22 : error instanceof PdfInspectionConfigurationError ? 23 : error instanceof PdfPageSelectionError ? 24 : 21;
}
