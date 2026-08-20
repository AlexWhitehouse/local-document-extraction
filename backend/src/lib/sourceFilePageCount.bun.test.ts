import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "bun:test";

import { countPdfSourceFilePages } from "./sourceFilePageCount";

describe("Source file page count", () => {
  it("returns 1 for a valid one-page PDF Source file", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();

    await expect(countPdfSourceFilePages(bytes)).resolves.toBe(1);
  });

  it("returns the page count for a valid multi-page PDF Source file", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    pdf.addPage();
    const bytes = await pdf.save();

    await expect(countPdfSourceFilePages(bytes)).resolves.toBe(3);
  });

  it("rejects malformed PDF bytes with a stable invalid-PDF failure", async () => {
    const bytes = new TextEncoder().encode("not a pdf");

    await expect(countPdfSourceFilePages(bytes)).rejects.toMatchObject({
      code: "invalid_pdf_source_file",
      message: "PDF Source file could not be read",
    });
  });
});
