import type { Env, FieldDefinition } from "../lib/types";
import type { ModelFieldResult } from "./modelResultNormalizer";

export class RetryableError extends Error {}

const DEFAULT_GEMINI_MODEL = "google/gemini-3-flash";
const DEFAULT_AI_GATEWAY_ID = "default";

export function getExtractionModelName(env: Env): string {
  return env.AI_MODEL || DEFAULT_GEMINI_MODEL;
}

export function getAiGatewayId(env: Env): string {
  return env.AI_GATEWAY_ID || DEFAULT_AI_GATEWAY_ID;
}

export async function runExtraction(
  env: Env,
  fields: FieldDefinition[],
  sourceBytes: ArrayBuffer,
  sourceMimeType: string,
): Promise<ModelFieldResult[]> {
  const model = getExtractionModelName(env);
  const gatewayId = getAiGatewayId(env);
  const prompt = buildPrompt(fields, sourceMimeType);
  const systemPrompt =
    "You extract fields from document content. Use only source data, do not guess, return JSON only, and use status=not_found with answer=null when missing.";
  const runInput = buildRunInput(
    prompt,
    sourceBytes,
    sourceMimeType,
    systemPrompt,
  );
  const runResult = await runViaGateway(env, model, gatewayId, runInput);
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

function buildRunInput(
  prompt: string,
  sourceBytes: ArrayBuffer,
  sourceMimeType: string,
  systemPrompt: string,
): Record<string, unknown> {
  return {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: sourceMimeType,
              data: toBase64(sourceBytes),
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
    },
  };
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
    required: Boolean(field.required),
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
    throw new RetryableError("AI.run returned empty response");
  }

  const record = payload as Record<string, unknown>;

  const directText = record.output_text;
  if (typeof directText === "string" && directText.trim().length > 0) {
    return directText;
  }

  const textField = record.text;
  if (typeof textField === "string" && textField.trim().length > 0) {
    return textField;
  }

  const candidates = record.candidates as
    | Array<Record<string, unknown>>
    | undefined;
  const candidateParts = candidates?.[0]?.content as
    | Record<string, unknown>
    | undefined;
  const parts = candidateParts?.parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim().length > 0) {
        return text;
      }
    }
  }

  throw new RetryableError(
    "Model response did not include readable text content",
  );
}

async function runViaGateway(
  env: Env,
  model: string,
  gatewayId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await env.AI.run(model, input, {
      gateway: { id: gatewayId },
    });
  } catch (error) {
    throw new RetryableError(`AI.run failed: ${errorToMessage(error)}`);
  }
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
