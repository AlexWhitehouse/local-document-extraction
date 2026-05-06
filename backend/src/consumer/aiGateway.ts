import type {
  DataType,
  Env,
  FieldDefinition,
  MarkdownConversionResult,
  MarkdownDocument,
} from "../lib/types";

type ModelFieldResult = {
  field_id: string;
  status: string;
  answer: unknown;
  confidence?: number | null;
  evidence?: string | null;
};

export class RetryableError extends Error {}

export async function runExtraction(
  env: Env,
  fields: FieldDefinition[],
  sourceBytes: ArrayBuffer,
  sourceMimeType: string,
): Promise<ModelFieldResult[]> {
  const model = "google/gemini-3-flash";
  const gatewayId = env.AI_GATEWAY_ID || "default";
  const prompt = buildPrompt(fields, sourceMimeType, model);
  const systemPrompt =
    "You extract fields from document content. Use only source data, do not guess, return JSON only, and use status=not_found with answer=null when missing.";
  const runInput = await buildRunInput(
    model,
    prompt,
    sourceBytes,
    sourceMimeType,
    systemPrompt,
    env,
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

async function buildUserContent(
  prompt: string,
  sourceBytes: ArrayBuffer,
  sourceMimeType: string,
  env: Env,
): Promise<Array<Record<string, unknown>>> {
  if (sourceMimeType === "application/pdf") {
    const markdown = await convertPdfToMarkdown(sourceBytes, sourceMimeType, env);
    return [
      {
        type: "text",
        text: [
          prompt,
          "Source type: PDF converted to markdown.",
          "Use the markdown content below as the only document source.",
          "Document markdown:",
          markdown,
        ].join("\n\n"),
      },
    ];
  }

  const imageBase64 = toBase64(sourceBytes);
  return [
    { type: "text", text: prompt },
    {
      type: "image_url",
      image_url: {
        url: `data:${sourceMimeType};base64,${imageBase64}`,
      },
    },
  ];
}

async function buildRunInput(
  model: string,
  prompt: string,
  sourceBytes: ArrayBuffer,
  sourceMimeType: string,
  systemPrompt: string,
  env: Env,
): Promise<Record<string, unknown>> {
  if (model.startsWith("google/")) {
    return buildGoogleRunInput(prompt, sourceBytes, sourceMimeType, systemPrompt);
  }

  const userContent = await buildUserContent(
    prompt,
    sourceBytes,
    sourceMimeType,
    env,
  );

  return {
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userContent,
      },
    ],
  };
}

async function buildGoogleRunInput(
  prompt: string,
  sourceBytes: ArrayBuffer,
  sourceMimeType: string,
  systemPrompt: string,
): Promise<Record<string, unknown>> {
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

async function convertPdfToMarkdown(sourceBytes: ArrayBuffer, sourceMimeType: string, env: Env): Promise<string> {
  const document: MarkdownDocument = {
    name: "source.pdf",
    blob: new Blob([sourceBytes], { type: sourceMimeType }),
  };

  const result = await env.AI.toMarkdown(document, {
    conversionOptions: {
      pdf: {
        metadata: false,
        images: {
          convert: true,
          maxConvertedImages: 8,
          descriptionLanguage: "en",
        },
      },
    },
  });
  const conversion = asSingleConversionResult(result);

  if (conversion.format !== "markdown") {
    throw new Error(conversion.error || "PDF markdown conversion failed");
  }

  if (!conversion.data || conversion.data.trim().length === 0) {
    throw new Error("PDF markdown conversion returned empty content");
  }

  if (!hasMeaningfulMarkdownContent(conversion.data)) {
    throw new Error(
      "PDF conversion returned little or no extractable text. This PDF may be scanned or raster-only. Try an OCR-enabled PDF or submit page Documents.",
    );
  }

  return conversion.data;
}

function hasMeaningfulMarkdownContent(markdown: string): boolean {
  const normalized = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/#+\s*(source\.pdf|metadata|contents|page\s+\d+)\b/gi, " ")
    .replace(/-\s*[A-Za-z0-9_.:-]+=/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const alphaNumericCount = (normalized.match(/[A-Za-z0-9]/g) || []).length;
  return alphaNumericCount >= 30;
}

function asSingleConversionResult(
  result: MarkdownConversionResult | MarkdownConversionResult[],
): MarkdownConversionResult {
  if (Array.isArray(result)) {
    if (result.length === 0) {
      throw new Error("PDF markdown conversion returned no results");
    }
    return result[0];
  }

  return result;
}

function buildPrompt(
  fields: FieldDefinition[],
  sourceMimeType: string,
  model: string,
): string {
  const serializedFields = fields.map((field) => ({
    id: field.id,
    name: field.name,
    description: field.description,
    data_type: field.data_type,
    required: Boolean(field.required),
  }));

  const sourceGuidance =
    sourceMimeType === "application/pdf" && model.startsWith("google/")
      ? "For PDF inputs, read the attached PDF file directly."
      : sourceMimeType === "application/pdf"
        ? "For PDF inputs, markdown text is provided in the user message and is the source of truth."
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

  const choices = record.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  const content = message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    for (const part of content) {
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") {
        return text;
      }
    }
  }

  const anthropicContent = record.content;
  if (Array.isArray(anthropicContent)) {
    for (const part of anthropicContent) {
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim().length > 0) {
        return text;
      }
    }
  }

  const candidates = record.candidates as Array<Record<string, unknown>> | undefined;
  const candidateParts = candidates?.[0]?.content as Record<string, unknown> | undefined;
  const parts = candidateParts?.parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim().length > 0) {
        return text;
      }
    }
  }

  throw new RetryableError("Model response did not include readable text content");
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

