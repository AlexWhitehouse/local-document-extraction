import { afterEach, describe, expect, it, mock } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

import type { FieldDefinition } from "../lib/types";
import {
  ExtractionCancelledError,
  getExtractionModelName,
  getModelGatewayRequestTimeoutMs,
  getModelGatewayRouteLabel,
  ModelGatewayRequestError,
  RetryableError,
  runExtraction,
  type ModelGatewayConfiguration,
} from "./modelGateway";

const fields: FieldDefinition[] = [
  {
    id: "patient_name",
    name: "Patient Name",
    description: "Patient name",
    data_type: "string",
  },
];

const originalFetch = globalThis.fetch;

function replaceFetch(fetchMock: unknown) {
  globalThis.fetch = fetchMock as typeof globalThis.fetch;
}

async function waitForMockCallCount(
  fetchMock: { mock: { calls: unknown[][] } },
  expectedCallCount: number,
  timeoutMs = 1_000,
) {
  const startedAt = performance.now();
  while (fetchMock.mock.calls.length !== expectedCallCount) {
    const elapsedMs = performance.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      throw new Error(
        `Timed out after ${Math.round(elapsedMs)}ms waiting for ${expectedCallCount} Model gateway call(s); observed ${fetchMock.mock.calls.length}.`,
      );
    }
    await Bun.sleep(5);
  }
}

function createEnv(overrides: Record<string, unknown> = {}): ModelGatewayConfiguration {
  return {
    LITELLM_KEY: "litellm-secret",
    MODEL_GATEWAY_URL: "https://litellm.example/proxy",
    MODEL_SUPPORTS_PDF_INPUT: "true",
    MODEL_SUPPORTS_STRUCTURED_OUTPUT: "true",
    MODEL_GATEWAY_REQUEST_TIMEOUT_MS: "300000",
    AI_MODEL: "claude-opus-configured",
    ...overrides,
  } as ModelGatewayConfiguration;
}

function stubGatewayResponse(payload: unknown, init: ResponseInit = {}) {
  const fetchMock = mock(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
      ...init,
    }),
  );
  replaceFetch(fetchMock);
  return fetchMock;
}

function successfulGatewayPayload(content: string = successfulModelJson()) {
  return {
    choices: [
      {
        message: {
          content,
        },
      },
    ],
  };
}

function successfulModelJson() {
  return JSON.stringify({
    results: [
      {
        field_id: "patient_name",
        status: "ok",
        answer: "Ada Lovelace",
      },
    ],
  });
}

function readGatewayRequest(fetchMock: ReturnType<typeof mock>, callIndex = 0) {
  const [url, init] = fetchMock.mock.calls[callIndex] as [string, RequestInit];
  return {
    url,
    init,
    body:
      typeof init.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : init.body,
  };
}

