import type { FieldDefinition } from "../lib/types";
import type { ModelFieldResult } from "./modelResultNormalizer";
import { encodeModelPayloadBase64 } from "./modelPayloadBase64";
import { renderPdfPagesToPng } from "./pdfPageRenderer";

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

const DEFAULT_EXTRACTION_MODEL = "claude-opus-4-7";
const DEFAULT_MODEL_GATEWAY_URL = "https://litellm.t3m.uk";
const DEFAULT_MODEL_GATEWAY_ROUTE_LABEL = "litellm.t3m.uk";
const DEFAULT_MODEL_GATEWAY_REQUEST_TIMEOUT_MS = 300_000;
const MAX_ERROR_BODY_CHARS = 500;

export type ModelGatewayConfiguration = {
  AI_MODEL?: string;
  LITELLM_KEY?: string;
  MODEL_GATEWAY_REQUEST_TIMEOUT_MS?: string;
  MODEL_GATEWAY_ROUTE_LABEL?: string;
  MODEL_GATEWAY_SEQUENTIAL_CALLS?: string;
  MODEL_GATEWAY_USE_MANAGED_FILES?: string;
  MODEL_GATEWAY_URL?: string;
  MODEL_SUPPORTS_PDF_INPUT?: string;
  MODEL_SUPPORTS_STRUCTURED_OUTPUT?: string;
};

let sequentialModelCallTail: Promise<void> = Promise.resolve();

export function getExtractionModelName(env: ModelGatewayConfiguration): string {
  return env.AI_MODEL || DEFAULT_EXTRACTION_MODEL;
}

export function getModelGatewayRouteLabel(env: ModelGatewayConfiguration): string {
  const configured = env.MODEL_GATEWAY_ROUTE_LABEL?.trim();
  if (configured) {
    return configured;
  }

  try {
    return new URL(getModelGatewayBaseUrl(env)).hostname || DEFAULT_MODEL_GATEWAY_ROUTE_LABEL;
  } catch {
    return DEFAULT_MODEL_GATEWAY_ROUTE_LABEL;
  }
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

export function usesSequentialModelCalls(env: ModelGatewayConfiguration): boolean {
  return readBooleanConfiguration(env.MODEL_GATEWAY_SEQUENTIAL_CALLS, false);
}

export function supportsPdfInput(env: ModelGatewayConfiguration): boolean {
  return readBooleanConfiguration(env.MODEL_SUPPORTS_PDF_INPUT, true);
}

export function supportsStructuredOutput(env: ModelGatewayConfiguration): boolean {
  return readBooleanConfiguration(env.MODEL_SUPPORTS_STRUCTURED_OUTPUT, true);
}

export function usesManagedPdfFileUpload(
  env: ModelGatewayConfiguration,
  sourceMimeType: string,
): boolean {
  return sourceMimeType === "application/pdf"
    && supportsPdfInput(env)
    && shouldUploadPdfToModelGateway(env, getExtractionModelName(env));
}

export async function runExtraction(
  env: ModelGatewayConfiguration,
  fields: FieldDefinition[],
  source: ArrayBuffer | Blob,
  sourceMimeType: string,
  signal?: AbortSignal,
): Promise<ModelFieldResult[]> {
  const model = getExtractionModelName(env);
  const renderPdfAsImages =
    sourceMimeType === "application/pdf" && !supportsPdfInput(env);
  const uploadPdf = usesManagedPdfFileUpload(env, sourceMimeType);
  const sourceBytes = uploadPdf
    ? null
    : source instanceof Blob
      ? await source.arrayBuffer()
      : source;
  const prompt = buildPrompt(fields, sourceMimeType, renderPdfAsImages);
  const systemPrompt =
    "You extract fields from document content. Use only source data, do not guess, return JSON only, and use status=not_found with answer=null when missing.";
  const uploadedFileId =
    uploadPdf
      ? await uploadSourceFile(env, source, sourceMimeType, model, signal)
      : null;
  let sourceContentParts: Record<string, unknown>[];
  try {
    sourceContentParts = uploadedFileId
      ? [buildUploadedFileContentPart(uploadedFileId, sourceMimeType)]
      : renderPdfAsImages
        ? (await renderPdfPagesToPng(sourceBytes!, signal)).map((pageBytes) =>
            buildInlineImageContentPart(pageBytes, "image/png"),
          )
        : [buildInlineSourceContentPart(sourceBytes!, sourceMimeType)];
  } catch (error) {
    if (signal?.aborted) {
      throw new ExtractionCancelledError("PDF page rendering cancelled");
    }
    throw new RetryableError(
      `PDF Source file could not be prepared for the model: ${errorToMessage(error)}`,
    );
  }
  const runInput = buildChatCompletionsInput(
    model,
    fields,
    prompt,
    sourceContentParts,
    systemPrompt,
    supportsStructuredOutput(env),
  );
  let runResult: unknown;
  try {
    runResult = await scheduleModelCall(
      env,
      () => runViaModelGateway(env, runInput, signal),
    );
  } finally {
    if (uploadedFileId) {
      await deleteUploadedSourceFile(env, uploadedFileId);
    }
  }
  const content = readRunResultContent(runResult);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new RetryableError("Model response content was not valid JSON");
  }

  const results = (parsed as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    throw new RetryableError("Model JSON missing results array");
  }

  return results as ModelFieldResult[];
}

