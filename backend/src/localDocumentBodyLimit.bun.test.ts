import { describe, expect, it } from "bun:test";

import { HttpError } from "./lib/http";
import {
  LOCAL_MULTIPART_ENVELOPE_ALLOWANCE_BYTES,
  assertKnownDocumentRequestBodyLength,
  localDocumentRequestBodyLimit,
  localDocumentServerBodyLimit,
} from "./localDocumentBodyLimit";

describe("Document transport body limits", () => {
  it("derives logical and Bun server limits from Source bytes plus the multipart envelope", () => {
    expect(localDocumentRequestBodyLimit(10 * 1024 * 1024)).toBe(
      10 * 1024 * 1024 + LOCAL_MULTIPART_ENVELOPE_ALLOWANCE_BYTES,
    );
    expect(localDocumentServerBodyLimit(10 * 1024 * 1024)).toBe(
      10 * 1024 * 1024 + 2 * LOCAL_MULTIPART_ENVELOPE_ALLOWANCE_BYTES,
    );
  });

  it("allows known lengths below and at the logical boundary and rejects one byte above", () => {
    const maximumSourceBytes = 100;
    const limit = localDocumentRequestBodyLimit(maximumSourceBytes);

    expect(() => assertKnownDocumentRequestBodyLength(
      requestWithContentLength(limit - 1),
      maximumSourceBytes,
    )).not.toThrow();
    expect(() => assertKnownDocumentRequestBodyLength(
      requestWithContentLength(limit),
      maximumSourceBytes,
    )).not.toThrow();

    let failure: unknown;
    try {
      assertKnownDocumentRequestBodyLength(requestWithContentLength(limit + 1), maximumSourceBytes);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(HttpError);
    expect(failure).toMatchObject({ status: 400, code: "source_file_too_large" });
    expect((failure as Error).message).toContain(String(limit));
  });

  it("rejects a malformed known body length without treating an unknown-length stream as malformed", () => {
    expect(() => assertKnownDocumentRequestBodyLength(
      requestWithContentLength("12x"),
      100,
    )).toThrow(expect.objectContaining({ status: 400, code: "invalid_multipart" }));
    expect(() => assertKnownDocumentRequestBodyLength(
      new Request("http://127.0.0.1/v1/extract", { method: "POST" }),
      100,
    )).not.toThrow();
  });

  it("fits a maximum-shaped browser FormData envelope inside the derived allowance", async () => {
    const form = new FormData();
    form.set("template_id", "t".repeat(8 * 1024));
    form.set("options", "o".repeat(8 * 1024));
    form.set("fields", "f".repeat(8 * 1024));
    form.set(
      "document",
      new File([new Uint8Array([1])], `${"d".repeat(250)}.pdf`, { type: "application/pdf" }),
    );
    const request = new Request("http://127.0.0.1/v1/extract", { method: "POST", body: form });
    const measuredEnvelopeBytes = (await request.arrayBuffer()).byteLength - 1;

    expect(measuredEnvelopeBytes).toBeGreaterThan(3 * 8 * 1024);
    expect(measuredEnvelopeBytes).toBeLessThanOrEqual(LOCAL_MULTIPART_ENVELOPE_ALLOWANCE_BYTES);
  });
});

function requestWithContentLength(contentLength: number | string): Request {
  return new Request("http://127.0.0.1/v1/extract", {
    method: "POST",
    headers: { "content-length": String(contentLength) },
  });
}
