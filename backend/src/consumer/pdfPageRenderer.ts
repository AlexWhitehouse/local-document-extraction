import { createCanvas } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const TARGET_PDF_RENDER_SCALE = 2;
const MAX_PDF_PAGE_DIMENSION = 2_048;
export const MAX_RENDERED_PDF_BYTES = 64 * 1024 * 1024;
export class PdfPreparationLimitError extends Error {}

export async function renderPdfPagesToPng(
  sourceBytes: ArrayBuffer,
  signal?: AbortSignal,
): Promise<ArrayBuffer[]> {
  const pages: ArrayBuffer[] = [];
  for await (const page of iteratePdfPagesToPng(sourceBytes, signal)) pages.push(page);
  return pages;
}

export async function* iteratePdfPagesToPng(
  sourceBytes: ArrayBuffer,
  signal?: AbortSignal,
  maxBytes = MAX_RENDERED_PDF_BYTES,
): AsyncGenerator<ArrayBuffer> {
  const pdfjsPackageUrl = import.meta.resolve("pdfjs-dist/package.json");
  const standardFontDataUrl = fileURLToPath(
    new URL("./standard_fonts/", pdfjsPackageUrl),
  );
  const wasmUrl = fileURLToPath(new URL("./wasm/", pdfjsPackageUrl));
  const loadingTask = getDocument({
    data: new Uint8Array(sourceBytes),
    standardFontDataUrl,
    wasmUrl,
  });

  try {
    const document = await loadingTask.promise;
    let renderedBytes = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      throwIfCancelled(signal);
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(
        TARGET_PDF_RENDER_SCALE,
        MAX_PDF_PAGE_DIMENSION / baseViewport.width,
        MAX_PDF_PAGE_DIMENSION / baseViewport.height,
      );
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const renderTask = page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        viewport,
        background: "rgb(255,255,255)",
      });
      const cancelRendering = () => renderTask.cancel();
      signal?.addEventListener("abort", cancelRendering, { once: true });

      try {
        await renderTask.promise;
      } finally {
        signal?.removeEventListener("abort", cancelRendering);
      }

      throwIfCancelled(signal);
      const png = await canvas.encode("png");
      renderedBytes += png.byteLength;
      page.cleanup();
      if (renderedBytes > maxBytes) throw new PdfPreparationLimitError("Rendered PDF exceeds the 64 MiB model payload limit");
      yield Uint8Array.from(png).buffer;
    }

  } finally {
    await loadingTask.destroy();
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("PDF page rendering cancelled", "AbortError");
  }
}
