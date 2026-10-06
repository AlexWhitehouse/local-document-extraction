import { describe, expect, it } from "bun:test";
import { PDFDocument, rgb } from "pdf-lib";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  PDF_PAGE_OPERATION_LIMITS,
  createPdfPageOperations,
  materializePdfPageGroups,
  materializePdfPages,
  renderPdfPagePreview,
  validatePdfPageSelection,
  verifyPdfBlankPages,
} from "./pdfPageOperations";
import { pdfWithPageContent } from "../testing/pdfSourceFixtures";

async function fixture() {
  const pdf = await PDFDocument.create();

  for (let i = 1; i <= 4; i++) {
    const page = pdf.addPage([100 + i, 100]);

    if (i === 1 || i === 3) page.drawText(`DOCUMENT ${i}`, { x: 2, y: 60, size: 9 });

    if (i === 4) page.drawText("HIDDEN BUT NOT BLANK", { x: 2, y: 60, size: 5, color: rgb(1, 1, 1) });
  }

  return Uint8Array.from(await pdf.save());
}

describe("isolated PDF page operations", () => {
  it("materializes noncontiguous page groups in original order with no sibling pages", async () => {
    const source = await fixture();
    const [left, right] = await materializePdfPageGroups(source, [[4, 1], [3]]);
    // Each fixture page has a distinct width, so widths identify the copied pages.
    expect((await PDFDocument.load(left!)).getPages().map((page) => page.getWidth())).toEqual([101, 104]);
    expect((await PDFDocument.load(right!)).getPages().map((page) => page.getWidth())).toEqual([103]);
    expect((await PDFDocument.load(source)).getPageCount()).toBe(4);
  });

  it("renders only the requested original page and independently verifies blankness", async () => {
    const source = await fixture();
    const image = await loadImage(Buffer.from(await renderPdfPagePreview(source, 3)));
    expect(image.width).toBe(206);
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext("2d").drawImage(image, 0, 0);
    expect(
      canvas
        .getContext("2d")
        .getImageData(0, 0, image.width, image.height)
        .data.some((pixel) => pixel !== 255),
    ).toBe(true);
    expect(await verifyPdfBlankPages(source, [1, 2, 3, 4])).toEqual([2]);
  });

  it("rejects empty, duplicate, overlapping and out-of-range selections", async () => {
    const source = await fixture();

    for (const pages of [[], [0], [-1], [1.5], [1, 1], [5]])
      await expect(materializePdfPages(source, pages)).rejects.toMatchObject({ code: "invalid_page_selection" });
    await expect(materializePdfPageGroups(source, [[1], [1]])).rejects.toMatchObject({
      code: "invalid_page_selection",
    });
    await expect(renderPdfPagePreview(source, 5)).rejects.toMatchObject({ code: "invalid_page_selection" });
    expect(validatePdfPageSelection([3, 1], 3)).toEqual([1, 3]);
  });

  it("bounds drawing a page whose content inflates past the worker memory ceiling", async () => {
    const ceiling = 128 * 1024 * 1024;
    const operations = createPdfPageOperations({ workerHardRssBytes: ceiling });
    const bomb = pdfWithPageContent(ceiling + 64 * 1024 * 1024);

    try {
      // Copying a page keeps its content encoded; drawing it must decode it.
      expect(await operations.materialize(bomb, [[1]])).toHaveLength(1);
      await expect(operations.preview(bomb, 1)).rejects.toMatchObject({ code: "pdf_source_file_limit_exceeded" });
      await expect(operations.blank(bomb, [1])).rejects.toMatchObject({ code: "pdf_source_file_limit_exceeded" });
      await expect(operations.render(bomb)).rejects.toMatchObject({ code: "pdf_source_file_limit_exceeded" });
      expect(await operations.blank(pdfWithPageContent(1024), [1])).toEqual([1]);
    } finally {
      await operations.close();
    }
  }, 30_000);

  it("kills timed-out processes and frees capacity", async () => {
    const operations = createPdfPageOperations({ timeoutMs: 1 });
    await expect(operations.materialize(await fixture(), [[1]])).rejects.toMatchObject({
      code: "pdf_source_file_limit_exceeded",
    });
    expect(operations.snapshot()).toEqual({ active: 0, queued: 0 });
  });

  it("bounds its queue and removes cancelled waiters before dispatch", async () => {
    const source = await fixture();
    const operations = createPdfPageOperations({ maxConcurrent: 1, maxQueued: 4 });
    const controller = new AbortController();
    const first = operations.materialize(source, [[1]]);
    const pending = operations.materialize(source, [[2]], controller.signal);
    const others = [1, 2, 3].map(() => operations.materialize(source, [[3]]));
    const full = operations.materialize(source, [[4]]);
    await expect(full).rejects.toMatchObject({ code: "pdf_validation_capacity_unavailable" });
    expect(operations.snapshot()).toEqual({ active: 1, queued: 4 });
    controller.abort();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    await Promise.all([first, ...others]);
    expect(operations.snapshot()).toEqual({ active: 0, queued: 0 });
  });

  it("cancels a running process and sanitizes malformed source errors", async () => {
    const operations = createPdfPageOperations();
    const controller = new AbortController();
    const running = operations.materialize(await fixture(), [[1]], controller.signal);
    await Bun.sleep(1);
    controller.abort();
    await expect(running).rejects.toHaveProperty("name", "AbortError");
    expect(operations.snapshot()).toEqual({ active: 0, queued: 0 });
    await expect(operations.materialize(new TextEncoder().encode("private malformed source"), [[1]])).rejects.toThrow(
      "PDF Source file could not be read",
    );
  });
});

it("recycles page workers after bounded use and retires them after malformed inputs", async () => {
  const operations = createPdfPageOperations({ maxConcurrent: 1 });
  const source = await fixture();

  try {
    for (let index = 0; index <= PDF_PAGE_OPERATION_LIMITS.workerDocuments; index++) {
      const page = (index % 4) + 1;
      const [output] = await operations.materialize(source, [[page]]);
      expect((await PDFDocument.load(output!)).getPages().map((item) => item.getWidth())).toEqual([100 + page]);
    }

    expect(operations.diagnostics().spawned).toBe(2);
    await expect(operations.materialize(new TextEncoder().encode("not a PDF"), [[1]])).rejects.toMatchObject({
      code: "invalid_pdf_source_file",
    });
    const [output] = await operations.materialize(source, [[2]]);
    expect((await PDFDocument.load(output!)).getPageCount()).toBe(1);
    expect(operations.diagnostics().spawned).toBe(3);
  } finally {
    await operations.close();
  }

  expect(operations.diagnostics().idle).toBe(0);
});
