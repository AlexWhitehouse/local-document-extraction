import { PDFDocument } from "pdf-lib";
import { describe, expect, it, spyOn } from "bun:test";
import { deflateSync } from "node:zlib";

import { countPdfSourceFilePages, createPdfSourceFilePageCounter } from "./sourceFilePageCount";
import { pdfWithCompressedObjectStreams } from "../testing/pdfSourceFixtures";

describe("Source file page count", () => {
  it("rejects small PDFs whose compressed metadata exceeds the decoded byte limit", async () => {
    const bytes = pdfWithCompressedObjectStreams([32 * 1024 * 1024]);
    expect(bytes.length).toBeLessThan(40 * 1024);
    await expect(countPdfSourceFilePages(bytes)).rejects.toMatchObject({ code: "pdf_source_file_limit_exceeded" });
  });

  it("budgets allocations across multiple otherwise acceptable compressed streams", async () => {
    const small = pdfWithCompressedObjectStreams([8 * 1024 * 1024]);
    await expect(countPdfSourceFilePages(small)).resolves.toBe(1);
    const aggregate = pdfWithCompressedObjectStreams([8 * 1024 * 1024, 8 * 1024 * 1024, 8 * 1024 * 1024]);
    await expect(countPdfSourceFilePages(aggregate)).rejects.toMatchObject({ code: "pdf_source_file_limit_exceeded" });
  });

  it("bounds intermediate decoder allocations in chained filters", async () => {
    const content = Buffer.alloc(32 * 1024 * 1024, 32);
    content.write("100 0 << /Synthetic true >>");
    const encoded = Buffer.from(deflateSync(content).toString("hex") + ">");

    const source = metadataPdf([
      streamObject(4, "/Type /ObjStm /N 1 /First 6 /Filter [/ASCIIHexDecode /FlateDecode]", encoded),
    ]);

    await expect(countPdfSourceFilePages(source)).rejects.toMatchObject({ code: "pdf_source_file_limit_exceeded" });
  });

  it.each([
    ["object stream entry count", "/Type /ObjStm /N 100000000 /First 0"],
    ["xref entry count with zero-width fields", "/Type /XRef /Size 100000000 /W [0 0 0]"],
    ["xref field width", "/Type /XRef /Size 1 /W [100000000 0 0]"],
    ["eager LZW decoder chains", `/Type /ObjStm /N 0 /First 0 /Filter [${"/LZWDecode ".repeat(9)}]`],
  ])("bounds %s before allocating or looping", async (_name, dictionary) => {
    const source = metadataPdf([streamObject(4, dictionary, new Uint8Array())]);
    await expect(countPdfSourceFilePages(source)).rejects.toMatchObject({ code: "pdf_source_file_limit_exceeded" });
  });

  it("counts xref entries across all streams, including ones with no decoded bytes", async () => {
    const source = metadataPdf(
      [4, 5].map((id) => streamObject(id, "/Type /XRef /Root 1 0 R /Size 30000 /W [0 0 0]", new Uint8Array())),
    );

    await expect(countPdfSourceFilePages(source)).rejects.toMatchObject({ code: "pdf_source_file_limit_exceeded" });
  });

  it.each([
    ["nested arrays", `${"[".repeat(100)}0${"]".repeat(100)}`],
    ["large string tokens", `(${"a".repeat(256 * 1024 + 1)})`],
    ["large numeric tokens", "0".repeat(256 * 1024 + 1)],
  ])("bounds %s", async (_name, object) => {
    await expect(
      countPdfSourceFilePages(metadataPdf([Buffer.from(`4 0 obj\n${object}\nendobj\n`)])),
    ).rejects.toMatchObject({ code: "pdf_source_file_limit_exceeded" });
  });

  it("budgets reparsing the same string through repeated object-stream offsets", async () => {
    const count = 80;
    const offsets = Array.from({ length: count }, (_, index) => `${100 + index} 0 `).join("");
    const contents = Buffer.from(offsets + `(${"a".repeat(128 * 1024)})`);

    const source = metadataPdf([
      streamObject(4, `/Type /ObjStm /N ${count} /First ${offsets.length} /Filter /FlateDecode`, deflateSync(contents)),
    ]);

    await expect(countPdfSourceFilePages(source)).rejects.toMatchObject({ code: "pdf_source_file_limit_exceeded" });
  });

  it("budgets raw stream copies made through repeated object-stream offsets", async () => {
    const count = 70;
    const offsets = Array.from({ length: count }, (_, index) => `${100 + index} 0 `).join("");

    const contents = Buffer.from(
      offsets + `<< /Length ${1024 * 1024} >>\nstream\n${"a".repeat(1024 * 1024)}\nendstream`,
    );

    const source = metadataPdf([
      streamObject(4, `/Type /ObjStm /N ${count} /First ${offsets.length} /Filter /FlateDecode`, deflateSync(contents)),
    ]);

    await expect(countPdfSourceFilePages(source)).rejects.toMatchObject({ code: "pdf_source_file_limit_exceeded" });
  });

  it("rejects cyclic page trees without recursive traversal", async () => {
    const source = metadataPdf([Buffer.from("2 0 obj\n<< /Type /Pages /Kids [2 0 R] /Count 1 >>\nendobj\n")]);
    await expect(countPdfSourceFilePages(source)).rejects.toMatchObject({ code: "invalid_pdf_source_file" });
  });
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

  it("supports ordinary PDFs without compressed object streams", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    await expect(countPdfSourceFilePages(await pdf.save({ useObjectStreams: false }))).resolves.toBe(1);
  });

  it("rejects malformed PDF bytes with a stable invalid-PDF failure", async () => {
    const bytes = new TextEncoder().encode("not a pdf");

    await expect(countPdfSourceFilePages(bytes)).rejects.toMatchObject({
      code: "invalid_pdf_source_file",
      message: "PDF Source file could not be read",
    });
  });
});

