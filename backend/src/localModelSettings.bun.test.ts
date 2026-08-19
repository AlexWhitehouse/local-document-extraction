import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalApplication } from "./localApplication";
import type { LocalAuth } from "./localAuth";
import { createLocalModelSettings } from "./localModelSettings";

test("local model settings persist UI overrides without exposing the saved token", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-model-settings-"));
  const settingsPath = join(stateDirectory, "data", "model-gateway.json");

  try {
    const settings = await createLocalModelSettings({
      stateDirectory,
      environment: {
        AI_MODEL: "environment/model",
        LITELLM_KEY: "environment-token",
        MODEL_GATEWAY_ROUTE_LABEL: "environment-route.example",
        MODEL_GATEWAY_SEQUENTIAL_CALLS: "true",
        MODEL_GATEWAY_URL: "https://environment.example/v1",
        MODEL_SUPPORTS_PDF_INPUT: "false",
        MODEL_SUPPORTS_STRUCTURED_OUTPUT: "false",
      },
    });

    expect(settings.getPublicSettings()).toEqual({
      gateway_url: "https://environment.example/v1",
      model_name: "environment/model",
      has_api_key: true,
      sequential_calls: true,
      supports_pdf_input: false,
      supports_structured_output: false,
    });

    const updated = await settings.update({
      gatewayUrl: "http://127.0.0.1:11434/v1",
      modelName: "local/vision-model",
      apiKey: "local-secret-token",
      sequentialCalls: false,
      supportsPdfInput: true,
      supportsStructuredOutput: true,
    });

    expect(updated).toEqual({
      gateway_url: "http://127.0.0.1:11434/v1",
      model_name: "local/vision-model",
      has_api_key: true,
      sequential_calls: false,
      supports_pdf_input: true,
      supports_structured_output: true,
    });
    expect(updated).not.toHaveProperty("api_key");
    expect(settings.getConfiguration()).toMatchObject({
      AI_MODEL: "local/vision-model",
      LITELLM_KEY: "local-secret-token",
      MODEL_GATEWAY_ROUTE_LABEL: undefined,
      MODEL_GATEWAY_SEQUENTIAL_CALLS: "false",
      MODEL_GATEWAY_URL: "http://127.0.0.1:11434/v1",
      MODEL_SUPPORTS_PDF_INPUT: "true",
      MODEL_SUPPORTS_STRUCTURED_OUTPUT: "true",
    });
    expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);

    const reopened = await createLocalModelSettings({
      stateDirectory,
      environment: {
        AI_MODEL: "new-environment/model",
        LITELLM_KEY: "new-environment-token",
        MODEL_GATEWAY_URL: "https://new-environment.example/v1",
      },
    });
    expect(reopened.getPublicSettings()).toEqual(updated);

    await reopened.update({
      gatewayUrl: "http://127.0.0.1:11434/v1",
      modelName: "local/vision-model",
      apiKey: null,
    });
    const reopenedWithoutToken = await createLocalModelSettings({
      stateDirectory,
      environment: { LITELLM_KEY: "environment-token" },
    });
    expect(reopenedWithoutToken.getPublicSettings().has_api_key).toBe(false);
    expect(reopenedWithoutToken.getConfiguration().LITELLM_KEY).toBeUndefined();
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
      api_key: null,
      sequential_calls: false,
      supports_pdf_input: true,
      supports_structured_output: true,
    });
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("the authenticated model settings API validates updates and keeps tokens write-only", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-model-settings-api-"));
  const auth: LocalAuth = {
    handler: async () => new Response(null, { status: 404 }),
    getSession: async (request) => request.headers.get("cookie")
      ? { id: "user_ada", email: "ada@example.com", name: "Ada Lovelace" }
      : null,
  };

  try {
    const modelSettings = await createLocalModelSettings({
      stateDirectory,
      environment: {
        AI_MODEL: "default/model",
        MODEL_GATEWAY_URL: "https://gateway.example/v1",
      },
    });
    const application = createLocalApplication({ auth, modelSettings });

    const unauthorized = await application(
      new Request("http://127.0.0.1:8787/v1/settings/model"),
    );
    expect(unauthorized.status).toBe(401);

    const updated = await application(new Request(
      "http://127.0.0.1:8787/v1/settings/model",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: "session=local" },
        body: JSON.stringify({
          gateway_url: "http://localhost:1234/v1",
          model_name: "local/model",
          api_key: "write-only-token",
          sequential_calls: true,
          supports_pdf_input: false,
          supports_structured_output: false,
        }),
      },
    ));
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toEqual({
      gateway_url: "http://localhost:1234/v1",
      model_name: "local/model",
      has_api_key: true,
      sequential_calls: true,
      supports_pdf_input: false,
      supports_structured_output: false,
    });

    const read = await application(new Request(
      "http://127.0.0.1:8787/v1/settings/model",
      { headers: { cookie: "session=local" } },
    ));
    const readBody = await read.json();
    expect(readBody).toEqual({
      gateway_url: "http://localhost:1234/v1",
      model_name: "local/model",
      has_api_key: true,
      sequential_calls: true,
      supports_pdf_input: false,
      supports_structured_output: false,
    });
    expect(JSON.stringify(readBody)).not.toContain("write-only-token");

    const invalid = await application(new Request(
      "http://127.0.0.1:8787/v1/settings/model",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: "session=local" },
        body: JSON.stringify({
          gateway_url: "file:///tmp/model",
          model_name: "local/model",
        }),
      },
    ));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "invalid_gateway_url" },
    });

    const invalidCapability = await application(new Request(
      "http://127.0.0.1:8787/v1/settings/model",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: "session=local" },
        body: JSON.stringify({
          gateway_url: "http://localhost:1234/v1",
          model_name: "local/model",
          supports_pdf_input: "sometimes",
        }),
      },
    ));
    expect(invalidCapability.status).toBe(400);
    await expect(invalidCapability.json()).resolves.toMatchObject({
      error: { code: "invalid_supports_pdf_input" },
    });

    const invalidStructuredOutput = await application(new Request(
      "http://127.0.0.1:8787/v1/settings/model",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: "session=local" },
        body: JSON.stringify({
          gateway_url: "http://localhost:1234/v1",
          model_name: "local/model",
          supports_structured_output: "sometimes",
        }),
      },
    ));
    expect(invalidStructuredOutput.status).toBe(400);
    await expect(invalidStructuredOutput.json()).resolves.toMatchObject({
      error: { code: "invalid_supports_structured_output" },
    });
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
