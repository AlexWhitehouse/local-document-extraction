import { PDFDocument } from "pdf-lib";

export class InvalidPdfSourceFileError extends Error {
  code = "invalid_pdf_source_file" as const;

  constructor() {
    super("PDF Source file could not be read");
  }
}

export async function countPdfSourceFilePages(sourceBytes: ArrayBuffer | Uint8Array): Promise<number> {
  try {
    const pdf = await PDFDocument.load(sourceBytes);
    return pdf.getPageCount();
  } catch {
    throw new InvalidPdfSourceFileError();
  }
}
