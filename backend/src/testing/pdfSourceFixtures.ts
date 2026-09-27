import { deflateSync } from "node:zlib";

/** Small encoded PDFs with deliberately expensive metadata, never real documents. */
export function pdfWithCompressedObjectStreams(decodedSizes: number[]): Uint8Array {
  const parts: Uint8Array[] = [Buffer.from("%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>\nendobj\n")];
  for (const [index, size] of decodedSizes.entries()) {
    const decoded = Buffer.alloc(size, 32);
    decoded.write(`${100 + index} 0 << /Synthetic true >>`);
    const compressed = deflateSync(decoded);
    parts.push(Buffer.from(`${4 + index} 0 obj\n<< /Type /ObjStm /N 1 /First 6 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`), compressed, Buffer.from("\nendstream\nendobj\n"));
  }
  parts.push(Buffer.from("trailer\n<< /Root 1 0 R /Size 200 >>\n%%EOF\n"));
  return Buffer.concat(parts);
}
