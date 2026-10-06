import { iteratePdfPagesToPng } from "../../backend/src/consumer/pdfPageRenderer";

const path = process.argv[2];

if (!path) throw new Error("Usage: bun backend-go/benchmarks/profile-pdf.ts <fixture.pdf>");

const bytes = await Bun.file(path).arrayBuffer();

const totals = { load: 0, raster: 0, encode: 0 };

let outputBytes = 0;

const start = performance.now();

// Exclude the first document's imports, fonts and rasterizer initialization.
for (let document = 0; document < 31; document++) {
  for await (const png of iteratePdfPagesToPng(bytes.slice(0), undefined, undefined, undefined, {
    fastPng: process.env.FAST_PNG === "1",
    observe: (sample) => { if (document) totals[sample.phase] += sample.elapsedMs; },
  })) {
    if (document) outputBytes += png.byteLength;
  }
}

console.log(JSON.stringify({ source: path, documents: 30, totals, outputBytes, elapsedMs: performance.now() - start }));
