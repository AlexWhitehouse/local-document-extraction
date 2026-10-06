import { stat } from "node:fs/promises";
import { parseJson, isJsonObject, isJsonArray, isNumber, isString } from "../../../shared/json";
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
        (operation.operation !== "preview" && operation.operation !== "materialize" && operation.operation !== "blank" && operation.operation !== "render")
      )
        throw new Error();
      const sourceHeader = await reader.read(4);

      if (!sourceHeader) break;
      const size = new DataView(sourceHeader.buffer).getUint32(0);
      let bytes: Uint8Array<ArrayBuffer> | null;

      if (size === 0 && isString(operation.source_path) && process.env.GO_PDF_FILE_INPUT === "1") {
        const info = await stat(operation.source_path);

        if (!info.isFile() || info.size < 1 || info.size > limits.sourceBytes) throw new PdfInspectionLimitError();
        bytes = new Uint8Array(await Bun.file(operation.source_path).arrayBuffer());

        if (bytes.byteLength !== info.size || bytes.byteLength > limits.sourceBytes) throw new PdfInspectionLimitError();
      } else {
        if (!size || size > limits.sourceBytes) throw new PdfInspectionLimitError();
        bytes = await reader.read(size);
      }

      if (!bytes) break;
      sourceBytes += bytes.byteLength;
      let written = 0;
      const timings = { load: 0, raster: 0, encode: 0, pages: 0 };

      const writeArtifact = async (artifact: Uint8Array) => {
        written += artifact.byteLength;

        if (artifact.byteLength > limits.artifactBytes || written > limits.totalArtifactBytes)
          throw new PdfInspectionLimitError();
        const header = Buffer.alloc(4);
        header.writeUInt32BE(artifact.byteLength);
        await Bun.write(Bun.stdout, header);
        await Bun.write(Bun.stdout, artifact);
      };

      if (operation.operation === "render") {
        // This private operation receives already-admitted immutable sources.
        // Match extraction's renderer directly; a second pdf-lib parse adds no validation.
        renderer = await import("../consumer/pdfPageRenderer");

        const pages = operation.pages === undefined ? undefined : validatePdfPageSelection(operation.pages, limits.pages);

        for await (const png of renderer.iteratePdfPagesToPng(bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : Uint8Array.from(bytes).buffer, undefined, undefined, pages, {
          fastPng: process.env.GO_PDF_RENDER_PROCESS === "1" && process.env.GO_PDF_PNG_ENCODER !== "native" && operation.png_encoder !== "native",
          overlapEncoding: process.env.GO_PDF_OVERLAP !== "0",
          observe: (sample) => { timings[sample.phase] += sample.elapsedMs;

 if (sample.phase === "raster") timings.pages++; },
        }))
          await writeArtifact(new Uint8Array(png));
      } else {
        const inspected = await loadInspectedPdf(bytes);

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
      }

      if (process.env.GO_PDF_RENDER_PROCESS === "1") {
        const stats = Buffer.from(JSON.stringify({ ...timings, rss: process.memoryUsage.rss() }));
        const header = Buffer.alloc(8);
        header.writeInt32BE(-30);
        header.writeUInt32BE(stats.length, 4);
        await Bun.write(Bun.stdout, header);
        await Bun.write(Bun.stdout, stats);
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
      documents >= (process.env.GO_PDF_RENDER_PROCESS === "1" ? Number(process.env.GO_PDF_WORKER_DOCUMENTS ?? 128) : limits.workerDocuments) ||
      sourceBytes >= limits.workerSourceBytes ||
      process.memoryUsage.rss() >= (process.env.GO_PDF_RENDER_PROCESS === "1" ? 384 * 1024 * 1024 : limits.workerRssBytes);

    const end = new Uint8Array(5);
    end[4] = retire ? 1 : 0;
    await Bun.write(Bun.stdout, end);

    if (retire) break;
  }
} finally {
  await reader.close();
}
