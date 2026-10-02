import type { FieldDefinition } from "../lib/types";
import type { ModelFieldResult } from "./modelResultNormalizer";
import { iteratePdfPagesToPng, MAX_RENDERED_PDF_BYTES, PdfPreparationLimitError } from "./pdfPageRenderer";
import { createByteBudget } from "../lib/byteBudget";
import { localMemoryLimits } from "../localMemoryLimits";

export class RetryableError extends Error {
  readonly retryAfterMs: number | null;
  readonly status: number | null;

  constructor(
    message: string,
    options: { retryAfterMs?: number | null; status?: number | null } = {},
  ) {
    super(message);
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.status = options.status ?? null;
  }
}
export class ModelGatewayRequestError extends Error {
  constructor(message: string, public readonly status: number | null = null) {
    super(message);
  }
}
export class ExtractionCancelledError extends Error {}

const DEFAULT_MODEL_GATEWAY_REQUEST_TIMEOUT_MS = 300_000;

export type ModelGatewayConfiguration = {
  AI_MODEL?: string;
  LITELLM_KEY?: string;
  MODEL_GATEWAY_REQUEST_TIMEOUT_MS?: string;
  MODEL_GATEWAY_SEQUENTIAL_CALLS?: string;
  MODEL_GATEWAY_WORKSPACE_ID?: string;
  MODEL_GATEWAY_URL?: string;
  MODEL_SUPPORTS_PDF_INPUT?: string;
  MODEL_SUPPORTS_STRUCTURED_OUTPUT?: string;
};

const sequentialModelCallTails = new Map<string, Promise<void>>();
const preparationBudget = createByteBudget(localMemoryLimits.preparationMaxBytes);

export const getModelPreparationSnapshot = preparationBudget.snapshot;

export function getExtractionModelName(env: ModelGatewayConfiguration): string {
  if (!env.AI_MODEL) throw new ModelGatewayRequestError("Workspace model is not configured");
  return env.AI_MODEL;
}

export function getModelGatewayRouteLabel(env: ModelGatewayConfiguration): string {
  return new URL(getModelGatewayBaseUrl(env)).hostname;
}

export function getModelGatewayRequestTimeoutMs(env: ModelGatewayConfiguration): number {
  const configured = Number(
    env.MODEL_GATEWAY_REQUEST_TIMEOUT_MS ||
      DEFAULT_MODEL_GATEWAY_REQUEST_TIMEOUT_MS,
  );

  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_MODEL_GATEWAY_REQUEST_TIMEOUT_MS;
  }

  return Math.trunc(configured);
}

/** Prepare a document once, under the same memory and sequencing limits as extraction. */
export async function withPreparedModelSource<T>(
  env: ModelGatewayConfiguration,
  source: ArrayBuffer | Blob,
  sourceMimeType: string,
  signal: AbortSignal | undefined,
  work: (parts: Record<string, unknown>[], onPrepared: (characters: number) => void) => Promise<T>,
  additionalContextCharacters = 0,
): Promise<T> {
  const sourceSize = source instanceof Blob ? source.size : source.byteLength;
  return withPreparedModelSourceFactory(env, sourceSize, sourceMimeType, signal, async () => source, work, additionalContextCharacters);
}

