/** Offline renderer experiment. No application renderer or model quality setting changes. */
import { JBIG2_PDF_BASE64 } from "../fixtures/jbig2SymbolOffset";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { iteratePdfPagesToPng } from "../src/consumer/pdfPageRenderer";

const directory = resolve(process.argv[2] ?? ".scratch/renderer-comparison");

await mkdir(directory, { recursive: true });

const names = ["text-color", "scan", "crop-rotate", "form", "transparency", "large-page", "jbig2"];

for (const name of names) {
  if (name === "jbig2") {
    await writeFile(join(directory, `${name}.pdf`), Buffer.from(JBIG2_PDF_BASE64, "base64"));
    continue;
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage(name === "large-page" ? [1500, 1200] : [595, 842]);
  page.drawText("Invoice 10027 / total $1,234.50", { font, x: 40, y: 650, size: 18 });
  page.drawText("Small print: 0123456789 ABC xyz", { font, x: 40, y: 620, size: 6 });

  if (name === "text-color") for (let row = 0; row < 30; row++) {
    page.drawText(`Item ${row + 1}: quantity 12, amount 42.75`, { font, x: 40, y: 590 - row * 16, size: 10 });
    page.drawLine({ start: { x: 40, y: 588 - row * 16 }, end: { x: 550, y: 588 - row * 16 }, thickness: 0.4, color: rgb(0.1, 0.3, 0.6) });
  }

  if (name === "scan") {
    const canvas = createCanvas(1190, 1684);
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#222";
    context.font = "24px sans-serif";

    for (let line = 0; line < 45; line++) context.fillText(`Scanned invoice row ${line}: amount 123.45`, 60, 60 + line * 32);
    const image = await pdf.embedPng(await canvas.encode("png"));
    page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
    page.drawText("Visible overlaid approval", { font, x: 70, y: 50, size: 14, color: rgb(0.8, 0, 0) });
  }

  if (name === "crop-rotate") { page.setCropBox(20, 30, 400, 650); page.setRotation(degrees(90)); }

  if (name === "form") {
    const form = pdf.getForm();
    const field = form.createTextField("account");
    field.setText("ACCT-007");
    field.addToPage(page, { x: 40, y: 550, width: 200, height: 30 });
    const box = form.createCheckBox("approved");
    box.addToPage(page, { x: 40, y: 500, width: 20, height: 20 });
    box.check();
    form.updateFieldAppearances(font);
  }

  if (name === "transparency") {
    page.drawRectangle({ x: 20, y: 600, width: 400, height: 100, color: rgb(0, 0, 1), opacity: 0.2 });
    page.drawCircle({ x: 220, y: 620, size: 65, color: rgb(1, 0, 0), opacity: 0.4 });
  }

  await writeFile(join(directory, `${name}.pdf`), await pdf.save());
}

const decode = async (path: string) => {
  const image = await loadImage(path);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);

  return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
};

const results = [];

for (const name of names) {
  const source = join(directory, `${name}.pdf`);
  const bytes = await Bun.file(source).arrayBuffer();
  const times: Record<"pdfjs" | "mupdf" | "poppler", number[]> = { pdfjs: [], mupdf: [], poppler: [] };
  let dimensions = { width: 0, height: 0 };

  for (let repeat = 0; repeat < 4; repeat++) {
    let started = performance.now();

    for await (const page of iteratePdfPagesToPng(bytes.slice(0), undefined, undefined, undefined, { fastPng: true, overlapEncoding: true })) await writeFile(join(directory, `${name}-pdfjs.png`), new Uint8Array(page));
    times.pdfjs!.push(performance.now() - started);
    const reference = await decode(join(directory, `${name}-pdfjs.png`));
    dimensions = { width: reference.width, height: reference.height };

    for (const engine of ["mupdf", "poppler"] as const) {
      const output = join(directory, `${name}-${engine}`);

      const command = engine === "mupdf"
        ? ["mutool", "draw", "-q", "-r", "144", "-w", "2048", "-h", "2048", "-o", `${output}.png`, source, "1"]
        : ["pdftoppm", "-f", "1", "-l", "1", "-singlefile", "-cropbox", "-scale-to-x", String(name === "crop-rotate" ? reference.height : reference.width), "-scale-to-y", String(name === "crop-rotate" ? reference.width : reference.height), "-png", source, output];

      started = performance.now();
      const child = Bun.spawn(command, { stdout: "ignore", stderr: "pipe" });
      const error = await new Response(child.stderr).text();

      if (await child.exited !== 0) throw new Error(error);
      times[engine]!.push(performance.now() - started);
    }
  }

  const reference = await decode(join(directory, `${name}-pdfjs.png`));
  const comparisons = [];

  for (const engine of ["mupdf", "poppler"] as const) {
    const actual = await decode(join(directory, `${name}-${engine}.png`));
    let differentPixels = 0;
    let squaredError = 0;
    const sameDimensions = actual.width === reference.width && actual.height === reference.height;

    if (sameDimensions) for (let offset = 0; offset < reference.pixels.length; offset += 4) {
      let different = false;

      for (let channel = 0; channel < 4; channel++) {
        const difference = actual.pixels[offset + channel]! - reference.pixels[offset + channel]!;
        squaredError += difference * difference;
        different ||= difference !== 0;
      }

      if (different) differentPixels++;
    }

    comparisons.push({ engine, sameDimensions, width: actual.width, height: actual.height, differentPixels: sameDimensions ? differentPixels : null, rmse: sameDimensions ? Math.sqrt(squaredError / reference.pixels.length) : null });
  }

  results.push({ name, ...dimensions, milliseconds: times, comparisons });
}

const versions: Record<string, string> = {};

for (const [name, command] of [["mupdf", ["mutool", "-v"]], ["poppler", ["pdftoppm", "-v"]]] as const) {
  const process = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
  versions[name] = (await new Response(process.stdout).text() + await new Response(process.stderr).text()).trim();
  await process.exited;
}

console.log(JSON.stringify({ results, versions, files: (await readdir(directory)).length }, null, 2));
