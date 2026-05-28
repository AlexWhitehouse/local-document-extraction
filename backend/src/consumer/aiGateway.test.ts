import { describe, expect, it, vi } from "vitest";

import type { FieldDefinition } from "../lib/types";
import { RetryableError, runExtraction } from "./aiGateway";

const fields: FieldDefinition[] = [
  {
    id: "patient_name",
    name: "Patient Name",
    description: "Patient name",
    data_type: "string",
  },
];

function createEnv(overrides: Record<string, unknown> = {}) {
  const run = vi.fn(async () => ({
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                results: [
                  {
                    field_id: "patient_name",
                    status: "ok",
                    answer: "Ada Lovelace",
                  },
                ],
              }),
            },
          ],
        },
      },
    ],
  }));

  const env = {
    AI: { run },
    AI_GATEWAY_ID: "configured-gateway",
    AI_GATEWAY_REQUEST_TIMEOUT_MS: "300000",
    AI_MODEL: "google/gemini-configured",
    ...overrides,
  } as unknown as Env;

  return { env, run };
}

describe("runExtraction", () => {
  it("uses the configured Extraction model for Gemini extraction", async () => {
    const { env, run } = createEnv();

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "application/pdf"),
    ).resolves.toEqual([
      {
        field_id: "patient_name",
        status: "ok",
        answer: "Ada Lovelace",
      },
    ]);

    expect(run).toHaveBeenCalledWith(
      "google/gemini-configured",
      expect.any(Object),
      {
        gateway: {
          id: "configured-gateway",
          requestTimeoutMs: 300_000,
        },
      },
    );
  });

  it("falls back to the agreed Gemini model when no Extraction model is configured", async () => {
    const { env, run } = createEnv({ AI_MODEL: undefined });

    await runExtraction(
      env,
      fields,
      new Uint8Array([1, 2, 3]).buffer,
      "application/pdf",
    );

    expect(run).toHaveBeenCalledWith(
      "google/gemini-3-flash",
      expect.any(Object),
      {
        gateway: {
          id: "configured-gateway",
          requestTimeoutMs: 300_000,
        },
      },
    );
  });

  it("falls back to the default AI Gateway identifier when none is configured", async () => {
    const { env, run } = createEnv({ AI_GATEWAY_ID: undefined });

    await runExtraction(
      env,
      fields,
      new Uint8Array([1, 2, 3]).buffer,
      "application/pdf",
    );

    expect(run).toHaveBeenCalledWith(
      "google/gemini-configured",
      expect.any(Object),
      {
        gateway: {
          id: "default",
          requestTimeoutMs: 300_000,
        },
      },
    );
  });

  it("passes the configured AI Gateway request timeout", async () => {
    const { env, run } = createEnv({
      AI_GATEWAY_REQUEST_TIMEOUT_MS: "120000",
    });

    await runExtraction(
      env,
      fields,
      new Uint8Array([1, 2, 3]).buffer,
      "application/pdf",
    );

    expect(run).toHaveBeenCalledWith(
      "google/gemini-configured",
      expect.any(Object),
      {
        gateway: {
          id: "configured-gateway",
          requestTimeoutMs: 120_000,
        },
      },
    );
  });

  it("submits PDF Source files to Gemini as inline source content", async () => {
    const { env, run } = createEnv();

    await runExtraction(
      env,
      fields,
      new Uint8Array([1, 2, 3]).buffer,
      "application/pdf",
    );

    expect(run).toHaveBeenCalledWith(
      "google/gemini-configured",
      expect.objectContaining({
        contents: [
          expect.objectContaining({
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ text: expect.any(String) }),
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: "AQID",
                },
              },
            ]),
          }),
        ],
      }),
      {
        gateway: {
          id: "configured-gateway",
          requestTimeoutMs: 300_000,
        },
      },
    );
  });

  it("submits image Source files to Gemini as inline source content", async () => {
    const { env, run } = createEnv();

    await runExtraction(
      env,
      fields,
      new Uint8Array([4, 5, 6]).buffer,
      "image/png",
    );

    expect(run).toHaveBeenCalledWith(
      "google/gemini-configured",
      expect.objectContaining({
        contents: [
          expect.objectContaining({
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({ text: expect.any(String) }),
              {
                inlineData: {
                  mimeType: "image/png",
                  data: "BAUG",
                },
              },
            ]),
          }),
        ],
      }),
      {
        gateway: {
          id: "configured-gateway",
          requestTimeoutMs: 300_000,
        },
      },
    );
  });

  it("parses direct text model responses into raw model field results", async () => {
    const { env } = createEnv();
    vi.mocked(env.AI.run).mockResolvedValueOnce({
      text: JSON.stringify({
        results: [
          {
            field_id: "patient_name",
            status: "ok",
            answer: "Ada Lovelace",
          },
        ],
      }),
    });

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "application/pdf"),
    ).resolves.toEqual([
      {
        field_id: "patient_name",
        status: "ok",
        answer: "Ada Lovelace",
      },
    ]);
  });

  it("treats OpenAI-style model responses as unreadable retryable output", async () => {
    const { env } = createEnv();
    vi.mocked(env.AI.run).mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              results: [
                {
                  field_id: "patient_name",
                  status: "ok",
                  answer: "Ada Lovelace",
                },
              ],
            }),
          },
        },
      ],
    });

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "application/pdf"),
    ).rejects.toThrow(RetryableError);
  });

  it("treats Anthropic-style model responses as unreadable retryable output", async () => {
    const { env } = createEnv();
    vi.mocked(env.AI.run).mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            results: [
              {
                field_id: "patient_name",
                status: "ok",
                answer: "Ada Lovelace",
              },
            ],
          }),
        },
      ],
    });

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "application/pdf"),
    ).rejects.toThrow(RetryableError);
  });

  it("treats invalid JSON model content as retryable output", async () => {
    const { env } = createEnv();
    vi.mocked(env.AI.run).mockResolvedValueOnce({ text: "not json" });

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "application/pdf"),
    ).rejects.toThrow(RetryableError);
  });

  it("treats model JSON without results as retryable output", async () => {
    const { env } = createEnv();
    vi.mocked(env.AI.run).mockResolvedValueOnce({ text: JSON.stringify({}) });

    await expect(
      runExtraction(env, fields, new Uint8Array([1, 2, 3]).buffer, "application/pdf"),
    ).rejects.toThrow(RetryableError);
  });
});
