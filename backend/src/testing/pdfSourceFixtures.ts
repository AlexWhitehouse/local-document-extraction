import { deflateSync } from "node:zlib";

/** Small encoded PDFs with deliberately expensive metadata, never real documents. */
export function pdfWithCompressedObjectStreams(decodedSizes: number[]): Uint8Array {
  const parts: Uint8Array[] = [
    Buffer.from(
      "%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>\nendobj\n",
    ),
  ];

  for (const [index, size] of decodedSizes.entries()) {
    const decoded = Buffer.alloc(size, 32);
    decoded.write(`${100 + index} 0 << /Synthetic true >>`);
    const compressed = deflateSync(decoded);
    parts.push(
      Buffer.from(
        `${4 + index} 0 obj\n<< /Type /ObjStm /N 1 /First 6 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
      ),
      compressed,
      Buffer.from("\nendstream\nendobj\n"),
    );
  }

  parts.push(Buffer.from("trailer\n<< /Root 1 0 R /Size 200 >>\n%%EOF\n"));

  return Buffer.concat(parts);
}

/** The catalog, page tree and page live in one object stream that inflates to
 * at least decodedBytes, reachable only through an xref stream, so reading the
 * page count must decode it. */
export function pdfWithPageTreeInObjectStream(decodedBytes: number): Uint8Array {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>"];
  let header = "";
  let body = "";

  for (const [index, object] of objects.entries()) {
    header += `${index + 1} ${body.length} `;
    body += `${object}\n`;
  }

  const decoded = Buffer.alloc(Math.max(decodedBytes, header.length + body.length), 32);
  decoded.write(header + body);
  const stream = deflateSync(decoded);
  const prefix = "%PDF-1.5\n";

  const objectStream = Buffer.concat([
    Buffer.from(`4 0 obj\n<< /Type /ObjStm /N 3 /First ${header.length} /Filter /FlateDecode /Length ${stream.length} >>\nstream\n`),
    stream,
    Buffer.from("\nendstream\nendobj\n"),
  ]);

  const xrefOffset = prefix.length + objectStream.length;
  const entries = Buffer.alloc(6 * 7);

  const entry = (index: number, type: number, field: number, generation: number) => {
    entries.writeUInt8(type, index * 7);
    entries.writeUInt32BE(field, index * 7 + 1);
    entries.writeUInt16BE(generation, index * 7 + 5);
  };

  entry(0, 0, 0, 65535);

  for (let index = 0; index < 3; index++) entry(index + 1, 2, 4, index);
  entry(4, 1, prefix.length, 0);
  entry(5, 1, xrefOffset, 0);

  return Buffer.concat([
    Buffer.from(prefix),
    objectStream,
    Buffer.from(`5 0 obj\n<< /Type /XRef /Size 6 /W [1 4 2] /Root 1 0 R /Length ${entries.length} >>\nstream\n`),
    entries,
    Buffer.from(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`),
  ]);
}

/** One page whose content stream inflates to decodedBytes of whitespace: cheap
 * to admit and copy, and decoded only when the page is drawn. */
export function pdfWithPageContent(decodedBytes: number): Uint8Array {
  const content = deflateSync(Buffer.alloc(decodedBytes, 32));

  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>"),
    Buffer.concat([Buffer.from(`<< /Filter /FlateDecode /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream")]),
  ];

  const parts: Uint8Array[] = [Buffer.from("%PDF-1.7\n")];
  const offsets: number[] = [];
  let length = parts[0]!.length;

  for (const [index, object] of objects.entries()) {
    const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    offsets.push(length);
    parts.push(part);
    length += part.length;
  }

  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));

  return Buffer.concat(parts);
}
