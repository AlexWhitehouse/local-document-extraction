import { HttpError } from "./lib/http";

export const LOCAL_MULTIPART_MAX_FIELDS = 3;
export const LOCAL_MULTIPART_FIELD_BYTES = 8 * 1024;
export const LOCAL_MULTIPART_FRAMING_ALLOWANCE_BYTES = 8 * 1024;
export const LOCAL_MULTIPART_ENVELOPE_ALLOWANCE_BYTES =
  LOCAL_MULTIPART_MAX_FIELDS * LOCAL_MULTIPART_FIELD_BYTES
  + LOCAL_MULTIPART_FRAMING_ALLOWANCE_BYTES;

export function localDocumentRequestBodyLimit(maxSourceFileBytes: number): number {
  return maxSourceFileBytes + LOCAL_MULTIPART_ENVELOPE_ALLOWANCE_BYTES;
}

export function localDocumentServerBodyLimit(maxSourceFileBytes: number): number {
  // Leave one additional bounded envelope for the application to classify and
  // answer an oversized stream before Bun's emergency hard stop takes over.
  return localDocumentRequestBodyLimit(maxSourceFileBytes)
    + LOCAL_MULTIPART_ENVELOPE_ALLOWANCE_BYTES;
}

export function assertKnownDocumentRequestBodyLength(
  request: Request,
  maxSourceFileBytes: number,
): void {
  const rawContentLength = request.headers.get("content-length");
  if (rawContentLength === null) return;
  const normalized = rawContentLength.trim();
  if (!/^(0|[1-9]\d*)$/.test(normalized)) {
    throw new HttpError(400, "invalid_multipart", "Content-Length must be a non-negative integer");
  }
  const contentLength = Number(normalized);
  if (!Number.isSafeInteger(contentLength)) {
    throw new HttpError(400, "invalid_multipart", "Content-Length is outside the supported range");
  }
  const maximumRequestBytes = localDocumentRequestBodyLimit(maxSourceFileBytes);
  if (contentLength > maximumRequestBytes) {
    throw new HttpError(
      400,
      "source_file_too_large",
      `Request exceeds max size of ${maximumRequestBytes} bytes`,
    );
  }
}
