import { PDFDocument } from "../backend/node_modules/pdf-lib";
import { renderPdfPagesToPng } from "../backend/src/consumer/pdfPageRenderer";

const pdf = await PDFDocument.create();
pdf.addPage([100, 100]);
const source = await pdf.save();
const pages = await renderPdfPagesToPng(Uint8Array.from(source).buffer);
if (pages.length !== 1 || new Uint8Array(pages[0]!)[0] !== 0x89) {
  throw new Error("Native PDF rendering check failed.");
}
console.log("Native PDF rendering is available.");
