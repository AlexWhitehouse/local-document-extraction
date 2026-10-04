import { textRequestBody } from "./testing/requestFixture";
import { workspaceControlFixture, workspaceFixture } from "./testing/workspaceControlFixture";
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalApplication } from "./localApplication";
import type { LocalAuth } from "./localAuth";

import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createLocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
import { configureTestWorkspace } from "./testing/workspaceModelFixture";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const proposal = {
  name: "Invoice",
  description: "Invoice details",
  fields: [{ name: "Total", description: "Total due", data_type: "number" }],
};

function fixture(configured = true, assistantModel?: string) {
  const stateDirectory = mkdtempSync(join(tmpdir(), "template-generation-"));
  cleanups.push(() => rmSync(stateDirectory, { force: true, recursive: true }));

  if (configured)
    configureTestWorkspace({
      stateDirectory,
      workspaceId: "workspace_a",
      modelName: "workspace-model",
      assistantModel: assistantModel
        ? { model_name: assistantModel, supports_pdf_input: true, supports_structured_output: true }
        : undefined,
    });
  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  cleanups.push(registry.closeAll);
  const operations = createLocalWorkspaceProductOperations();
  const workspace = workspaceFixture({ id: "workspace_a", name: "A", max_source_file_bytes: 100 });

  const workspaceControl = workspaceControlFixture({
    getAcceptedWorkspaceContext: ({ workspaceId, userId }: { workspaceId: string; userId: string }) =>
      workspaceId === workspace.id && userId === "member" ? { ...workspace, role: "member" } : null,
    authorizeApiKey: ({ apiKey }: { apiKey: string }) => (apiKey === "inbound" ? workspace : null),
    hasPendingStarterTemplateBootstrap: () => false,
  });

  const auth: LocalAuth = {
    handler: async () => new Response(null),
    getSession: async (request) => {
      const id = request.headers.get("cookie");

      return id ? { id, email: "test@example.com", name: "Test user" } : null;
    },
  };

  const application = createLocalApplication({
    stateDirectory,
    auth,
    workspaceControl,
    productStoreRegistry: registry,
    workspaceProductOperations: operations,
  });

  const submit = (
    options: { headers?: Record<string, string>; size?: number; mime?: string; signal?: AbortSignal } = {},
  ) => {
    const body = new FormData();
    body.set(
      "document",
      new File([new Uint8Array(options.size ?? 4)], "sample", { type: options.mime ?? "image/png" }),
    );
    body.set("instructions", "Capture totals");

    return application(
      new Request("http://localhost/v1/templates/generate", {
        method: "POST",
        body,
        signal: options.signal,
        headers: { cookie: "member", "x-workspace-id": workspace.id, ...options.headers },
      }),
    );
  };

  const files = () => {
    try {
      return readdirSync(join(stateDirectory, "temporary", "submissions"));
    } catch {
      return [];
    }
  };

  const mockGateway = (
    impl = async () => Response.json({ choices: [{ message: { content: JSON.stringify(proposal) } }] }),
  ) => {
    const mock = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(impl, { preconnect: globalThis.fetch.preconnect }),
    );

    cleanups.push(() => mock.mockRestore());

    return mock;
  };

  return { submit, registry, files, mockGateway, stateDirectory, operations };
}

test("generates under workspace credentials with no saved template/job and deletes its sample", async () => {
  const f = fixture();
  const fetch = f.mockGateway();
  const response = await f.submit();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject(proposal);
  expect(f.files()).toEqual([]);
  const body = JSON.parse(textRequestBody(fetch.mock.calls[0][1]!.body));
  expect(body.model).toBe("workspace-model");
  expect(new Headers(fetch.mock.calls[0][1]!.headers).get("authorization")).toBe("Bearer dummy-test-key");
  const lease = f.registry.acquire({ workspaceId: "workspace_a", mode: "existing" })!;

  try {
    expect(lease.store.listTemplates()).toEqual([]);
    expect(lease.store.listExtractionJobs({ limit: 10 })).toEqual([]);
  } finally {
    lease.release();
  }
});

test("Auto generate uses the Template assistant model when one is configured", async () => {
  const f = fixture(true, "assistant-model");
  const fetch = f.mockGateway();
  expect((await f.submit()).status).toBe(200);
  expect(JSON.parse(textRequestBody(fetch.mock.calls[0][1]!.body)).model).toBe("assistant-model");
});

test("checks workspace access and configuration before uploading a sample", async () => {
  const f = fixture(false);
  const fetch = f.mockGateway();
  expect((await f.submit()).status).toBe(409);
  expect((await f.submit({ headers: { cookie: "outsider" } })).status).toBe(403);
  expect((await f.submit({ headers: { "x-workspace-id": "other" } })).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
  expect(f.files()).toEqual([]);
});

test("rejects oversized, empty, unsupported, and unreadable PDF samples with cleanup", async () => {
  const f = fixture();
  const fetch = f.mockGateway();

  for (const options of [{ size: 101 }, { size: 0 }, { mime: "text/plain" }, { mime: "application/pdf" }]) {
    expect((await f.submit(options)).status).toBe(400);
    expect(f.files()).toEqual([]);
  }

  expect(fetch).not.toHaveBeenCalled();
});

test("four invalid responses produce a validation failure and remove the sample", async () => {
  const f = fixture();
  const fetch = f.mockGateway(async () => Response.json({ choices: [{ message: { content: "null" } }] }));
  const response = await f.submit();
  expect(response.status).toBe(422);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(f.files()).toEqual([]);
});

test("gateway failures do not leak upstream bodies and remove the sample", async () => {
  const f = fixture();
  const fetch = f.mockGateway(async () => new Response("sensitive provider details", { status: 401 }));
  const response = await f.submit();
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("sensitive provider");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(f.files()).toEqual([]);
});

test("aborting generation cancels the model request and removes the sample", async () => {
  const f = fixture();
  const controller = new AbortController();
  f.mockGateway(async () => {
    controller.abort();
    throw new DOMException("Cancelled", "AbortError");
  });
  expect((await f.submit({ signal: controller.signal })).status).toBe(499);
  expect(f.files()).toEqual([]);
});

test("workspace API keys authorize generation without a session", async () => {
  const f = fixture();
  f.mockGateway();
  expect(
    (await f.submit({ headers: { cookie: "", authorization: "Bearer inbound", "x-workspace-id": "" } })).status,
  ).toBe(200);
  expect((await f.submit({ headers: { authorization: "Bearer invalid" } })).status).toBe(403);
});

test("workspace deletion drains generation and its temporary sample", async () => {
  const f = fixture();
  let deletion: Promise<void> | undefined;
  f.mockGateway(async () => {
    deletion = f.operations.beginDeletion({ workspaceId: "workspace_a" });

    return Response.json({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
  });
  expect((await f.submit()).status).toBe(499);
  await deletion;
  expect(f.files()).toEqual([]);
  f.operations.completeDeletion({ workspaceId: "workspace_a" });
});
