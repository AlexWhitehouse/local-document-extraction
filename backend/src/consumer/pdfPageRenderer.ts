import { createCanvas } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const TARGET_PDF_RENDER_SCALE = 2;
const MAX_PDF_PAGE_DIMENSION = 2_048;

export async function renderPdfPagesToPng(
  sourceBytes: ArrayBuffer,
  signal?: AbortSignal,
): Promise<ArrayBuffer[]> {
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
    const renderedPages: ArrayBuffer[] = [];

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
      renderedPages.push(Uint8Array.from(png).buffer);
      page.cleanup();
    }

    return renderedPages;
  } finally {
    await loadingTask.destroy();
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("PDF page rendering cancelled", "AbortError");
  }
}