describe("runExtraction", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses the configured Extraction model and LiteLLM gateway", async () => {
    const env = createEnv();
    const fetchMock = stubGatewayResponse(successfulGatewayPayload());

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "image/png"),
    ).resolves.toEqual([
      {
        field_id: "patient_name",
        status: "ok",
        answer: "Ada Lovelace",
      },
    ]);

    const request = readGatewayRequest(fetchMock);
    expect(request.url).toBe("https://litellm.example/proxy/chat/completions");
    expect(request.init).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer litellm-secret",
        "content-type": "application/json",
      },
    });
    expect(request.body).toMatchObject({
      model: "claude-opus-configured",
      response_format: { type: "json_object" },
    });
  });

  it("omits structured output for models that do not support response formats", async () => {
    const env = createEnv({ MODEL_SUPPORTS_STRUCTURED_OUTPUT: "false" });
    const fetchMock = stubGatewayResponse(successfulGatewayPayload());

    await runExtraction(
      env,
      fields,
      new Uint8Array([1, 2, 3]).buffer,
      "image/png",
    );

    const request = readGatewayRequest(fetchMock);
    expect(request.body).toMatchObject({ model: "claude-opus-configured" });
    expect(request.body).not.toHaveProperty("response_format");
  });

  it("uses JSON Schema output for Gemma 4 model deployments", async () => {
    const env = createEnv({ AI_MODEL: "google/gemma-4-e4b" });
    const fetchMock = stubGatewayResponse(successfulGatewayPayload());

    await runExtraction(
      env,
      fields,
      new Uint8Array([1, 2, 3]).buffer,
      "image/png",
    );

    expect(readGatewayRequest(fetchMock).body).toMatchObject({
      model: "google/gemma-4-e4b",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extraction_results",
          strict: true,
          schema: {
            required: ["results"],
          },
        },
      },
    });
  });

  it("aborts model gateway execution when Workspace deletion cancels the caller signal", async () => {
    const controller = new AbortController();
    const fetchMock = mock((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      (init.signal as AbortSignal).addEventListener("abort", () => {
        reject(new DOMException("cancelled", "AbortError"));
      }, { once: true });
    }));
    replaceFetch(fetchMock);

    const extraction = runExtraction(
      createEnv(),
      fields,
      new Uint8Array([1, 2, 3]).buffer,
      "image/png",
      controller.signal,
    );
    await waitForMockCallCount(fetchMock, 1);
    controller.abort();

    await expect(extraction).rejects.toBeInstanceOf(ExtractionCancelledError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses an absent model instead of inheriting a default", async () => {
    const fetchMock = stubGatewayResponse(successfulGatewayPayload());
    await expect(runExtraction(createEnv({ AI_MODEL: undefined }), fields, new Uint8Array([1]).buffer, "image/png")).rejects.toThrow(ModelGatewayRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits PDF Source files to Bedrock-compatible LiteLLM models as inline file content", async () => {
    const env = createEnv();
    const fetchMock = stubGatewayResponse(successfulGatewayPayload());

    await runExtraction(
      env,
      fields,
      new Uint8Array([1, 2, 3]).buffer,
      "application/pdf",
    );

    const request = readGatewayRequest(fetchMock);
    expect(request.url).toBe("https://litellm.example/proxy/chat/completions");
    expect(request.body).toMatchObject({
      messages: [
        expect.objectContaining({ role: "system", content: expect.any(String) }),
        {
          role: "user",
          content: [
            expect.objectContaining({ type: "text", text: expect.any(String) }),
            {
              type: "file",
              file: {
                file_data: "data:application/pdf;base64,AQID",
                format: "application/pdf",
              },
            },
          ],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders PDF Source file pages as images when direct PDF input is disabled", async () => {
    const env = createEnv({
      AI_MODEL: "google/gemma-4-e4b",
      MODEL_SUPPORTS_PDF_INPUT: "false",
    });
    const fetchMock = stubGatewayResponse(successfulGatewayPayload());
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([300, 200]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Patient: Ada Lovelace", { x: 30, y: 120, size: 18, font });
    const pdfBytes = await pdf.save();

    await runExtraction(
      env,
      fields,
      Uint8Array.from(pdfBytes).buffer,
      "application/pdf",
    );

    const request = readGatewayRequest(fetchMock);
    const requestBody = request.body as Record<string, unknown>;
    const userMessage = (requestBody.messages as Array<{
      content: Array<Record<string, unknown>>;
    }>)[1];
    const imageUrl = (userMessage.content[1].image_url as { url: string }).url;
    expect(request.body).toMatchObject({
      messages: [
        expect.any(Object),
        {
          role: "user",
          content: [
            expect.objectContaining({ type: "text", text: expect.any(String) }),
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
    });
    expect(userMessage.content[1]).toEqual({
      type: "image_url",
      image_url: {
        url: imageUrl,
      },
    });
    expect(imageUrl).toMatch(/^data:image\/png;base64,/);
  });

  it.each([
    "qwen/qwen3.6-27b",
    "qwen3.8-27b-mlx",
    "qwen3-vl-32b-instruct-mlx",
  ])("renders PDF Source file pages as image content accepted by Qwen model %s", async (model) => {
    const env = createEnv({
      AI_MODEL: model,
      MODEL_SUPPORTS_PDF_INPUT: "false",
    });
    const fetchMock = stubGatewayResponse(successfulGatewayPayload());
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([300, 200]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Patient: Ada Lovelace", { x: 30, y: 120, size: 18, font });
    const pdfBytes = await pdf.save();

    await runExtraction(
      env,
      fields,
      Uint8Array.from(pdfBytes).buffer,
      "application/pdf",
    );

    const request = readGatewayRequest(fetchMock);
    expect(request.body).toMatchObject({
      model,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extraction_results",
          strict: true,
          schema: { required: ["results"] },
        },
      },
      messages: [
        expect.any(Object),
        {
          role: "user",
          content: [
            expect.objectContaining({ type: "text", text: expect.any(String) }),
            {
              type: "image_url",
              image_url: {
                url: expect.stringMatching(/^data:image\/png;base64,/),
              },
            },
          ],
        },
      ],
    });
  });

  it("builds Qwen JSON Schema answer types from the requested Template fields", async () => {
    const env = createEnv({ AI_MODEL: "qwen/qwen3.6-27b" });
    const fetchMock = stubGatewayResponse(successfulGatewayPayload());
    const typedFields: FieldDefinition[] = [
      fields[0],
      {
        id: "total_amount",
        name: "Total Amount",
        description: "Invoice total.",
        data_type: "number",
      },
      {
        id: "approved",
        name: "Approved",
        description: "Whether the invoice was approved.",
        data_type: "boolean",
      },
      {
        id: "line_items",
        name: "Line Items",
        description: [
          "Invoice line items.",
          "[[OBJECT_SCHEMA]]",
          JSON.stringify({
            mode: "table",
            data_type: "array<object>",
            columns: [
              { key: "description", data_type: "string" },
              { key: "amount", data_type: "number" },
            ],
          }),
          "[[/OBJECT_SCHEMA]]",
        ].join("\n"),
        data_type: "array<object>",
      },
    ];

    await runExtraction(
      env,
      typedFields,
      new Uint8Array([1, 2, 3]).buffer,
      "image/png",
    );

    const requestBody = readGatewayRequest(fetchMock).body as {
      response_format: {
        json_schema: {
          schema: {
            properties: {
              results: {
                items: {
                  properties: {
                    answer: { anyOf: Array<Record<string, unknown>> };
                  };
                };
              };
            };
          };
        };
      };
    };
    const answerSchemas =
      requestBody.response_format.json_schema.schema.properties.results.items
        .properties.answer.anyOf;
    expect(answerSchemas).toEqual(
      expect.arrayContaining([
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "null" },
      ]),
    );
    expect(answerSchemas.find((schema) => schema.type === "object")).toMatchObject({
      properties: {
        rows: {
          items: {
            properties: {
              description: { type: ["string", "null"] },
              amount: { type: ["number", "null"] },
            },
            required: ["description", "amount"],
            additionalProperties: false,
          },
        },
      },
    });
  });

  it("never uses managed files or model-prefix inference for PDF input", async () => {
    for (const model of ["azure/gpt", "azure_ai/gpt", "custom/alias"]) {
      const fetchMock = stubGatewayResponse(successfulGatewayPayload());
      await runExtraction(createEnv({ AI_MODEL: model, MODEL_GATEWAY_USE_MANAGED_FILES: "true" }), fields, new Uint8Array([1, 2, 3]).buffer, "application/pdf");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(readGatewayRequest(fetchMock).url).toBe("https://litellm.example/proxy/chat/completions");
      expect(readGatewayRequest(fetchMock).body).toMatchObject({ messages: [expect.any(Object), { role: "user", content: [expect.any(Object), { type: "file", file: { file_data: "data:application/pdf;base64,AQID", format: "application/pdf" } }] }] });
    }
  });

  it("submits image Source files to LiteLLM as inline image content", async () => {
    const env = createEnv();
    const fetchMock = stubGatewayResponse(successfulGatewayPayload());

    await runExtraction(
      env,
      fields,
      new Uint8Array([4, 5, 6]).buffer,
      "image/png",
    );

    const request = readGatewayRequest(fetchMock);
    expect(request.body).toMatchObject({
      messages: [
        expect.any(Object),
        {
          role: "user",
          content: [
            expect.objectContaining({ type: "text", text: expect.any(String) }),
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,BAUG",
              },
            },
          ],
        },
      ],
    });
  });

  it("parses OpenAI-style model responses into raw model field results", async () => {
    const env = createEnv();
    stubGatewayResponse(successfulGatewayPayload());

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "image/png"),
    ).resolves.toEqual([
      {
        field_id: "patient_name",
        status: "ok",
        answer: "Ada Lovelace",
      },
    ]);
  });

  it("parses OpenAI content-part model responses into raw model field results", async () => {
    const env = createEnv();
    stubGatewayResponse({
      choices: [
        {
          message: {
            content: [{ type: "text", text: successfulModelJson() }],
          },
        },
      ],
    });

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "image/png"),
    ).resolves.toEqual([
      {
        field_id: "patient_name",
        status: "ok",
        answer: "Ada Lovelace",
      },
    ]);
  });

  it("parses Qwen reasoning content when assistant content is empty", async () => {
    const env = createEnv({ AI_MODEL: "qwen/qwen3.6-27b" });
    stubGatewayResponse({
      choices: [
        {
          message: {
            content: "",
            reasoning_content: successfulModelJson(),
          },
        },
      ],
    });

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "image/png"),
    ).resolves.toEqual([
      {
        field_id: "patient_name",
        status: "ok",
        answer: "Ada Lovelace",
      },
    ]);
  });

  it("treats missing LiteLLM credentials as a non-retryable configuration failure", async () => {
    const env = createEnv({ LITELLM_KEY: undefined });
    const fetchMock = stubGatewayResponse(successfulGatewayPayload());

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "application/pdf"),
    ).rejects.toThrow(ModelGatewayRequestError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([2, 8])("overlaps %i rendered PDF gateway calls when sequential calls are disabled", async (count) => {
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    const source = Uint8Array.from(await pdf.save()).buffer;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = mock(async () => {
      await gate;
      return Response.json(successfulGatewayPayload());
    });
    replaceFetch(fetchMock);
    const env = createEnv({ MODEL_GATEWAY_SEQUENTIAL_CALLS: "false", MODEL_SUPPORTS_PDF_INPUT: "false" });
    const calls = [runExtraction(env, fields, source.slice(0), "application/pdf")];
    try {
      await waitForMockCallCount(fetchMock, 1);
      for (let i = 1; i < count; i++) {
        calls.push(runExtraction(env, fields, source.slice(0), "application/pdf"));
      }
      await waitForMockCallCount(fetchMock, count);
      expect(fetchMock).toHaveBeenCalledTimes(count);
    } finally {
      release();
      await Promise.all(calls);
    }
  });

  it.each(["image/png", "application/pdf"])("runs configured %s model calls sequentially", async (sourceMimeType) => {
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    const source = sourceMimeType === "application/pdf"
      ? Uint8Array.from(await pdf.save()).buffer
      : new Uint8Array([1, 2, 3]).buffer;
    let releaseFirstRequest: (() => void) | undefined;
    const firstRequestGate = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    let requestCount = 0;
    const fetchMock = mock(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        await firstRequestGate;
      }
      return new Response(JSON.stringify(successfulGatewayPayload()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    replaceFetch(fetchMock);
    const env = createEnv({ MODEL_GATEWAY_SEQUENTIAL_CALLS: "true", MODEL_SUPPORTS_PDF_INPUT: "false" });

    const first = runExtraction(
      env,
      fields,
      source.slice(0),
      sourceMimeType,
    );
    await waitForMockCallCount(fetchMock, 1);
    const second = runExtraction(
      env,
      fields,
      source.slice(0),
      sourceMimeType,
    );
    try {
      await Bun.sleep(25);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      releaseFirstRequest?.();
      await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats LiteLLM HTTP failures as retryable extraction failures", async () => {
    const env = createEnv();
    stubGatewayResponse(
      { error: { message: "rate limited" } },
      { status: 429, headers: { "retry-after": "7" } },
    );

    const failure = await runExtraction(
      env,
      fields,
      new Uint8Array([1, 2, 3]).buffer,
      "image/png",
    ).catch((error) => error);
    expect(failure).toBeInstanceOf(RetryableError);
    expect(failure).toMatchObject({ status: 429, retryAfterMs: 7_000 });
    expect(failure.message).toBe("Model gateway request failed with HTTP 429");
  });

  it("does not retry deterministic Model gateway request failures", async () => {
    const env = createEnv();
    stubGatewayResponse(
      { error: { message: "invalid request" } },
      { status: 400 },
    );

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "image/png"),
    ).rejects.toThrow(ModelGatewayRequestError);
  });

  it("does not follow gateway redirects or consume their error bodies", async () => {
    const fetchMock = mock(async () => new Response(new ReadableStream({
      pull(controller) { controller.error(new Error("sensitive-upstream-body")); },
    }), { status: 302, headers: { location: "https://different-gateway.invalid" } }));
    replaceFetch(fetchMock);
    const failure = await runExtraction(createEnv(), fields, new Uint8Array([1, 2, 3]).buffer, "image/png").catch((error) => error);
    expect(failure).toBeInstanceOf(ModelGatewayRequestError);
    expect(failure.message).toBe("Model gateway request failed with HTTP 302");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toMatchObject(["https://litellm.example/proxy/chat/completions", { redirect: "manual" }]);
  });

  it("treats deterministic inline PDF request failures as non-retryable", async () => {
    const env = createEnv({ AI_MODEL: "azure_ai/gpt-configured" });
    const fetchMock = stubGatewayResponse(
      { error: { message: "file upload rejected" } },
      { status: 400 },
    );

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "application/pdf"),
    ).rejects.toThrow(ModelGatewayRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats invalid gateway JSON as retryable output", async () => {
    const env = createEnv();
    replaceFetch(
      mock(async () => new Response("not json", { status: 200 })),
    );

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "image/png"),
    ).rejects.toThrow("Model gateway returned invalid JSON");
  });

  it("treats invalid model JSON content as retryable output", async () => {
    const env = createEnv();
    stubGatewayResponse(successfulGatewayPayload("not json"));

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "image/png"),
    ).rejects.toThrow("Model response content was not valid JSON");
  });

  it("treats model JSON without results as retryable output", async () => {
    const env = createEnv();
    stubGatewayResponse(successfulGatewayPayload(JSON.stringify({})));

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "image/png"),
    ).rejects.toThrow("Model JSON missing results array");
  });
});

