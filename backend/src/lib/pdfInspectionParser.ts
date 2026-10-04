import { createRequire } from "node:module";
import type { PDFDict, PDFDocument, PDFRawStream } from "pdf-lib";
import { PDF_INSPECTION_LIMITS as limits } from "./pdfInspectionLimits";

export class PdfInspectionLimitError extends Error {}

export class PdfInspectionConfigurationError extends Error {}

let restorePreviousGuards = () => {};

/**
 * Private pdf-lib adapter. Only import in an isolated child: its prototype guards
 * and pdf-lib's intern pools must never modify or retain data in the API process.
 * Fail closed on a dependency change until these allocation seams are requalified.
 */
export async function inspectPdfPages(bytes: Uint8Array): Promise<number> {
  return (await loadInspectedPdf(bytes)).pages;
}

/** Retain a guarded document only inside its isolated subprocess. */
export async function loadInspectedPdf(
  bytes: Uint8Array,
): Promise<{ document: PDFDocument; pages: number; checkLimits: () => void }> {
  // Inspectors process one document at a time. Never wrap a previous document's
  // guards: its budgets and deadline must not leak into the next request.
  restorePreviousGuards();
  const require = createRequire(import.meta.url);

  if (require("pdf-lib/package.json").version !== "1.17.1") throw new PdfInspectionConfigurationError();
  // SAFETY: The exact installed version was checked above; the CJS entry point implements that package’s public exports.
  const library = require("pdf-lib/cjs/index.js") as typeof import("pdf-lib");
  const DecodeStream = require("pdf-lib/cjs/core/streams/DecodeStream.js").default;
  const ByteStream = require("pdf-lib/cjs/core/parser/ByteStream.js").default;
  const ObjectParser = require("pdf-lib/cjs/core/parser/PDFObjectParser.js").default;
  const BaseParser = require("pdf-lib/cjs/core/parser/BaseParser.js").default;
  const ObjectStreamParser = require("pdf-lib/cjs/core/parser/PDFObjectStreamParser.js").default;
  const XRefStreamParser = require("pdf-lib/cjs/core/parser/PDFXRefStreamParser.js").default;

  const guardedMethods = [
    [DecodeStream.prototype, "ensureBuffer"],
    [ByteStream.prototype, "next"],
    [ByteStream.prototype, "slice"],
    [ObjectParser.prototype, "parseObject"],
    [ObjectParser.prototype, "parseString"],
    [ObjectParser.prototype, "parseHexString"],
    [ObjectParser.prototype, "parseName"],
    [ObjectStreamParser, "forStream"],
    [XRefStreamParser, "forStream"],
    [BaseParser.prototype, "parseRawInt"],
    [BaseParser.prototype, "parseRawNumber"],
  ] as const;

  for (const [target, method] of guardedMethods) {
    if (!isCallable(target?.[method])) throw new PdfInspectionConfigurationError();
  }

  const originals = guardedMethods.map(([target, method]) => [target, method, target[method]] as const);
  restorePreviousGuards = () => {
    for (const [target, method, original] of originals) target[method] = original;
  };

  let breached = false;
  let allocated = 0;
  let copied = 0;
  let scanned = 0;
  let tokenBytes = 0;
  let objects = 0;
  let nesting = 0;
  let streamEntries = 0;
  const deadline = performance.now() + limits.wallTimeMs;

  const fail = (): never => {
    breached = true;
    throw new PdfInspectionLimitError();
  };

  const check = () => {
    if (breached || performance.now() > deadline) fail();
  };

  if (bytes.byteLength > limits.sourceBytes) fail();

  // Charge every allocation, including previous buffers awaiting GC and each
  // stage of a filter chain. Checking requested bytes alone misses rounded growth.
  DecodeStream.prototype.ensureBuffer = function (requested: number) {
    check();

    if (!Number.isSafeInteger(requested) || requested < 0 || requested > limits.decodedStreamBytes) fail();

    if (requested <= this.buffer.byteLength) return this.buffer;
    let size = this.minBufferLength;

    if (!Number.isSafeInteger(size) || size < 1 || size > limits.decodedStreamBytes) fail();

    while (size < requested) size *= 2;

    if (size > limits.decodedStreamBytes || allocated + size > limits.decodedAllocations) fail();
    allocated += size;
    const next = new Uint8Array(size);
    next.set(this.buffer);
    this.buffer = next;

    return next;
  };

  const nextByte = ByteStream.prototype.next;
  const tokenStarts = new WeakMap<object, number>();
  ByteStream.prototype.next = function () {
    if (++scanned > limits.scannedBytes) fail();
    const tokenStart = tokenStarts.get(this);

    if (tokenStart !== undefined) {
      if (this.offset() - tokenStart >= limits.tokenBytes || ++tokenBytes > limits.totalTokenBytes) fail();
    }

    if ((scanned & 4095) === 0) check();

    return nextByte.call(this);
  };

  const slice = ByteStream.prototype.slice;
  ByteStream.prototype.slice = function (start: number, end: number) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > this.length)
      throw new Error("Invalid PDF stream range");
    copied += end - start;

    if (copied > limits.copiedBytes) fail();

    return slice.call(this, start, end);
  };

  const parseObject = ObjectParser.prototype.parseObject;
  ObjectParser.prototype.parseObject = function () {
    check();

    if (++objects > limits.objects || ++nesting > limits.nesting) fail();

    try {
      return parseObject.call(this);
    } finally {
      nesting -= 1;
    }
  };

  for (const [prototype, name] of [
    [ObjectParser.prototype, "parseString"],
    [ObjectParser.prototype, "parseHexString"],
    [ObjectParser.prototype, "parseName"],
    [BaseParser.prototype, "parseRawInt"],
    [BaseParser.prototype, "parseRawNumber"],
  ] as const) {
    const parse = prototype[name];
    prototype[name] = function () {
      if (++objects > limits.objects) fail();
      tokenStarts.set(this.bytes, this.bytes.offset());

      try {
        return parse.call(this);
      } finally {
        tokenStarts.delete(this.bytes);
      }
    };
  }

  const number = (dict: PDFDict, key: string, maximum: number) => {
    const value = dict.lookup(library.PDFName.of(key), library.PDFNumber).asNumber();

    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid PDF stream size");

    if (value > maximum) fail();

    return value;
  };

  const objectStream = ObjectStreamParser.forStream;

  const guardFilters = (stream: PDFRawStream) => {
    const filter = stream.dict.lookup(library.PDFName.of("Filter"));
    const count = filter instanceof library.PDFArray ? filter.size() : filter ? 1 : 0;

    if (count > 8) fail();

    // LZW allocates its dictionary in the constructor, before ensureBuffer.
    // Account conservatively for fixed decoder state as well as output buffers.
    if ((allocated += count * 64 * 1024) > limits.decodedAllocations) fail();
  };

  ObjectStreamParser.forStream = (stream: PDFRawStream, wait: () => boolean) => {
    check();
    guardFilters(stream);

    if ((streamEntries += number(stream.dict, "N", limits.streamEntries)) > limits.streamEntries) fail();
    number(stream.dict, "First", limits.decodedStreamBytes);

    return objectStream(stream, wait);
  };

  const xrefStream = XRefStreamParser.forStream;
  XRefStreamParser.forStream = (stream: PDFRawStream) => {
    check();
    guardFilters(stream);
    const size = number(stream.dict, "Size", limits.streamEntries);
    const index = stream.dict.lookup(library.PDFName.of("Index"));
    let entries = size;

    if (index !== undefined) {
      if (!(index instanceof library.PDFArray) || index.size() % 2)
        throw new Error("Invalid PDF cross-reference index");
      entries = 0;

      for (let i = 0; i < index.size(); i += 2) {
        const start = index.lookup(i, library.PDFNumber).asNumber();
        const count = index.lookup(i + 1, library.PDFNumber).asNumber();

        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(count) ||
          start < 0 ||
          count < 0 ||
          start + count > size
        )
          throw new Error("Invalid PDF cross-reference range");

        if ((entries += count) > limits.streamEntries) fail();
      }
    }

    if ((streamEntries += entries) > limits.streamEntries) fail();
    const widths = stream.dict.lookup(library.PDFName.of("W"), library.PDFArray);

    if (widths.size() !== 3) throw new Error("Invalid PDF cross-reference widths");

    for (let i = 0; i < 3; i++) {
      const width = widths.lookup(i, library.PDFNumber).asNumber();

      if (!Number.isSafeInteger(width) || width < 0) throw new Error("Invalid PDF cross-reference width");

      if (width > 8) fail();
    }

    return xrefStream(stream);
  };

  try {
    const pdf = await library.PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
    check();
    // Count iteratively: getPageCount traverses recursively and trusts page-tree
    // links. Reject repeated nodes/cycles rather than recursing or double-counting.
    const pending: PDFDict[] = [pdf.catalog.Pages()];
    const visited = new Set<PDFDict>();
    let pages = 0;

    while (pending.length) {
      check();
      const node = pending.pop()!;

      if (visited.has(node)) throw new Error("Invalid PDF page tree");
      visited.add(node);

      if (visited.size > limits.streamEntries) fail();
      const type = node.lookup(library.PDFName.of("Type"));

      if (type === library.PDFName.of("Page")) {
        if (++pages > limits.pages) fail();
      } else if (type === library.PDFName.of("Pages")) {
        const children = node.lookup(library.PDFName.of("Kids"), library.PDFArray);

        if (pending.length + children.size() > limits.streamEntries) fail();

        for (let i = 0; i < children.size(); i++) pending.push(children.lookup(i, library.PDFDict));
      } else throw new Error("Invalid PDF page tree node");
    }

    if (!pages) throw new Error("PDF has no pages");

    return { document: pdf, pages, checkLimits: check };
  } catch (error) {
    // A dependency recovery path must never turn a breached budget into success
    // or reclassify it as a harmless malformed object.
    if (breached) throw new PdfInspectionLimitError();
    throw error;
  }
}

function isCallable(value: unknown): value is (...args: never[]) => void {
  return typeof value === "function";
}
