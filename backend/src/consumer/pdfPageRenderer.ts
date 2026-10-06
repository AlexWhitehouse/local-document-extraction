import { encodePdfPng } from "./pdfPngEncoder";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const TARGET_PDF_RENDER_SCALE = 2;

const MAX_PDF_PAGE_DIMENSION = 2_048;

export const MAX_RENDERED_PDF_BYTES = 64 * 1024 * 1024;

export type PdfRenderTiming = {
  phase: "load" | "raster" | "encode";
  elapsedMs: number;
  bytes?: number;
};

export type PdfRenderOptions = {
  observe?: (sample: PdfRenderTiming) => void;
  fastPng?: boolean;
  overlapEncoding?: boolean;
};

export class PdfPreparationLimitError extends Error {}

export async function renderPdfPagesToPng(sourceBytes: ArrayBuffer, signal?: AbortSignal): Promise<ArrayBuffer[]> {
  const pages: ArrayBuffer[] = [];

  for await (const page of iteratePdfPagesToPng(sourceBytes, signal)) pages.push(page);

  return pages;
}

export async function* iteratePdfPagesToPng(
  sourceBytes: ArrayBuffer,
  signal?: AbortSignal,
  maxBytes = MAX_RENDERED_PDF_BYTES,
  selectedPages?: readonly number[],
  options?: PdfRenderOptions,
): AsyncGenerator<ArrayBuffer> {
  for await (const page of renderPages(sourceBytes, signal, maxBytes, selectedPages, false, options)) yield page.png!;
}

/** Conservative: any text, annotation, or nonwhite rendered pixel is not verified blank. */
export async function inspectPdfPageBlankness(
  sourceBytes: ArrayBuffer,
  selectedPages: readonly number[],
  signal?: AbortSignal,
): Promise<Array<{ page: number; blank: boolean }>> {
  const results: Array<{ page: number; blank: boolean }> = [];

  for await (const page of renderPages(sourceBytes, signal, MAX_RENDERED_PDF_BYTES, selectedPages, true))
    results.push({ page: page.page, blank: page.blank! });

  return results;
}

