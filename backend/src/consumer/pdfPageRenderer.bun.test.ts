import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "bun:test";

import { renderPdfPagesToPng } from "./pdfPageRenderer";

// Mozilla PDF.js test fixture: test/pdfs/jbig2_symbol_offset.pdf
// MD5: 6b22a0f838008fa4d8cb5b40ba095c48
const JBIG2_PDF_BASE64 = [
  "JVBERi0xLjQNCiX/9uTnDQoxIDAgb2JqDQo8PA0KL1R5cGUgL0NhdGFsb2cNCi9PcGVuQWN0aW9uIFs0IDAgUiAvRml0XQ0KL1BhZ2VzIDMgMCBSDQo+Pg0KZW5kb2JqDQoNCjIgMCBvYmoNCjw8DQovVHlwZSAvRm9udA0KL1N1YnR5cGUgL1R5cGUxDQovQmFzZUZvbnQgL0hlbHZldGljYQ0KL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcNCj4+DQplbmRvYmoNCg0KMyAwIG9iag0KPDwNCi9UeXBlIC9QYWdlcw0KL0NvdW50IDENCi9LaWRzIFsNCjQgMCBSDQpdDQo+Pg0KZW5kb2JqDQoNCjQgMCBvYmoNCjw8DQovVHlwZSAvUGFnZQ0KL1BhcmVudCAzIDAgUg0KL0NvbnRlbnRzIDUgMCBSDQovTWVkaWFCb3ggWzAgMCA1OTUuMjc1NiA4NDEuODg5OF0NCi9SZXNvdXJjZXMgPDwNCiAgICAvRm9udCA8PCAvRjEgMiAwIFIgPj4NCiAgICAvWE9iamVjdCA8PCAvSW0xIDYgMCBSID4+DQogID4+DQo+Pg0KZW5kb2JqDQoNCjUgMCBvYmoNCjw8IC9MZW5ndGggNDYgPj4NCnN0cmVhbQ0KcQ0KICA1MDAuMDAgMCAwIDUzLjAzMCA0OCA1NTAgY20NCiAgL0ltMSBEbw0KUQ0KZW5kc3RyZWFtDQplbmRvYmoNCg0KNiAwIG9iag0KPDwNCi9UeXBlIC9YT2JqZWN0DQovU3VidHlwZSAvSW1hZ2UNCi9XaWR0aCAxMzINCi9IZWlnaHQgMTQNCi9CaXRzUGVyQ29tcG9uZW50IDENCi9Db2xvclNwYWNlIC9EZXZpY2VHcmF5DQovRmlsdGVyIC9KQklHMkRlY29kZQ0KL0xlbmd0aCAxOTENCj4+DQpzdHJlYW0NCgAAAAAwAAEAAAATAAAAhAAAAA4AAAAAAAAAAAEAAAAAAAEAAQEAAABkCAAC/wAAAAgAAAAIOkg3iqy0BjDgkep75WQd/m2/8EWNvdsgkc5tcHTm85FPbi9ou+AvbOtrheIo0lRTEh6R0c5KRCGBPNKLnUP/KtAYszHJwfNPX7s3X2A3ou+KuVPcNBv/rAAAAAIHIAEBAAAAJgAAAIQAAAAOAAAAAAAAAAAAAAQAAAAJ6NCe+drwh3BhxTn6v/+sDQplbmRzdHJlYW0NCmVuZG9iag0KDQp4cmVmDQowIDcNCjAwMDAwMDAwMDAgNjU1MzUgZg0KMDAwMDAwMDAxNyAwMDAwMCBuDQowMDAwMDAwMTAwIDAwMDAwIG4NCjAwMDAwMDAyMDcgMDAwMDAgbg0KMDAwMDAwMDI3NyAwMDAwMCBuDQowMDAwMDAwNDYzIDAwMDAwIG4NCjAwMDAwMDA1NjcgMDAwMDAgbg0KDQp0cmFpbGVyDQo8PCAvU2l6ZSA3DQovUm9vdCAxIDAgUiA+Pg0Kc3RhcnR4cmVmDQo5NDQNCiUlRU9GDQo=",
].join("");

describe("renderPdfPagesToPng", () => {
  it("renders JBIG2-compressed images", async () => {
    const sourceBytes = Uint8Array.from(
      Buffer.from(JBIG2_PDF_BASE64, "base64"),
    ).buffer;

    const [pngBytes] = await renderPdfPagesToPng(sourceBytes);

    const image = await loadImage(Buffer.from(pngBytes));
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let nonWhitePixelCount = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index] < 250 ||
        pixels[index + 1] < 250 ||
        pixels[index + 2] < 250
      ) {
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
    pdf.addJavaScript(
      "hostile-script",
      `globalThis.${executionMarker} = true`,
    );

    try {
      const renderedPages = await renderPdfPagesToPng(
        Uint8Array.from(await pdf.save()).buffer,
      );

      expect(renderedPages).toHaveLength(1);
      expect(Reflect.get(globalThis, executionMarker)).toBeUndefined();
    } finally {
      Reflect.deleteProperty(globalThis, executionMarker);
    }
  });
});
