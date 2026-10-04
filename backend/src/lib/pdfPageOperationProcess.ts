import { parseJson, isJsonObject, isJsonArray, isNumber } from "../../../shared/json";
import { createRequire } from "node:module";
import { createPdfFrameReader } from "./pdfProcessPool";
import { loadInspectedPdf, PdfInspectionConfigurationError, PdfInspectionLimitError } from "./pdfInspectionParser";
import {
  PDF_PAGE_OPERATION_LIMITS as limits,
  PdfPageSelectionError,
  validatePdfPageSelection,
} from "./pdfPageOperations";

let renderer: typeof import("../consumer/pdfPageRenderer") | undefined;

// PDF.js diagnostics must never contaminate the private binary output protocol.
console.log = console.warn = console.info = () => {};

// Requests contain bounded JSON and source frames; responses contain artifact
// frames followed by a zero frame plus a recycle flag, or a sanitized error code.
const reader = createPdfFrameReader(Bun.stdin.stream());

let documents = 0;

let sourceBytes = 0;

try {
  for (;;) {
    const metadataHeader = await reader.read(4);

    if (!metadataHeader) break;
    const metadataSize = new DataView(metadataHeader.buffer).getUint32(0);

    if (!metadataSize || metadataSize > limits.metadataBytes) break;
    let failed = false;

    try {
      const metadata = await reader.read(metadataSize);

      if (!metadata) break;
      const operation = parseJson(new TextDecoder().decode(metadata));

      if (
        !isJsonObject(operation) ||
        (operation.operation !== "preview" && operation.operation !== "materialize" && operation.operation !== "blank")
      )
        throw new Error();
      const sourceHeader = await reader.read(4);

      if (!sourceHeader) break;
      const size = new DataView(sourceHeader.buffer).getUint32(0);

      if (!size || size > limits.sourceBytes) throw new PdfInspectionLimitError();
      const bytes = await reader.read(size);

      if (!bytes) break;
      sourceBytes += size;
      const inspected = await loadInspectedPdf(bytes);
      let written = 0;

      const writeArtifact = async (artifact: Uint8Array) => {
        written += artifact.byteLength;

        if (artifact.byteLength > limits.artifactBytes || written > limits.totalArtifactBytes)
          throw new PdfInspectionLimitError();
        const header = Buffer.alloc(4);
        header.writeUInt32BE(artifact.byteLength);
        await Bun.write(Bun.stdout, header);
        await Bun.write(Bun.stdout, artifact);
      };

      if (operation.operation === "preview") {
        if (!isNumber(operation.page)) throw new PdfPageSelectionError("Invalid preview page");
        const pages = validatePdfPageSelection([operation.page], inspected.pages);
        renderer = await import("../consumer/pdfPageRenderer");

        for await (const png of renderer.iteratePdfPagesToPng(
          Uint8Array.from(bytes).buffer,
          undefined,
          limits.previewBytes,
          pages,
        ))
          await writeArtifact(new Uint8Array(png));
      } else if (operation.operation === "blank") {
        const pages = validatePdfPageSelection(operation.pages, inspected.pages);
        renderer = await import("../consumer/pdfPageRenderer");
        const results = await renderer.inspectPdfPageBlankness(Uint8Array.from(bytes).buffer, pages);
        await writeArtifact(
          Buffer.from(JSON.stringify(results.flatMap((result) => (result.blank ? [result.page] : [])))),
        );
      } else {
        if (!isJsonArray(operation.groups) || !operation.groups.length || operation.groups.length > limits.groups)
          throw new PdfInspectionLimitError();
        const groups = operation.groups.map((group) => validatePdfPageSelection(group, inspected.pages));
        const all = groups.flat();

        if (new Set(all).size !== all.length) throw new PdfPageSelectionError("Groups overlap");
        // SAFETY: loadInspectedPdf checked the installed pdf-lib version before loading this same CommonJS entry point.
        const library = createRequire(import.meta.url)("pdf-lib/cjs/index.js") as typeof import("pdf-lib");

        for (const pages of groups) {
          inspected.checkLimits();
          const output = await library.PDFDocument.create();

          const copied = await output.copyPages(
            inspected.document,
            pages.map((page) => page - 1),
          );

          copied.forEach((page) => output.addPage(page));

          // Serialize without object-stream compression: this provides an allocation
          // estimate before save rather than discovering a huge output afterward.
          const estimate = output.context
            .enumerateIndirectObjects()
            .reduce((sum, [, value]) => sum + value.sizeInBytes() + 128, 1024);

          if (estimate > limits.artifactBytes || written + estimate > limits.totalArtifactBytes)
            throw new PdfInspectionLimitError();
          inspected.checkLimits();
          await writeArtifact(await output.save({ useObjectStreams: false, addDefaultPage: false }));
        }
      }
    } catch (error) {
      const code =
        error instanceof PdfInspectionLimitError || (renderer && error instanceof renderer.PdfPreparationLimitError)
          ? 22
          : error instanceof PdfInspectionConfigurationError
            ? 23
            : error instanceof PdfPageSelectionError
              ? 24
              : 21;

      const failure = Buffer.alloc(4);
      failure.writeInt32BE(-code);
      await Bun.write(Bun.stdout, failure);
      failed = true;
    }

    if (failed) break;
    documents++;

    const retire =
      documents >= limits.workerDocuments ||
      sourceBytes >= limits.workerSourceBytes ||
      process.memoryUsage.rss() >= limits.workerRssBytes;

    const end = new Uint8Array(5);
    end[4] = retire ? 1 : 0;
    await Bun.write(Bun.stdout, end);

    if (retire) break;
  }
} finally {
  await reader.close();
}