describe("model gateway configuration", () => {
  it("derives the model gateway route label only from the URL host", () => {
    expect(getModelGatewayRouteLabel(createEnv())).toBe("litellm.example");
    expect(getModelGatewayRouteLabel(createEnv({ MODEL_GATEWAY_ROUTE_LABEL: "ignored-global-label" }))).toBe("litellm.example");
    expect(() => getModelGatewayRouteLabel(createEnv({ MODEL_GATEWAY_URL: "not a url" }))).toThrow();
  });

  it("normalizes model gateway timeout configuration", () => {
    expect(getModelGatewayRequestTimeoutMs(createEnv({ MODEL_GATEWAY_REQUEST_TIMEOUT_MS: "120000" }))).toBe(120_000);
    expect(getModelGatewayRequestTimeoutMs(createEnv({ MODEL_GATEWAY_REQUEST_TIMEOUT_MS: "bad" }))).toBe(300_000);
    expect(getModelGatewayRequestTimeoutMs(createEnv({ MODEL_GATEWAY_REQUEST_TIMEOUT_MS: "-1" }))).toBe(300_000);
  });

  it("rejects missing Extraction model configuration", () => {
    expect(() => getExtractionModelName(createEnv({ AI_MODEL: undefined }))).toThrow(ModelGatewayRequestError);
  });
});
