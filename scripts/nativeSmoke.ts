import { closePdfInspection, countPdfSourceFilePages } from "../backend/src/lib/sourceFilePageCount";
import { renderPdfPages } from "../backend/src/lib/pdfPageOperations";

// A one-page PDF, inline so the check needs no PDF-writing dependency.
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>",
];

let document = "%PDF-1.7\n";

const offsets: number[] = [];

for (const [index, object] of objects.entries()) {
  offsets.push(document.length);
  document += `${index + 1} 0 obj\n${object}\nendobj\n`;
}

const xref = document.length;

document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

for (const offset of offsets) document += `${String(offset).padStart(10, "0")} 00000 n \n`;

document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const source = new TextEncoder().encode(document);

try {
  const pages = await renderPdfPages(source);

  if ((await countPdfSourceFilePages(source)) !== 1 || pages.length !== 1 || pages[0]![0] !== 0x89)
    throw new Error("Native PDF engine check failed.");
} finally {
  await closePdfInspection();
}

console.log("Native PDF engine (PDFium) is available.");
