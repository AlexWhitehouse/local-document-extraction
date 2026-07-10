import type { FieldDefinition } from "../lib/types";
import type { ModelFieldResult } from "./modelResultNormalizer";

export class RetryableError extends Error {}

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
  MODEL_GATEWAY_URL?: string;
};

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

export async function runExtraction(
  env: ModelGatewayConfiguration,
  fields: FieldDefinition[],
  sourceBytes: ArrayBuffer,
  sourceMimeType: string,
): Promise<ModelFieldResult[]> {
  const model = getExtractionModelName(env);
  const prompt = buildPrompt(fields, sourceMimeType);
  const systemPrompt =
    "You extract fields from document content. Use only source data, do not guess, return JSON only, and use status=not_found with answer=null when missing.";
  const uploadedFileId =
    sourceMimeType === "application/pdf" && shouldUploadPdfToModelGateway(model)
      ? await uploadSourceFile(env, sourceBytes, sourceMimeType, model)
      : null;
  const sourceContentPart = uploadedFileId
    ? buildUploadedFileContentPart(uploadedFileId, sourceMimeType)
    : buildInlineSourceContentPart(sourceBytes, sourceMimeType);
  const runInput = buildChatCompletionsInput(
    model,
    prompt,
    sourceContentPart,
    systemPrompt,
  );
  let runResult: unknown;
  try {
    runResult = await runViaModelGateway(env, runInput);
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
  prompt: string,
  sourceContentPart: Record<string, unknown>,
  systemPrompt: string,
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
          sourceContentPart,
        ],
      },
    ],
    response_format: { type: "json_object" },
  };
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
        file_data: `data:${sourceMimeType};base64,${toBase64(sourceBytes)}`,
        format: sourceMimeType,
      },
    };
  }

  return {
    type: "image_url",
    image_url: {
      url: `data:${sourceMimeType};base64,${toBase64(sourceBytes)}`,
      format: sourceMimeType,
    },
  };
}

function shouldUploadPdfToModelGateway(model: string): boolean {
  return model.startsWith("azure/") || model.startsWith("azure_ai/");
}

function buildPrompt(
  fields: FieldDefinition[],
  sourceMimeType: string,
): string {
  const serializedFields = fields.map((field) => ({
    id: field.id,
    name: field.name,
    description: field.description,
    data_type: field.data_type,
  }));

  const sourceGuidance =
    sourceMimeType === "application/pdf"
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
): Promise<unknown> {
  if (!env.LITELLM_KEY) {
    throw new RetryableError("Model gateway key is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getModelGatewayRequestTimeoutMs(env),
  );

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
      throw new RetryableError(
        `Model gateway request failed with HTTP ${response.status}${formatErrorBody(bodyText)}`,
      );
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
    if (error instanceof RetryableError) {
      throw error;
    }
    if (isAbortError(error)) {
      throw new RetryableError("Model gateway request timed out");
    }
    throw new RetryableError(`Model gateway request failed: ${errorToMessage(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadSourceFile(
  env: ModelGatewayConfiguration,
  sourceBytes: ArrayBuffer,
  sourceMimeType: string,
  model: string,
): Promise<string> {
  if (!env.LITELLM_KEY) {
    throw new RetryableError("Model gateway key is not configured");
  }

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([sourceBytes], { type: sourceMimeType }),
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
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new RetryableError("Model gateway file upload timed out");
    }
    throw new RetryableError(
      `Model gateway file upload failed: ${errorToMessage(error)}`,
    );
  }
  const bodyText = await response.text();

  if (!response.ok) {
    throw new RetryableError(
      `Model gateway file upload failed with HTTP ${response.status}${formatErrorBody(bodyText)}`,
    );
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
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getModelGatewayRequestTimeoutMs(env),
  );

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
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

function getModelGatewayBaseUrl(env: ModelGatewayConfiguration): string {
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

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "unknown error";
}
