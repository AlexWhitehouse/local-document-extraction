import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it } from "bun:test";

import { renderPdfPagesToPng, iteratePdfPagesToPng, PdfPreparationLimitError } from "./pdfPageRenderer";

import { JBIG2_PDF_BASE64 } from "../../fixtures/jbig2SymbolOffset";

describe("renderPdfPagesToPng", () => {
  it("stops preparation at the encoded-byte limit", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    const pages = iteratePdfPagesToPng(Uint8Array.from(await pdf.save()).buffer, undefined, 1);
    await expect(pages.next()).rejects.toBeInstanceOf(PdfPreparationLimitError);
  });
  it("renders JBIG2-compressed images", async () => {
    const sourceBytes = Uint8Array.from(Buffer.from(JBIG2_PDF_BASE64, "base64")).buffer;

    const [pngBytes] = await renderPdfPagesToPng(sourceBytes);

    const image = await loadImage(Buffer.from(pngBytes));
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let nonWhitePixelCount = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 250 || pixels[index + 1] < 250 || pixels[index + 2] < 250) {
        nonWhitePixelCount += 1;
      }
    }

    expect(nonWhitePixelCount).toBeGreaterThan(0);
  });

  it("does not execute JavaScript embedded in a PDF", async () => {
    const executionMarker = "__documentExtractionPdfScriptExecuted";
    Reflect.deleteProperty(globalThis, executionMarker);
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    pdf.addJavaScript("hostile-script", `globalThis.${executionMarker} = true`);

    try {
      const renderedPages = await renderPdfPagesToPng(Uint8Array.from(await pdf.save()).buffer);

      expect(renderedPages).toHaveLength(1);
      expect(Object.hasOwn(globalThis, executionMarker)).toBe(false);
    } finally {
      Reflect.deleteProperty(globalThis, executionMarker);
    }
  });
});

it("selected pages match a rendered subset in pixels, order and dimensions", async () => {
  const pdf = await PDFDocument.create();

  for (const width of [100, 130, 170]) pdf.addPage([width, 90]).drawText(`Page width ${width}`, { x: 5, y: 20, size: 10 });
  pdf.getPages()[2]!.setRotation(degrees(90));
  const source = Uint8Array.from(await pdf.save()).buffer;
  const subset = await PDFDocument.create();

  for (const page of await subset.copyPages(pdf, [0, 2])) subset.addPage(page);
  const subsetBytes = Uint8Array.from(await subset.save()).buffer;

  const decode = async (data: ArrayBuffer) => {
    const image = await loadImage(Buffer.from(data));
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext("2d").drawImage(image, 0, 0);

    return { width: image.width, height: image.height, pixels: Buffer.from(canvas.getContext("2d").getImageData(0, 0, image.width, image.height).data) };
  };

  const expected = [];

  for await (const png of iteratePdfPagesToPng(subsetBytes)) expected.push(await decode(png));
  const actual = [];

  for await (const png of iteratePdfPagesToPng(source.slice(0), undefined, undefined, [1, 3])) actual.push(await decode(png));
  expect(actual).toEqual(expected);
  expect(actual.map((page) => [page.width, page.height])).toEqual([[200, 180], [180, 340]]);
});

