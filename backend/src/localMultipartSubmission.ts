import { readableFromWeb } from "./localWebStream";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";

import {
  LOCAL_MULTIPART_FIELD_BYTES,
  LOCAL_MULTIPART_MAX_FIELDS,
  localDocumentRequestBodyLimit,
} from "./localDocumentBodyLimit";
import { HttpError } from "./lib/http";
import { validateExtractSubmissionMetadata, validateSourceFileMetadata } from "./lib/validation";

/** Name, operation id and an Expected answer set of at most 1 MiB, within the Evaluation request overhead. */
export const LOCAL_EVALUATION_DOCUMENT_METADATA_BYTES = 1024 * 1024 + 4096;

type Purpose = "extraction" | "template-generation" | "template-assistance" | "evaluation" | "evaluation-document" | "mcp-upload";

const TEMPORARY_DIRECTORIES: Record<Purpose, string> = {
  "mcp-upload": "mcp-uploads",
  extraction: "submissions",
  "template-generation": "submissions",
  "template-assistance": "submissions",
  evaluation: "evaluations",
  "evaluation-document": "evaluation-documents",
};

const ALLOWED_FIELDS: Record<Purpose, string[]> = {
  "mcp-upload": [],
  extraction: ["fields", "options", "template_id", "template_tags", "pages"],
  "template-generation": ["instructions"],
  "template-assistance": ["payload"],
  evaluation: ["evaluation"],
  "evaluation-document": ["metadata"],
};

type LocalStreamedExtractRequest = {
  templateId: string | null;
  templateTags?: string[];
  pages?: number[] | null;
  instructions?: string;
  evaluation?: string;
  metadata?: string;
  payload?: string;
  source: {
    mimeType: string;
    name: string;
    size: number;
    temporaryPath: string;
  };
};

type SubmissionOptions = { maxSourceFileBytes: number; request: Request; stateDirectory: string };