export type NormalizedModelField = {
  field_id: string;
  status: "ok" | "not_found" | "invalid_type" | "unreadable" | "error";
  answer: unknown;
  normalized_value: string | null;
  confidence: number | null;
  evidence: string | null;
};

export function normalizeModelResults(
  fields: FieldDefinition[],
  rawResults: ModelFieldResult[],
): NormalizedModelField[] {
  const rawByField = new Map<string, ModelFieldResult>();
  for (const row of rawResults) {
    if (typeof row.field_id === "string") {
      rawByField.set(row.field_id, row);
    }
  }

  return fields.map((field) =>
    normalizeSingle(field, rawByField.get(field.id)),
  );
}

function normalizeSingle(
  field: FieldDefinition,
  raw?: ModelFieldResult,
): NormalizedModelField {
  if (!raw) {
    return {
      field_id: field.id,
      status: "not_found",
      answer: null,
      normalized_value: null,
      confidence: null,
      evidence: null,
    };
  }

  const safeStatus = normalizeStatus(raw.status);
  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? raw.confidence
      : null;
  const evidence = typeof raw.evidence === "string" ? raw.evidence : null;

  const typed = normalizeByType(field.data_type, raw.answer);
  if (!typed.ok) {
    return {
      field_id: field.id,
      status: "invalid_type",
      answer: raw.answer ?? null,
      normalized_value: null,
      confidence,
      evidence,
    };
  }

  return {
    field_id: field.id,
    status:
      safeStatus === "ok"
        ? "ok"
        : typed.value === null
          ? "not_found"
          : safeStatus,
    answer: typed.value,
    normalized_value: typed.normalized,
    confidence,
    evidence,
  };
}

function normalizeStatus(
  input: string,
): "ok" | "not_found" | "invalid_type" | "unreadable" | "error" {
  if (
    input === "ok" ||
    input === "not_found" ||
    input === "invalid_type" ||
    input === "unreadable"
  ) {
    return input;
  }
  return "error";
}

function normalizeByType(
  dataType: DataType,
  value: unknown,
): { ok: boolean; value: unknown; normalized: string | null } {
  if (value === null || value === undefined) {
    return { ok: true, value: null, normalized: null };
  }

  switch (dataType) {
    case "string":
      return typeof value === "string"
        ? { ok: true, value, normalized: value }
        : { ok: false, value: null, normalized: null };
    case "number": {
      const num =
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? Number(value.replace(/[^\d.-]/g, ""))
            : Number.NaN;
      return Number.isFinite(num)
        ? { ok: true, value: num, normalized: String(num) }
        : { ok: false, value: null, normalized: null };
    }
    case "boolean": {
      if (typeof value === "boolean")
        return { ok: true, value, normalized: String(value) };
      if (typeof value === "string") {
        const lower = value.trim().toLowerCase();
        if (lower === "true" || lower === "yes")
          return { ok: true, value: true, normalized: "true" };
        if (lower === "false" || lower === "no")
          return { ok: true, value: false, normalized: "false" };
      }
      return { ok: false, value: null, normalized: null };
    }
    case "date": {
      if (typeof value !== "string")
        return { ok: false, value: null, normalized: null };
      const formatted = formatDateAnswer(value);
      if (!formatted)
        return { ok: false, value: null, normalized: null };
      return { ok: true, value: formatted, normalized: formatted };
    }
    case "object": {
      const ok =
        typeof value === "object" && value !== null && !Array.isArray(value);
      return ok
        ? { ok: true, value, normalized: null }
        : { ok: false, value: null, normalized: null };
    }
    case "array": {
      return Array.isArray(value)
        ? { ok: true, value, normalized: null }
        : { ok: false, value: null, normalized: null };
    }
    case "array<object>": {
      if (
        Array.isArray(value) &&
        value.every(
          (item) => item && typeof item === "object" && !Array.isArray(item),
        )
      ) {
        return { ok: true, value, normalized: null };
      }

      const tableRows = extractRowsFromTableObject(value);
      if (tableRows) {
        return {
          ok: true,
          value: {
            ...(value as Record<string, unknown>),
            rows: tableRows,
          },
          normalized: null,
        };
      }

      return { ok: false, value: null, normalized: null };
    }
    default:
      return { ok: false, value: null, normalized: null };
  }
}

function formatDateAnswer(value: string): string | null {
  const raw = value.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    return raw;
  }

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (dateOnly) {
    return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  }

  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function extractRowsFromTableObject(value: unknown): Array<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const rows = (value as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) {
    return null;
  }

  const validRows = rows.every(
    (item) => item && typeof item === "object" && !Array.isArray(item),
  );

  if (!validRows) {
    return null;
  }

  return rows as Array<Record<string, unknown>>;
}