/** Source derivatives are created only after shared memory and sequencing admission. */
export async function withPreparedModelSourceFactory<T>(
  env: ModelGatewayConfiguration,
  sourceSizeUpperBound: number,
  sourceMimeType: string,
  signal: AbortSignal | undefined,
  prepareSource: () => Promise<ArrayBuffer | Blob>,
  work: (parts: Record<string, unknown>[], onPrepared: (characters: number) => void) => Promise<T>,
  additionalContextCharacters = 0,
): Promise<T> {
  const sourceSize = sourceSizeUpperBound;
  if (!Number.isSafeInteger(sourceSize) || sourceSize < 0) throw new ModelGatewayRequestError("Invalid model source size");
  const rendered = sourceMimeType === "application/pdf" && !readBooleanConfiguration(env.MODEL_SUPPORTS_PDF_INPUT);
  const reservation = Math.max(1024 * 1024, rendered
    ? MAX_RENDERED_PDF_BYTES * 3 + sourceSize + 16 * 1024 * 1024
    : sourceSize * 4) + additionalContextCharacters * 6;
  if (reservation > localMemoryLimits.preparationMaxBytes) throw new ModelGatewayRequestError("Source exceeds the local model preparation budget");
  return scheduleModelCall(env, () => preparationBudget.run(reservation, async (lease) => {
    if (signal?.aborted) throw new ExtractionCancelledError("Model preparation cancelled");
    const source = await prepareSource();
    const actualSize = source instanceof Blob ? source.size : source.byteLength;
    if (actualSize > sourceSize) throw new ModelGatewayRequestError("Prepared source exceeds its model preparation reservation");
    const sourceBytes = source instanceof Blob ? await source.arrayBuffer() : source;
    const parts = await prepareSourceContent(sourceBytes, sourceMimeType, rendered, signal);
    return work(parts, (characters) => {
      const retainedBytes = sourceSize + characters * 6 + 16 * 1024 * 1024;
      lease.shrinkTo(Math.min(reservation, retainedBytes));
    });
  }, signal), signal).catch((error) => {
    if (signal?.aborted) throw new ExtractionCancelledError("Model preparation cancelled");
    throw error;
  });
}

/** Hold derived-artifact memory through persistence; do not nest another preparation lease inside work. */
export async function withDocumentProcessingMemory<T>(reservationBytes: number, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (!Number.isSafeInteger(reservationBytes) || reservationBytes < 0 || reservationBytes > localMemoryLimits.preparationMaxBytes) throw new ModelGatewayRequestError("Document processing exceeds the local model preparation budget");
  return preparationBudget.run(reservationBytes, async () => { signal.throwIfAborted(); return work(); }, signal);
}

/** Source-free assistance shares the extraction scheduler and preparation memory budget. */
export async function withModelTextAdmission<T>(env: ModelGatewayConfiguration, characters: number, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const reservation = Math.max(1024 * 1024, characters * 6);
  return scheduleModelCall(env, () => preparationBudget.run(reservation, async () => {
    if (signal.aborted) throw new ExtractionCancelledError("Model request cancelled");
    return work();
  }, signal), signal).catch((error) => {
    if (signal.aborted) throw new ExtractionCancelledError("Model request cancelled");
    throw error;
  });
}

