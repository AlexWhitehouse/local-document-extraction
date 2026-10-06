import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createPdfFrameReader } from "../../backend/src/lib/pdfProcessPool";

const path = process.argv[2];

if (!path) throw new Error("Usage: bun backend-go/benchmarks/profile-pdf.ts <fixture.pdf>");

const worker = process.env.GO_PDF_WORKER_BINARY ?? fileURLToPath(new URL("../bin/document-extraction-pdf", import.meta.url));

const child = Bun.spawn([worker, "render"], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });

const reader = createPdfFrameReader(child.stdout);

const totals = { load: 0, raster: 0, encode: 0, pages: 0 };

let outputBytes = 0;

const started = performance.now();

// The first document's library and font initialization is excluded.
for (let document = 0; document < 31; document++) {
  const metadata = Buffer.from(JSON.stringify({ operation: "render", source_path: resolve(path) }));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(metadata.length);
  child.stdin.write(header);
  child.stdin.write(metadata);
  child.stdin.write(Buffer.alloc(4));
  await child.stdin.flush();

  for (;;) {
    const frame = new DataView((await reader.read(4))!.buffer).getInt32(0);

    if (frame === -30) {
      const size = new DataView((await reader.read(4))!.buffer).getUint32(0);
      const metrics = JSON.parse(new TextDecoder().decode((await reader.read(size))!));

      if (document) {
        totals.load += metrics.Load;
        totals.raster += metrics.Raster;
        totals.encode += metrics.Encode;
        totals.pages += metrics.Pages;
      }
    } else if (frame < 0) throw new Error(`Render failed (${frame})`);
    else if (frame === 0) {
      await reader.read(1);
      break;
    } else {
      const artifact = await reader.read(frame);

      if (document) outputBytes += artifact!.byteLength;
    }
  }
}

child.stdin.end();

await child.exited;

// One uncontended worker: phase time approximates CPU time, though encoding overlaps the next raster.
const phaseSeconds = (totals.load + totals.raster + totals.encode) / 1000;

console.log(JSON.stringify({ source: path, documents: 30, totals, outputBytes, pagesPerPhaseSecond: totals.pages / phaseSeconds, elapsedMs: performance.now() - started }));