export function parseLocalMultipartSubmission(
  options: SubmissionOptions & { purpose: "template-assistance" },
): Promise<Omit<LocalStreamedExtractRequest, "source"> & { source?: LocalStreamedExtractRequest["source"] }>;
export function parseLocalMultipartSubmission(
  options: SubmissionOptions & { purpose?: Exclude<Purpose, "template-assistance"> },
): Promise<LocalStreamedExtractRequest>;
export async function parseLocalMultipartSubmission({
  maxSourceFileBytes,
  request,
  stateDirectory,
  purpose = "extraction",
}: {
  maxSourceFileBytes: number;
  request: Request;
  stateDirectory: string;
  purpose?: Purpose;
}): Promise<Omit<LocalStreamedExtractRequest, "source"> & { source?: LocalStreamedExtractRequest["source"] }> {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new HttpError(415, "unsupported_media_type", "Use multipart/form-data");
  }

  if (!request.body) throw new HttpError(400, "invalid_document", "document is required");

  // A library save keeps its own upload apart from temporary Evaluation working files.
  const temporaryDirectory = resolve(stateDirectory, "temporary", TEMPORARY_DIRECTORIES[purpose]);

  const metadataBytes =
    purpose === "template-assistance"
      ? 80 * 1024
      : purpose === "evaluation"
        ? 1024 * 1024
        : purpose === "evaluation-document"
          ? LOCAL_EVALUATION_DOCUMENT_METADATA_BYTES
          : 0;

  await mkdir(temporaryDirectory, { recursive: true });
  const temporaryPath = join(temporaryDirectory, `${randomUUID()}.upload`);
  const fields = new Map<string, string>();

  type UploadState = {
    document: { mimeType: string; name: string; size: number } | null;
    failure: { cause: unknown } | null;
  };

  const state: UploadState = { document: null, failure: null };
  let documentWrite: Promise<void> | null = null;

  const fail = (cause: unknown) => {
    state.failure ??= { cause };
  };

  let parser: ReturnType<typeof Busboy>;

  try {
    parser = Busboy({
      headers: Object.fromEntries(request.headers.entries()),
      // Browsers send filenames as raw UTF-8; Busboy otherwise decodes them as Latin-1.
      defParamCharset: "utf8",
      highWaterMark: 64 * 1024,
      fileHwm: 64 * 1024,
      limits: {
        fieldNameSize: 64,
        fieldSize: metadataBytes || LOCAL_MULTIPART_FIELD_BYTES,
        fields: LOCAL_MULTIPART_MAX_FIELDS,
        // Busboy emits `limit` when this value is reached. Use one sentinel
        // byte so a Source exactly at the documented maximum remains valid.
        fileSize: Math.min(Number.MAX_SAFE_INTEGER, maxSourceFileBytes + 1),
        files: 1,
        headerPairs: 32,
        // Busboy emits partsLimit when the boundary is reached, including the
        // final allowed part: leave room above three fields and one document.
        parts: LOCAL_MULTIPART_MAX_FIELDS + 2,
      },
    });
  } catch (error) {
    throw new HttpError(400, "invalid_multipart", error instanceof Error ? error.message : "Invalid multipart request");
  }

  parser.on("file", (name, stream, info) => {
    if (name !== (purpose === "mcp-upload" ? "file" : "document") || state.document || documentWrite) {
      fail(new HttpError(400, "invalid_document", "Exactly one document file is required"));
      stream.resume();

      return;
    }

    state.document = { mimeType: info.mimeType, name: info.filename, size: 0 };
    stream.on("data", (chunk: Buffer) => {
      state.document!.size += chunk.byteLength;
    });
    stream.once("limit", () => {
      fail(new HttpError(400, "source_file_too_large", `Source file exceeds max size of ${maxSourceFileBytes} bytes`));
    });
    documentWrite = pipeline(stream, createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 })).catch((error) => {
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

    if (!ALLOWED_FIELDS[purpose].includes(name)) {
      fail(new HttpError(400, "invalid_multipart", `Unsupported multipart field: ${name}`));

      return;
    }

    fields.set(name, value);
  });
  parser.once("filesLimit", () =>
    fail(new HttpError(400, "invalid_document", "Exactly one document file is required")),
  );
  parser.once("fieldsLimit", () => fail(new HttpError(400, "invalid_multipart", "Too many multipart fields")));
  parser.once("partsLimit", () => fail(new HttpError(400, "invalid_multipart", "Too many multipart parts")));

  const totalLimitBytes = metadataBytes
    ? maxSourceFileBytes + metadataBytes + 8192
    : localDocumentRequestBodyLimit(maxSourceFileBytes);

  let totalBytes = 0;

  const requestLimit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      totalBytes += chunk.byteLength;

      if (totalBytes > totalLimitBytes) {
        const error = new HttpError(
          400,
          "source_file_too_large",
          `Request exceeds max size of ${totalLimitBytes} bytes`,
        );

        fail(error);
        callback(error);

        return;
      }

      callback(null, chunk);
    },
  });

  const body = readableFromWeb(request.body);

  const aborted = () => {
    const error = new HttpError(400, "submission_aborted", "Document submission was aborted");
    fail(error);
    body.destroy(error);
    requestLimit.destroy(error);
    parser.destroy(error);
  };

  request.signal.addEventListener("abort", aborted, { once: true });

  try {
    const parsing = pipeline(body, requestLimit, parser);

    // Directory initialization may have yielded while the request was aborted.
    // Install pipeline error handlers before destroying any of its streams.
    if (request.signal.aborted) aborted();
    await parsing.catch((error) => fail(error));
    await documentWrite;

    if (state.failure) throw state.failure.cause;
    const parsedDocument = state.document;

    if (purpose === "template-assistance") {
      if (!fields.get("payload"))
        throw new HttpError(400, "invalid_template_assistance", "The payload JSON field is required");

      if (parsedDocument) {
        validateSourceFileMetadata(parsedDocument.mimeType, parsedDocument.size, maxSourceFileBytes);

        if (!parsedDocument.size) throw new HttpError(400, "invalid_document", "The sample file is empty");
      }

      const parsed: Omit<LocalStreamedExtractRequest, "source"> & { source?: LocalStreamedExtractRequest["source"] } = {
        templateId: "",
        payload: fields.get("payload"),
      };

      if (parsedDocument) parsed.source = { ...parsedDocument, temporaryPath };

      return parsed;
    }

    if (!parsedDocument || !documentWrite) {
      throw new HttpError(400, "invalid_document", "document is required");
    }

    if (purpose === "mcp-upload") {
      validateSourceFileMetadata(parsedDocument.mimeType, parsedDocument.size, maxSourceFileBytes);

      if (!parsedDocument.size) throw new HttpError(400, "invalid_document", "The file is empty");

      return { templateId: null, source: { ...parsedDocument, temporaryPath } };
    }

    if (purpose === "evaluation") {
      validateSourceFileMetadata(parsedDocument.mimeType, parsedDocument.size, maxSourceFileBytes);

      if (!parsedDocument.size || !fields.get("evaluation"))
        throw new HttpError(400, "invalid_evaluation", "Document and Evaluation inputs are required");

      return { templateId: "", evaluation: fields.get("evaluation"), source: { ...parsedDocument, temporaryPath } };
    }

    if (purpose === "evaluation-document") {
      validateSourceFileMetadata(parsedDocument.mimeType, parsedDocument.size, maxSourceFileBytes);

      if (!parsedDocument.size || !fields.get("metadata"))
        throw new HttpError(400, "invalid_evaluation_document", "Document and metadata inputs are required");

      return { templateId: "", metadata: fields.get("metadata"), source: { ...parsedDocument, temporaryPath } };
    }

    if (purpose === "template-generation") {
      validateSourceFileMetadata(parsedDocument.mimeType, parsedDocument.size, maxSourceFileBytes);

      if (!parsedDocument.size) throw new HttpError(400, "invalid_document", "The sample file is empty");

      return {
        templateId: "",
        instructions: fields.get("instructions")?.trim() || "",
        source: { ...parsedDocument, temporaryPath },
      };
    }

    const metadata = validateExtractSubmissionMetadata({
      hasInlineFields: fields.has("fields"),
      maxSourceFileBytes,
      optionsRaw: fields.get("options") ?? null,
      sourceMimeType: parsedDocument.mimeType,
      sourceSize: parsedDocument.size,
      templateIdRaw: fields.get("template_id") ?? null,
      templateTagsRaw: fields.get("template_tags") ?? null,
      pagesRaw: fields.get("pages") ?? null,
    });

    return { ...metadata, source: { ...parsedDocument, temporaryPath } };
  } catch (error) {
    await rm(temporaryPath, { force: true });

    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_multipart", error instanceof Error ? error.message : "Invalid multipart request");
  } finally {
    request.signal.removeEventListener("abort", aborted);
  }
}