async function prepareSourceContent(
  sourceBytes: ArrayBuffer,
  sourceMimeType: string,
  renderPdfAsImages: boolean,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  if (!renderPdfAsImages) return [buildInlineSourceContentPart(sourceBytes, sourceMimeType)];
  const parts: Record<string, unknown>[] = [];
  try {
    for await (const pageBytes of iteratePdfPagesToPng(sourceBytes, signal)) {
      parts.push(buildInlineImageContentPart(pageBytes, "image/png"));
    }
  } catch (error) {
    if (signal?.aborted) throw new ExtractionCancelledError("PDF page rendering cancelled");
    if (error instanceof PdfPreparationLimitError) throw new ModelGatewayRequestError(error.message);
    throw new RetryableError(
      `PDF Source file could not be prepared for the model: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  return parts;
}

export type ExtractionUsage = { input_tokens: number | null; output_tokens: number | null; scope: "successful attempt" };

export async function runExtraction(
  env: ModelGatewayConfiguration,
  fields: FieldDefinition[],
  source: ArrayBuffer | Blob,
  sourceMimeType: string,
  signal?: AbortSignal,
  onUsage?: (usage: ExtractionUsage) => void,
): Promise<ModelFieldResult[]> {
  return withPreparedModelSource(env, source, sourceMimeType, signal, async (sourceContentParts, onPrepared) => {
    const model = getExtractionModelName(env);
    const renderPdfAsImages = sourceMimeType === "application/pdf" && !readBooleanConfiguration(env.MODEL_SUPPORTS_PDF_INPUT);
    const requestBody = JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You extract fields from document content. Use only source data, do not guess, return JSON only, and use status=not_found with answer=null when missing.",
        },
        {
          role: "user",
          content: [{ type: "text", text: buildPrompt(fields, sourceMimeType, renderPdfAsImages) }, ...sourceContentParts],
        },
      ],
      ...(readBooleanConfiguration(env.MODEL_SUPPORTS_STRUCTURED_OUTPUT)
        ? { response_format: buildResponseFormat(model, fields) }
        : {}),
    });
    onPrepared(requestBody.length);
    const runResult = await runViaModelGateway(env, requestBody, signal);
    const content = readRunResultContent(runResult);
    const usage = runResult && typeof runResult === "object" ? (runResult as { usage?: Record<string, unknown> }).usage : undefined;
    const tokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
    if (usage && typeof usage === "object") onUsage?.({ input_tokens: tokens(usage.prompt_tokens ?? usage.input_tokens), output_tokens: tokens(usage.completion_tokens ?? usage.output_tokens), scope: "successful attempt" });

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new RetryableError("Model response content was not valid JSON");
    }

    const results = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { results?: unknown }).results
      : undefined;
    if (!Array.isArray(results)) {
      throw new RetryableError("Model JSON missing results array");
    }
    if (results.some((row) => !row || typeof row !== "object" || Array.isArray(row) ||
      typeof row.field_id !== "string" || !row.field_id.trim() || typeof row.status !== "string" || !("answer" in row))) {
      throw new RetryableError("Model JSON contains invalid result entries");
    }

    return results as ModelFieldResult[];
  });
}

function buildResponseFormat(
  model: string,
  fields: FieldDefinition[],
): Record<string, unknown> {
  return buildModelResponseFormat(model, "extraction_results", {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field_id: { type: "string" },
            status: {
              type: "string",
              enum: [
                "ok",
                "not_found",
                "invalid_type",
                "unreadable",
                "error",
              ],
            },
            answer: buildAnswerSchema(fields),
            confidence: { type: ["number", "null"] },
            evidence: { type: ["string", "null"] },
          },
          required: [
            "field_id",
            "status",
            "answer",
            "confidence",
            "evidence",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  });
}

export function buildModelResponseFormat(model: string, name: string, schema: Record<string, unknown>): Record<string, unknown> {
  const normalizedModel = model.toLowerCase();
  const supportsJsonSchema = normalizedModel.includes("gemma-4")
    || normalizedModel.includes("qwen3-vl")
    || /qwen3\.(?:5|6|8)/.test(normalizedModel);
  if (!supportsJsonSchema) return { type: "json_object" };
  return { type: "json_schema", json_schema: { name, strict: true, schema } };
}

function buildAnswerSchema(fields: FieldDefinition[]): Record<string, unknown> {
  const schemas = fields.map(buildFieldAnswerSchema);
  schemas.push({ type: "null" });

  const uniqueSchemas = [
    ...new Map(schemas.map((schema) => [JSON.stringify(schema), schema])).values(),
  ];
  return { anyOf: uniqueSchemas };
}

function buildFieldAnswerSchema(field: FieldDefinition): Record<string, unknown> {
  switch (field.data_type) {
    case "string":
    case "date":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "array":
      return {
        type: "array",
        items: {
          anyOf: [
            { type: "string" },
            { type: "number" },
            { type: "boolean" },
            { type: "null" },
          ],
        },
      };
    case "object":
    case "array<object>":
      return buildObjectAnswerSchema(field);
  }
}

function buildObjectAnswerSchema(field: FieldDefinition): Record<string, unknown> {
  const columns = readObjectSchemaColumns(field.description);
  if (columns.length === 0) {
    const emptyObjectSchema = {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    };
    return field.data_type === "array<object>"
      ? { type: "array", items: emptyObjectSchema }
      : emptyObjectSchema;
  }

  const rowProperties = Object.fromEntries(
    columns.map((column) => [
      column.key,
      { type: [column.dataType === "number" || column.dataType === "boolean" ? column.dataType : "string", "null"] },
    ]),
  );
  return {
    type: "object",
    properties: {
      columns: { type: "array", items: { type: "string" } },
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: rowProperties,
          required: columns.map((column) => column.key),
          additionalProperties: false,
        },
      },
    },
    required: ["columns", "rows"],
    additionalProperties: false,
  };
}

function readObjectSchemaColumns(
  description: string,
): Array<{ key: string; dataType: "string" | "number" | "boolean" | "date" }> {
  const match = description.match(
    /\[\[OBJECT_SCHEMA\]\]\s*([\s\S]*?)\s*\[\[\/OBJECT_SCHEMA\]\]/,
  );
  if (!match?.[1]) {
    return [];
  }

  try {
    const schema = JSON.parse(match[1]) as { columns?: unknown };
    if (!Array.isArray(schema.columns)) {
      return [];
    }
    return schema.columns.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
      }
      const column = value as Record<string, unknown>;
      const key = typeof column.key === "string" ? column.key : "";
      const dataType = column.data_type;
      if (
        !key ||
        (dataType !== "string" &&
          dataType !== "number" &&
          dataType !== "boolean" &&
          dataType !== "date")
      ) {
        return [];
      }
      return [{ key, dataType }];
    });
  } catch {
    return [];
  }
}

function buildInlineSourceContentPart(
  sourceBytes: ArrayBuffer,
  sourceMimeType: string,
): Record<string, unknown> {
  if (sourceMimeType === "application/pdf") {
    return {
      type: "file",
      file: {
        file_data: `data:${sourceMimeType};base64,${Buffer.from(sourceBytes).toString("base64")}`,
        format: sourceMimeType,
      },
    };
  }

  return buildInlineImageContentPart(sourceBytes, sourceMimeType);
}

function buildInlineImageContentPart(
  sourceBytes: ArrayBuffer,
  sourceMimeType: string,
): Record<string, unknown> {
  return {
    type: "image_url",
    image_url: {
      url: `data:${sourceMimeType};base64,${Buffer.from(sourceBytes).toString("base64")}`,
    },
  };
}

function scheduleModelCall<T>(
  env: ModelGatewayConfiguration,
  task: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!readBooleanConfiguration(env.MODEL_GATEWAY_SEQUENTIAL_CALLS)) {
    return task();
  }

  const scope = env.MODEL_GATEWAY_WORKSPACE_ID ?? "transport-test";
  const previous = sequentialModelCallTails.get(scope) ?? Promise.resolve();
  const result = waitForModelTurn(previous, signal).then(task);
  // A cancelled waiter must not let later work overtake the call already running.
  const tail = Promise.allSettled([previous, result]).then(() => undefined);
  sequentialModelCallTails.set(scope, tail);
  void tail.then(() => { if (sequentialModelCallTails.get(scope) === tail) sequentialModelCallTails.delete(scope); });
  return result;
}

function waitForModelTurn(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return previous;
  return new Promise((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      reject(new ExtractionCancelledError("Queued model call cancelled"));
    };
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener("abort", aborted, { once: true });
    void previous.then(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    });
  });
}

function retryAfterDelayMs(value: string | null, now = Date.now()): number | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    return Math.max(0, Number(normalized) * 1_000);
  }
  const retryAt = Date.parse(normalized);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : null;
}

export function readBooleanConfiguration(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() || "");
}

function buildPrompt(
  fields: FieldDefinition[],
  sourceMimeType: string,
  pdfRenderedAsImages: boolean,
): string {
  const serializedFields = fields.map((field) => ({
    id: field.id,
    name: field.name,
    description: field.description,
    data_type: field.data_type,
  }));

  const sourceGuidance = pdfRenderedAsImages
    ? "The attached images are the PDF pages in order; read all pages."
    : sourceMimeType === "application/pdf"
      ? "For PDF inputs, read the attached PDF file directly."
      : "For image inputs, read the attached image.";

  return [
    "Extract all fields below from the provided document content.",
    sourceGuidance,
    "Return only this JSON shape:",
    '{"results":[{"field_id":"...","status":"ok|not_found|invalid_type|unreadable|error","answer":<any|null>,"confidence":<0-1|null>,"evidence":<string|null>}]}',
    "Requested fields:",
    JSON.stringify(serializedFields),
  ].join("\n");
}

export function readRunResultContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new RetryableError("Model gateway returned empty response");
  }

  const record = payload as Record<string, unknown>;
  const choices = record.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  for (const candidate of [record.output_text, record.text, message?.content, message?.reasoning_content]) {
    const content = readContentValue(candidate);
    if (content) return content;
  }
  throw new RetryableError("Model response did not include readable text content");
}

function readContentValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  for (const part of value) {
    const text = (part as Record<string, unknown>).text;
    if (typeof text === "string" && text.trim().length > 0) {
      return text;
    }
  }

  return null;
}

export async function runViaModelGateway(
  env: ModelGatewayConfiguration,
  requestBody: string,
  signal?: AbortSignal,
  maximumResponseBytes?: number,
): Promise<unknown> {
  if (!env.LITELLM_KEY) {
    throw new ModelGatewayRequestError("Model gateway key is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getModelGatewayRequestTimeoutMs(env),
  );
  const abortForWorkspaceDeletion = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortForWorkspaceDeletion, { once: true });
  }

  try {
    const response = await fetch(buildChatCompletionsUrl(env), {
      method: "POST",
      redirect: "manual",
      headers: {
        authorization: `Bearer ${env.LITELLM_KEY}`,
        "content-type": "application/json",
      },
      body: requestBody,
      signal: controller.signal,
    });
    if (!response.ok) {
      // Do not consume or surface upstream error bodies, including redirect destinations.
      await response.body?.cancel().catch(() => {});
      const message = `Model gateway request failed with HTTP ${response.status}`;
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new RetryableError(message, {
          retryAfterMs: retryAfterDelayMs(response.headers.get("retry-after")),
          status: response.status,
        });
      }
      throw new ModelGatewayRequestError(message, response.status);
    }

    const bodyText = maximumResponseBytes ? await readBoundedGatewayResponse(response, maximumResponseBytes, controller.signal) : await response.text();
    if (!bodyText.trim()) {
      throw new RetryableError("Model gateway returned empty response");
    }

    try {
      return JSON.parse(bodyText);
    } catch {
      throw new RetryableError("Model gateway returned invalid JSON");
    }
  } catch (error) {
    if (signal?.aborted) {
      throw new ExtractionCancelledError("Model gateway request cancelled");
    }
    if (error instanceof RetryableError || error instanceof ModelGatewayRequestError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new RetryableError("Model gateway request timed out");
    }
    throw new RetryableError("Model gateway request failed");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortForWorkspaceDeletion);
  }
}

export function buildChatCompletionsUrl(env: ModelGatewayConfiguration): string {
  try {
    const baseUrl = getModelGatewayBaseUrl(env);
    const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL("chat/completions", normalized).toString();
  } catch {
    throw new RetryableError("Model gateway URL is not valid");
  }
}

function getModelGatewayBaseUrl(env: ModelGatewayConfiguration): string {
  if (!env.MODEL_GATEWAY_URL) throw new ModelGatewayRequestError("Workspace gateway is not configured");
  return env.MODEL_GATEWAY_URL;
}

/** Bound the transport envelope before JSON parsing, including providers returning huge error-like payloads. */
async function readBoundedGatewayResponse(response: Response, maximumBytes: number, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get("content-length")) > maximumBytes) {
    await response.body?.cancel().catch(() => {});
    throw new ModelGatewayRequestError("Model response exceeds the assistance response limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw new ModelGatewayRequestError("Model response exceeds the assistance response limit");
      chunks.push(value);
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