async function* renderPages(
  sourceBytes: ArrayBuffer,
  signal: AbortSignal | undefined,
  maxBytes: number,
  selectedPages: readonly number[] | undefined,
  inspectBlank: boolean,
  options?: PdfRenderOptions,
): AsyncGenerator<{ page: number; png?: ArrayBuffer; blank?: boolean }> {
  throwIfCancelled(signal);
  const pdfjsPackageUrl = import.meta.resolve("pdfjs-dist/package.json");

  const loadingStarted = performance.now();

  const loadingTask = getDocument({
    data: new Uint8Array(sourceBytes),
    standardFontDataUrl: fileURLToPath(new URL("./standard_fonts/", pdfjsPackageUrl)),
    wasmUrl: fileURLToPath(new URL("./wasm/", pdfjsPackageUrl)),
    stopAtErrors: true,
  });

  const cancelLoading = () => {
    void loadingTask.destroy();
  };

  signal?.addEventListener("abort", cancelLoading, { once: true });

  type EncodedPage = { page: number; png: ArrayBuffer };

  let pending: Promise<{ value: EncodedPage; error?: never } | { error: unknown; value?: never }> | null = null;

  const finishPending = async (): Promise<EncodedPage> => {
    const result = await pending!;
    pending = null;

    if ("error" in result) throw result.error;
    throwIfCancelled(signal);

    return result.value;
  };

  try {
    const document = await loadingTask.promise;
    options?.observe?.({ phase: "load", elapsedMs: performance.now() - loadingStarted });
    let renderedBytes = 0;
    const pageNumbers = selectedPages ?? Array.from({ length: document.numPages }, (_, index) => index + 1);

    if (
      !pageNumbers.length ||
      new Set(pageNumbers).size !== pageNumbers.length ||
      pageNumbers.some((page) => !Number.isSafeInteger(page) || page < 1 || page > document.numPages)
    )
      throw new Error("Invalid PDF render page selection");

    for (const pageNumber of pageNumbers) {
      throwIfCancelled(signal);
      const rasterStarted = performance.now();
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });

      if (
        !Number.isFinite(baseViewport.width) ||
        !Number.isFinite(baseViewport.height) ||
        baseViewport.width <= 0 ||
        baseViewport.height <= 0
      )
        throw new PdfPreparationLimitError("PDF page has invalid dimensions");

      const scale = Math.min(
        TARGET_PDF_RENDER_SCALE,
        MAX_PDF_PAGE_DIMENSION / baseViewport.width,
        MAX_PDF_PAGE_DIMENSION / baseViewport.height,
      );

      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));

      type BrowserRenderParameters = Parameters<typeof page.render>[0];

      type NativeRenderParameters = Omit<BrowserRenderParameters, "canvas" | "canvasContext"> & {
        canvas: null;
        canvasContext: SKRSContext2D;
      };

      // SAFETY: PDF.js's NodeCanvasFactory uses @napi-rs/canvas itself. Its browser-only declarations omit that supported context; keep the native contract explicit at this adapter.
      const render = page.render.bind(page) as (
        parameters: BrowserRenderParameters | NativeRenderParameters,
      ) => ReturnType<typeof page.render>;

      const renderTask = render({
        canvas: null,
        canvasContext: canvas.getContext("2d"),
        viewport,
        background: "rgb(255,255,255)",
      });

      const cancelRendering = () => renderTask.cancel();
      signal?.addEventListener("abort", cancelRendering, { once: true });

      try {
        await renderTask.promise;
        options?.observe?.({ phase: "raster", elapsedMs: performance.now() - rasterStarted });
        throwIfCancelled(signal);

        if (inspectBlank) {
          const text = await page.getTextContent();
          const annotations = await page.getAnnotations();
          let blank = !text.items.some((item) => "str" in item && item.str.trim()) && annotations.length === 0;

          if (blank) {
            const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;

            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i] !== 255 || pixels[i + 1] !== 255 || pixels[i + 2] !== 255) {
                blank = false;
                break;
              }
            }
          }

          throwIfCancelled(signal);
          yield { page: pageNumber, blank };
        } else {
          const encode = async (): Promise<EncodedPage> => {
            const encodingStarted = performance.now();
            const png = options?.fastPng ? await encodePdfPng(canvas) : await canvas.encode("png");
            options?.observe?.({ phase: "encode", elapsedMs: performance.now() - encodingStarted, bytes: png.byteLength });

            return { page: pageNumber, png: Uint8Array.from(png).buffer };
          };

          // At most two pages: rasterize this page while the preceding page's
          // lossless deflater runs. Observe rejection immediately, even on cancel.
          const next = (async () => {
            try { return { value: await encode() }; }
            catch (error) { return { error }; }
          })();

          const previous = pending;

          try {
            if (previous) {
              const ready = await finishPending();
              renderedBytes += ready.png.byteLength;

              if (renderedBytes > maxBytes) throw new PdfPreparationLimitError("Rendered PDF exceeds the model payload limit");
              yield ready;
            }
          } finally { pending = next; }

          if (!options?.overlapEncoding) {
            const ready = await finishPending();
            renderedBytes += ready.png.byteLength;

            if (renderedBytes > maxBytes) throw new PdfPreparationLimitError("Rendered PDF exceeds the model payload limit");
            yield ready;
          }
        }
      } finally {
        signal?.removeEventListener("abort", cancelRendering);
        page.cleanup();
      }
    }

    if (pending) {
      const ready = await finishPending();
      renderedBytes += ready.png.byteLength;

      if (renderedBytes > maxBytes) throw new PdfPreparationLimitError("Rendered PDF exceeds the model payload limit");
      yield ready;
    }
  } finally {
    await pending;
    signal?.removeEventListener("abort", cancelLoading);
    await loadingTask.destroy();
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("PDF page rendering cancelled", "AbortError");
}