function buildChatCompletionsInput(
  model: string,
  fields: FieldDefinition[],
  prompt: string,
  sourceContentParts: Record<string, unknown>[],
  systemPrompt: string,
  useStructuredOutput: boolean,
): Record<string, unknown> {
  return {
    model,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...sourceContentParts,
        ],
      },
    ],
    ...(useStructuredOutput
      ? { response_format: buildResponseFormat(model, fields) }
      : {}),
  };
}

function buildResponseFormat(
  model: string,
  fields: FieldDefinition[],
): Record<string, unknown> {
  const normalizedModel = model.toLowerCase();
  if (
    !normalizedModel.includes("gemma-4") &&
    !isQwenMultimodalModel(normalizedModel)
  ) {
    return { type: "json_object" };
  }

  return {
    type: "json_schema",
    json_schema: {
      name: "extraction_results",
      strict: true,
      schema: {
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
      },
    },
  };
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
      { type: [schemaTypeForDataType(column.dataType), "null"] },
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
): Array<{ key: string; dataType: FieldDefinition["data_type"] }> {
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

function schemaTypeForDataType(
  dataType: FieldDefinition["data_type"],
): "string" | "number" | "boolean" {
  if (dataType === "number" || dataType === "boolean") {
    return dataType;
  }
  return "string";
}

function buildUploadedFileContentPart(
  fileId: string,
  sourceMimeType: string,
): Record<string, unknown> {
  return {
    type: "file",
    file: {
      file_id: fileId,
      format: sourceMimeType,
    },
  };
}

function buildInlineSourceContentPart(
  sourceBytes: ArrayBuffer,
  sourceMimeType: string,
): Record<string, unknown> {
  if (sourceMimeType === "application/pdf") {
    return {
      type: "file",
      file: {
        file_data: `data:${sourceMimeType};base64,${encodeModelPayloadBase64(sourceBytes)}`,
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
      url: `data:${sourceMimeType};base64,${encodeModelPayloadBase64(sourceBytes)}`,
    },
  };
}

function shouldUploadPdfToModelGateway(
  env: ModelGatewayConfiguration,
  model: string,
): boolean {
  return readBooleanConfiguration(env.MODEL_GATEWAY_USE_MANAGED_FILES, false)
    || model.startsWith("azure/")
    || model.startsWith("azure_ai/");
}

function isQwenMultimodalModel(normalizedModel: string): boolean {
  return (
    /qwen3\.(?:5|6|8)/.test(normalizedModel) ||
    normalizedModel.includes("qwen3-vl")
  );
}

function scheduleModelCall<T>(
  env: ModelGatewayConfiguration,
  task: () => Promise<T>,
): Promise<T> {
  if (!usesSequentialModelCalls(env)) {
    return task();
  }

  const result = sequentialModelCallTail.then(task, task);
  sequentialModelCallTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
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

function readBooleanConfiguration(
  value: string | undefined,
  fallback: boolean,
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized || "")) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized || "")) {
    return false;
  }
  return fallback;
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

function readRunResultContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new RetryableError("Model gateway returned empty response");
  }

  const record = payload as Record<string, unknown>;

  const directText = readContentValue(record.output_text);
  if (directText) {
    return directText;
  }

  const textField = readContentValue(record.text);
  if (textField) {
    return textField;
  }

  const choices = record.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  const messageContent = readContentValue(message?.content);
  if (messageContent) {
    return messageContent;
  }

  const reasoningContent = readContentValue(message?.reasoning_content);
  if (reasoningContent) {
    return reasoningContent;
  }

  throw new RetryableError(
    "Model response did not include readable text content",
  );
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

