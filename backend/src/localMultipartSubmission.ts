import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";

import {
  LOCAL_MULTIPART_FIELD_BYTES,
  LOCAL_MULTIPART_MAX_FIELDS,
  localDocumentRequestBodyLimit,
} from "./localDocumentBodyLimit";
import { HttpError } from "./lib/http";
import { validateExtractSubmissionMetadata } from "./lib/validation";

export type LocalStreamedExtractRequest = {
  templateId: string;
  source: {
    mimeType: string;
    name: string;
    size: number;
    temporaryPath: string;
  };
};

export async function parseLocalMultipartSubmission({
  maxSourceFileBytes,
  request,
  stateDirectory,
}: {
  maxSourceFileBytes: number;
  request: Request;
  stateDirectory: string;
}): Promise<LocalStreamedExtractRequest> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new HttpError(415, "unsupported_media_type", "Use multipart/form-data");
  }
  if (!request.body) throw new HttpError(400, "invalid_document", "document is required");

  const temporaryDirectory = resolve(stateDirectory, "temporary", "submissions");
  await mkdir(temporaryDirectory, { recursive: true });
  const temporaryPath = join(temporaryDirectory, `${randomUUID()}.upload`);
  const fields = new Map<string, string>();
  let document: { mimeType: string; name: string; size: number } | null = null;
  let documentWrite: Promise<void> | null = null;
  let failure: unknown = null;

  const fail = (error: unknown) => {
    failure ??= error;
  };

  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: Object.fromEntries(request.headers.entries()),
      highWaterMark: 64 * 1024,
      fileHwm: 64 * 1024,
      limits: {
        fieldNameSize: 64,
        fieldSize: LOCAL_MULTIPART_FIELD_BYTES,
        fields: LOCAL_MULTIPART_MAX_FIELDS,
        // Busboy emits `limit` when this value is reached. Use one sentinel
        // byte so a Source exactly at the documented maximum remains valid.
        fileSize: Math.min(Number.MAX_SAFE_INTEGER, maxSourceFileBytes + 1),
        files: 1,
        headerPairs: 32,
        parts: 4,
      },
    });
  } catch (error) {
    throw new HttpError(400, "invalid_multipart", error instanceof Error ? error.message : "Invalid multipart request");
  }

  parser.on("file", (name, stream, info) => {
    if (name !== "document" || document || documentWrite) {
      fail(new HttpError(400, "invalid_document", "Exactly one document file is required"));
      stream.resume();
      return;
    }
    document = { mimeType: info.mimeType, name: info.filename, size: 0 };
    stream.on("data", (chunk: Buffer) => {
      document!.size += chunk.byteLength;
    });
    stream.once("limit", () => {
      fail(new HttpError(
        400,
        "source_file_too_large",
        `Source file exceeds max size of ${maxSourceFileBytes} bytes`,
      ));
    });
    documentWrite = pipeline(
      stream,
      createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
    ).catch((error) => {
      fail(error);
    });
  });
  parser.on("field", (name, value, info) => {
    if (info.nameTruncated || info.valueTruncated) {
      fail(new HttpError(400, "invalid_multipart", "Multipart field limit exceeded"));
      return;
    }
    if (fields.has(name)) {
      fail(new HttpError(400, "invalid_multipart", `Duplicate multipart field: ${name}`));
      return;
    }
    if (!["fields", "options", "template_id"].includes(name)) {
      fail(new HttpError(400, "invalid_multipart", `Unsupported multipart field: ${name}`));
      return;
    }
    fields.set(name, value);
  });
  parser.once("filesLimit", () => fail(new HttpError(400, "invalid_document", "Exactly one document file is required")));
  parser.once("fieldsLimit", () => fail(new HttpError(400, "invalid_multipart", "Too many multipart fields")));
  parser.once("partsLimit", () => fail(new HttpError(400, "invalid_multipart", "Too many multipart parts")));

  const totalLimitBytes = localDocumentRequestBodyLimit(maxSourceFileBytes);
  let totalBytes = 0;
  const requestLimit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      totalBytes += chunk.byteLength;
      if (totalBytes > totalLimitBytes) {
        const error = new HttpError(400, "source_file_too_large", `Request exceeds max size of ${totalLimitBytes} bytes`);
        fail(error);
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  });
  const body = Readable.fromWeb(request.body as never);
  const aborted = () => {
    const error = new HttpError(400, "submission_aborted", "Document submission was aborted");
    fail(error);
    body.destroy(error);
    requestLimit.destroy(error);
    parser.destroy(error);
  };
  request.signal.addEventListener("abort", aborted, { once: true });

  try {
    await pipeline(body, requestLimit, parser).catch((error) => fail(error));
    await documentWrite;
    if (failure) throw failure;
    const parsedDocument = document as { mimeType: string; name: string; size: number } | null;
    if (!parsedDocument || !documentWrite) {
      throw new HttpError(400, "invalid_document", "document is required");
    }
    const { templateId } = validateExtractSubmissionMetadata({
      hasInlineFields: fields.has("fields"),
      maxSourceFileBytes,
      optionsRaw: fields.get("options") ?? null,
      sourceMimeType: parsedDocument.mimeType,
      sourceSize: parsedDocument.size,
      templateIdRaw: fields.get("template_id") ?? null,
    });
    return { templateId, source: { ...parsedDocument, temporaryPath } };
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_multipart", error instanceof Error ? error.message : "Invalid multipart request");
  } finally {
    request.signal.removeEventListener("abort", aborted);
  }
}
