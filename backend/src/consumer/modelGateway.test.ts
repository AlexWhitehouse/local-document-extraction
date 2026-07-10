import { afterEach, describe, expect, it, vi } from "vitest";

import type { FieldDefinition } from "../lib/types";
import {
  ExtractionCancelledError,
  getExtractionModelName,
  getModelGatewayRequestTimeoutMs,
  getModelGatewayRouteLabel,
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

function createEnv(overrides: Record<string, unknown> = {}): ModelGatewayConfiguration {
  return {
    LITELLM_KEY: "litellm-secret",
    MODEL_GATEWAY_URL: "https://litellm.example/proxy",
    MODEL_GATEWAY_ROUTE_LABEL: "litellm.example",
    MODEL_GATEWAY_REQUEST_TIMEOUT_MS: "300000",
    AI_MODEL: "claude-opus-configured",
    ...overrides,
  } as ModelGatewayConfiguration;
}

function stubGatewayResponse(payload: unknown, init: ResponseInit = {}) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
      ...init,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubGatewayResponses(
  responses: Array<{ payload: unknown; init?: ResponseInit }>,
) {
  const pending = [...responses];
  const fetchMock = vi.fn(async () => {
    const next = pending.shift();
    if (!next) {
      throw new Error("Unexpected fetch call");
    }
    return new Response(JSON.stringify(next.payload), {
      status: 200,
      headers: { "content-type": "application/json" },
      ...next.init,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
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

function readGatewayRequest(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0) {
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
    vi.unstubAllGlobals();
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

  it("aborts model gateway execution when Workspace deletion cancels the caller signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      (init.signal as AbortSignal).addEventListener("abort", () => {
        reject(new DOMException("cancelled", "AbortError"));
      }, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const extraction = runExtraction(
      createEnv(),
      fields,
      new Uint8Array([1, 2, 3]).buffer,
      "image/png",
      controller.signal,
    );
    controller.abort();

    await expect(extraction).rejects.toBeInstanceOf(ExtractionCancelledError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to the agreed Bedrock Claude model when no Extraction model is configured", async () => {
    const env = createEnv({ AI_MODEL: undefined });
    const fetchMock = stubGatewayResponse(successfulGatewayPayload());

    await runExtraction(
      env,
      fields,
      new Uint8Array([1, 2, 3]).buffer,
      "image/png",
    );

    expect(readGatewayRequest(fetchMock).body).toMatchObject({
      model: "claude-opus-4-7",
    });
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

  it("uploads PDF Source files for Azure LiteLLM models and submits the returned file ID", async () => {
    const env = createEnv({ AI_MODEL: "azure_ai/gpt-configured" });
    const fetchMock = stubGatewayResponses([
      { payload: { id: "file_pdf_123" } },
      { payload: successfulGatewayPayload() },
      { payload: { deleted: true } },
    ]);

    await runExtraction(
      env,
      fields,
      new Uint8Array([1, 2, 3]).buffer,
      "application/pdf",
    );

    const uploadRequest = readGatewayRequest(fetchMock, 0);
    expect(uploadRequest.url).toBe("https://litellm.example/proxy/files");
    expect(uploadRequest.init).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer litellm-secret",
      },
    });
    const uploadBody = uploadRequest.init.body as FormData;
    expect(uploadBody.get("purpose")).toBe("user_data");
    expect(uploadBody.get("model")).toBe("azure_ai/gpt-configured");
    expect(uploadBody.get("target_model_names")).toBe("azure_ai/gpt-configured");
    const uploadedFile = uploadBody.get("file") as File;
    expect(uploadedFile.name).toBe("source.pdf");
    expect(uploadedFile.type).toBe("application/pdf");

    const chatRequest = readGatewayRequest(fetchMock, 1);
    expect(chatRequest.url).toBe("https://litellm.example/proxy/chat/completions");
    expect(chatRequest.body).toMatchObject({
      messages: [
        expect.objectContaining({ role: "system", content: expect.any(String) }),
        {
          role: "user",
          content: [
            expect.objectContaining({ type: "text", text: expect.any(String) }),
            {
              type: "file",
              file: {
                file_id: "file_pdf_123",
                format: "application/pdf",
              },
            },
          ],
        },
      ],
    });

    const deleteRequest = readGatewayRequest(fetchMock, 2);
    expect(deleteRequest.url).toBe("https://litellm.example/proxy/files/file_pdf_123");
    expect(deleteRequest.init).toMatchObject({
      method: "DELETE",
      headers: {
        authorization: "Bearer litellm-secret",
      },
    });
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
                format: "image/png",
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

  it("treats missing LiteLLM credentials as a retryable extraction failure", async () => {
    const env = createEnv({ LITELLM_KEY: undefined });
    const fetchMock = stubGatewayResponse(successfulGatewayPayload());

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "application/pdf"),
    ).rejects.toThrow(RetryableError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats LiteLLM HTTP failures as retryable extraction failures", async () => {
    const env = createEnv();
    stubGatewayResponse(
      { error: { message: "rate limited" } },
      { status: 429 },
    );

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "image/png"),
    ).rejects.toThrow("Model gateway request failed with HTTP 429: rate limited");
  });

  it("treats LiteLLM PDF upload failures as retryable extraction failures", async () => {
    const env = createEnv({ AI_MODEL: "azure_ai/gpt-configured" });
    const fetchMock = stubGatewayResponse(
      { error: { message: "file upload rejected" } },
      { status: 400 },
    );

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "application/pdf"),
    ).rejects.toThrow("Model gateway file upload failed with HTTP 400: file upload rejected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats invalid gateway JSON as retryable output", async () => {
    const env = createEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
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
  it("derives the model gateway route label from configured label or URL host", () => {
    expect(getModelGatewayRouteLabel(createEnv())).toBe("litellm.example");
    expect(getModelGatewayRouteLabel(createEnv({ MODEL_GATEWAY_ROUTE_LABEL: undefined }))).toBe("litellm.example");
    expect(getModelGatewayRouteLabel(createEnv({ MODEL_GATEWAY_URL: "not a url", MODEL_GATEWAY_ROUTE_LABEL: undefined }))).toBe("litellm.t3m.uk");
  });

  it("normalizes model gateway timeout configuration", () => {
    expect(getModelGatewayRequestTimeoutMs(createEnv({ MODEL_GATEWAY_REQUEST_TIMEOUT_MS: "120000" }))).toBe(120_000);
    expect(getModelGatewayRequestTimeoutMs(createEnv({ MODEL_GATEWAY_REQUEST_TIMEOUT_MS: "bad" }))).toBe(300_000);
    expect(getModelGatewayRequestTimeoutMs(createEnv({ MODEL_GATEWAY_REQUEST_TIMEOUT_MS: "-1" }))).toBe(300_000);
  });

  it("defaults to the agreed Bedrock Claude extraction model", () => {
    expect(getExtractionModelName(createEnv({ AI_MODEL: undefined }))).toBe("claude-opus-4-7");
  });
});