async function runViaModelGateway(
  env: ModelGatewayConfiguration,
  input: Record<string, unknown>,
  signal?: AbortSignal,
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
      headers: {
        authorization: `Bearer ${env.LITELLM_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const bodyText = await response.text();

    if (!response.ok) {
      const message = `Model gateway request failed with HTTP ${response.status}${formatErrorBody(bodyText)}`;
      if (isRetryableHttpStatus(response.status)) {
        throw new RetryableError(message, {
          retryAfterMs: retryAfterDelayMs(response.headers.get("retry-after")),
          status: response.status,
        });
      }
      throw new ModelGatewayRequestError(message, response.status);
    }

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
    if (isAbortError(error)) {
      throw new RetryableError("Model gateway request timed out");
    }
    throw new RetryableError(`Model gateway request failed: ${errorToMessage(error)}`);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortForWorkspaceDeletion);
  }
}

async function uploadSourceFile(
  env: ModelGatewayConfiguration,
  source: ArrayBuffer | Blob,
  sourceMimeType: string,
  model: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!env.LITELLM_KEY) {
    throw new ModelGatewayRequestError("Model gateway key is not configured");
  }

  const formData = new FormData();
  formData.append(
    "file",
    source instanceof Blob ? source : new Blob([source], { type: sourceMimeType }),
    sourceMimeType === "application/pdf" ? "source.pdf" : "source",
  );
  formData.append("purpose", "user_data");
  formData.append("model", model);
  formData.append("target_model_names", model);

  let response: Response;
  try {
    response = await fetchWithModelGatewayTimeout(env, buildFilesUrl(env), {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.LITELLM_KEY}`,
      },
      body: formData,
    }, signal);
  } catch (error) {
    if (signal?.aborted) {
      throw new ExtractionCancelledError("Model gateway file upload cancelled");
    }
    if (isAbortError(error)) {
      throw new RetryableError("Model gateway file upload timed out");
    }
    throw new RetryableError(
      `Model gateway file upload failed: ${errorToMessage(error)}`,
    );
  }
  const bodyText = await response.text();

  if (!response.ok) {
    const message = `Model gateway file upload failed with HTTP ${response.status}${formatErrorBody(bodyText)}`;
    if (isRetryableHttpStatus(response.status)) {
      throw new RetryableError(message, {
        retryAfterMs: retryAfterDelayMs(response.headers.get("retry-after")),
        status: response.status,
      });
    }
    throw new ModelGatewayRequestError(message, response.status);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new RetryableError("Model gateway file upload returned invalid JSON");
  }

  const fileId = (payload as { id?: unknown }).id;
  if (typeof fileId !== "string" || !fileId.trim()) {
    throw new RetryableError("Model gateway file upload response missing file ID");
  }

  return fileId;
}

async function deleteUploadedSourceFile(env: ModelGatewayConfiguration, fileId: string): Promise<void> {
  try {
    const response = await fetchWithModelGatewayTimeout(
      env,
      buildFileDeleteUrl(env, fileId),
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${env.LITELLM_KEY}`,
        },
      },
    );
    if (!response.ok) {
      console.error("Model gateway file cleanup failed", response.status);
    }
  } catch (error) {
    console.error("Model gateway file cleanup failed", error);
  }
}

async function fetchWithModelGatewayTimeout(
  env: ModelGatewayConfiguration,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
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
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortForWorkspaceDeletion);
  }
}

function buildChatCompletionsUrl(env: ModelGatewayConfiguration): string {
  try {
    const baseUrl = getModelGatewayBaseUrl(env);
    const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL("chat/completions", normalized).toString();
  } catch {
    throw new RetryableError("Model gateway URL is not valid");
  }
}

function buildFilesUrl(env: ModelGatewayConfiguration): string {
  try {
    const baseUrl = getModelGatewayBaseUrl(env);
    const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL("files", normalized).toString();
  } catch {
    throw new RetryableError("Model gateway URL is not valid");
  }
}

function buildFileDeleteUrl(env: ModelGatewayConfiguration, fileId: string): string {
  try {
    const baseUrl = getModelGatewayBaseUrl(env);
    const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL(`files/${encodeURIComponent(fileId)}`, normalized).toString();
  } catch {
    throw new RetryableError("Model gateway URL is not valid");
  }
}

export function getModelGatewayBaseUrl(env: ModelGatewayConfiguration): string {
  return env.MODEL_GATEWAY_URL || DEFAULT_MODEL_GATEWAY_URL;
}

function formatErrorBody(bodyText: string): string {
  if (!bodyText.trim()) {
    return "";
  }

  let message = bodyText.trim();
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    if (typeof parsed.error?.message === "string") {
      message = parsed.error.message;
    } else if (typeof parsed.message === "string") {
      message = parsed.message;
    }
  } catch {
    // The response body is still useful when the gateway returns plain text.
  }

  if (message.length > MAX_ERROR_BODY_CHARS) {
    message = `${message.slice(0, MAX_ERROR_BODY_CHARS)}...`;
  }

  return `: ${message}`;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "unknown error";
}