describe("PDF inspection process lifecycle", () => {
  it("reuses inspectors with fresh document budgets and retires them after bounded use", async () => {
    const counter = createPdfSourceFilePageCounter({ maxConcurrent: 1 });

    try {
      const first = metadataPdf([]);
      const pdf = await PDFDocument.create();
      pdf.addPage();
      pdf.addPage();
      const second = await pdf.save();

      for (let index = 0; index < 33; index++) {
        expect(await counter.count(index % 2 ? second : first)).toBe(index % 2 ? 2 : 1);
      }

      expect(counter.diagnostics().spawned).toBe(2);
      await expect(counter.count(pdfWithCompressedObjectStreams([32 * 1024 * 1024]))).rejects.toMatchObject({
        code: "pdf_source_file_limit_exceeded",
      });
      await expect(counter.count(first)).resolves.toBe(1);
      expect(counter.diagnostics().spawned).toBe(3);
    } finally {
      await counter.close();
    }

    expect(counter.diagnostics()).toMatchObject({ active: 0, queued: 0, reservedBytes: 0, idle: 0 });
    await expect(counter.count(metadataPdf([]))).rejects.toMatchObject({ code: "pdf_validation_capacity_unavailable" });
  });
  it("keeps the caller responsive while rejecting compressed expansion", async () => {
    const source = pdfWithCompressedObjectStreams([32 * 1024 * 1024]);
    const events: string[] = [];

    const parsing = countPdfSourceFilePages(source).catch(() => {
      events.push("parsed");
    });

    await new Promise<void>((resolve) =>
      setTimeout(() => {
        events.push("timer");
        resolve();
      }, 0),
    );
    await parsing;
    expect(events).toEqual(["timer", "parsed"]);
  });

  it("kills timed-out processes and returns their reservations", async () => {
    const counter = createPdfSourceFilePageCounter({ timeoutMs: 1 });
    await expect(counter.count(metadataPdf([]))).rejects.toMatchObject({ code: "pdf_source_file_limit_exceeded" });
    expect(counter.snapshot()).toEqual({ active: 0, queued: 0, reservedBytes: 0 });
    await expect(countPdfSourceFilePages(metadataPdf([]))).resolves.toBe(1);
  });

  it("cancels running processes before releasing their permits", async () => {
    const counter = createPdfSourceFilePageCounter();
    const controller = new AbortController();
    const parsing = counter.count(pdfWithCompressedObjectStreams([32 * 1024 * 1024]), controller.signal);
    const timer = setTimeout(() => controller.abort(), 0);

    try {
      await expect(parsing).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      clearTimeout(timer);
    }

    expect(counter.snapshot()).toEqual({ active: 0, queued: 0, reservedBytes: 0 });
    await expect(counter.count(metadataPdf([]))).resolves.toBe(1);
  });

  it("bounds queued requests and removes cancelled waiters", async () => {
    const counter = createPdfSourceFilePageCounter({ maxConcurrent: 1, maxQueued: 1 });
    const controller = new AbortController();
    const running = counter.count(metadataPdf([]));
    const queued = counter.count(metadataPdf([]), controller.signal);
    expect(counter.snapshot()).toMatchObject({ active: 1, queued: 1 });
    const overflow = counter.count(metadataPdf([])).catch((error) => error);
    const cancellation = queued.catch((error) => error);
    controller.abort();
    expect(await overflow).toMatchObject({ code: "pdf_validation_capacity_unavailable" });
    expect(await cancellation).toMatchObject({ name: "AbortError" });
    await expect(running).resolves.toBe(1);
    expect(counter.snapshot()).toEqual({ active: 0, queued: 0, reservedBytes: 0 });
    await expect(counter.count(metadataPdf([]))).resolves.toBe(1);
  });

  it("expires waiting requests as retryable capacity failures", async () => {
    const counter = createPdfSourceFilePageCounter({ maxConcurrent: 1, queueTimeoutMs: 1 });
    const running = counter.count(metadataPdf([]));
    await expect(counter.count(metadataPdf([]))).rejects.toMatchObject({ code: "pdf_validation_capacity_unavailable" });
    await expect(running).resolves.toBe(1);
    expect(counter.snapshot()).toEqual({ active: 0, queued: 0, reservedBytes: 0 });
  });

  it("bounds aggregate retained source bytes before copying or spawning", async () => {
    const counter = createPdfSourceFilePageCounter({ maxConcurrent: 1, maxQueued: 4 });
    const source = new Uint8Array(24 * 1024 * 1024);
    const controller = new AbortController();
    const active = counter.count(source, controller.signal).catch((error) => error);
    const queued = counter.count(source, controller.signal).catch((error) => error);
    const overflow = counter.count(source).catch((error) => error);
    controller.abort();
    expect(await overflow).toMatchObject({ code: "pdf_validation_capacity_unavailable" });
    expect(await active).toMatchObject({ name: "AbortError" });
    expect(await queued).toMatchObject({ name: "AbortError" });
    expect(counter.snapshot()).toEqual({ active: 0, queued: 0, reservedBytes: 0 });
    await expect(counter.count(new Uint8Array(32 * 1024 * 1024 + 1))).rejects.toMatchObject({
      code: "pdf_source_file_limit_exceeded",
    });
    expect(counter.snapshot()).toEqual({ active: 0, queued: 0, reservedBytes: 0 });
  });

  it("releases capacity and drains the queue after a spawn failure", async () => {
    const counter = createPdfSourceFilePageCounter({ maxConcurrent: 1 });

    const spawn = spyOn(Bun, "spawn").mockImplementationOnce(() => {
      throw new Error("private operating-system details");
    });

    try {
      const failed = counter.count(metadataPdf([])).catch((error) => error);
      const queued = counter.count(metadataPdf([]));
      expect(await failed).toMatchObject({
        code: "invalid_pdf_source_file",
        message: "PDF Source file could not be read",
      });
      await expect(queued).resolves.toBe(1);
      expect(counter.snapshot()).toEqual({ active: 0, queued: 0, reservedBytes: 0 });
    } finally {
      spawn.mockRestore();
    }
  });
});

function metadataPdf(objects: Uint8Array[]): Uint8Array {
  return Buffer.concat([
    Buffer.from(
      "%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>\nendobj\n",
    ),
    ...objects,
    Buffer.from("trailer\n<< /Root 1 0 R /Size 200 >>\n%%EOF\n"),
  ]);
}

function streamObject(id: number, dictionary: string, data: Uint8Array): Uint8Array {
  return Buffer.concat([
    Buffer.from(`${id} 0 obj\n<< ${dictionary} /Length ${data.length} >>\nstream\n`),
    data,
    Buffer.from("\nendstream\nendobj\n"),
  ]);
}

it("keeps a bounded inspector warm between short upload bursts", async () => {
  const counter = createPdfSourceFilePageCounter({ maxConcurrent: 1 });
  const document = await PDFDocument.create();
  document.addPage();
  const bytes = await document.save();

  try {
    expect(await counter.count(bytes)).toBe(1);
    await Bun.sleep(1_100);
    expect(await counter.count(bytes)).toBe(1);
    expect(counter.diagnostics().spawned).toBe(1);
  } finally {
    await counter.close();
  }
});
