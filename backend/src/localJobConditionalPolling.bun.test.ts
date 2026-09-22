import { configureTestWorkspace } from "./testing/workspaceModelFixture";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import {
  createLocalWorkspaceProductStore,
  type LocalWorkspaceProductStore,
} from "./localWorkspaceProductStore";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";

test("individual job reads use validators and hydrate results only for changed completed jobs", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-conditional-poll-"));
  const controlDatabase = new Database(":memory:");
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database: controlDatabase,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });
  const workspaceControl = createLocalWorkspaceControl(controlDatabase);
  const signUp = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Poll User", email: "poll@example.com", password: "Strong1!" }),
  }));
  const user = await signUp.json() as { user: { id: string; name: string } };
  const workspace = workspaceControl.listAcceptedWorkspaces({ userId: user.user.id, userName: user.user.name })[0]!;
  workspaceControl.completeStarterTemplateBootstrap({ workspaceId: workspace.id });
  configureTestWorkspace({ stateDirectory, workspaceId: workspace.id });
  const apiKey = workspaceControl.rotateApiKey({ workspaceId: workspace.id, userId: user.user.id }).api_key;
  const setupStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: workspace.id });
  setupStore.createTemplate({
    templateId: "tpl_poll",
    name: "Poll",
    description: null,
    fields: [{ id: "reference", name: "Reference", description: "Reference", data_type: "string" }],
    createdAt: "2026-08-16T12:00:00.000Z",
  });
  setupStore.createQueuedExtractionJob({
    jobId: "job_poll",
    templateId: "tpl_poll",
    templateVersion: 1,
    sourceFileKey: `workspaces/${workspace.id}/jobs/job_poll/source.pdf`,
    sourceMimeType: "application/pdf",
    sourceName: "poll.pdf",
    sourceFilePageCount: 2,
    submittedAt: "2026-08-16T12:01:00.000Z",
  });
  setupStore.close();

  let resultHydrations = 0;
  const registry = createLocalWorkspaceProductStoreRegistry({
    stateDirectory,
    createStore: instrumentedStore,
    openStore: instrumentedStore,
  });
  const application = createLocalApplication({ auth, productStoreRegistry: registry, stateDirectory, workspaceControl });
  const headers = { authorization: `Bearer ${apiKey}` };

  try {
    const queued = await application(new Request("http://127.0.0.1:8787/v1/jobs/job_poll", { headers }));
    expect(queued.status).toBe(200);
    expect(queued.headers.get("cache-control")).toBe("private, no-cache");
    expect(queued.headers.get("retry-after")).toBe("5");
    const queuedTag = queued.headers.get("etag")!;
    expect(queuedTag).toMatch(/^W\/"job-v1-[a-f0-9]{64}"$/);
    await expect(queued.json()).resolves.toMatchObject({ status: "queued", results: [] });
    expect(resultHydrations).toBe(0);

    const unchanged = await application(new Request("http://127.0.0.1:8787/v1/jobs/job_poll", {
      headers: { ...headers, "if-none-match": `W/"other", ${queuedTag}` },
    }));
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
    expect(unchanged.headers.get("etag")).toBe(queuedTag);
    expect(unchanged.headers.get("retry-after")).toBe("5");
    expect(resultHydrations).toBe(0);

    const lease = registry.acquire({ workspaceId: workspace.id })!;
    expect(lease.store.claimExtractionJobForProcessing({
      jobId: "job_poll",
      attempt: 1,
      claimedAt: "2026-08-16T12:02:00.000Z",
    })).not.toBeNull();
    expect(lease.store.recordExtractionJobModel({
      jobId: "job_poll",
      attempt: 1,
      modelName: "prototype/model",
      route: "prototype",
    })).toBe(true);
    expect(lease.store.completeExtractionJob({
      jobId: "job_poll",
      attempt: 1,
      completedAt: "2026-08-16T12:03:00.000Z",
      modelName: "prototype/model",
      route: "prototype",
      results: [{
        field_id: "reference",
        status: "ok",
        answer: "REF-1",
        normalized_value: "REF-1",
        confidence: 0.9,
        evidence: "REF-1",
      }],
    })).toBe(true);
    lease.release();

    const completed = await application(new Request("http://127.0.0.1:8787/v1/jobs/job_poll", {
      headers: { ...headers, "if-none-match": queuedTag },
    }));
    expect(completed.status).toBe(200);
    expect(completed.headers.get("etag")).not.toBe(queuedTag);
    expect(completed.headers.get("retry-after")).toBeNull();
    const completedTag = completed.headers.get("etag")!;
    await expect(completed.json()).resolves.toMatchObject({
      status: "completed",
      results: [{ field_id: "reference", answer: "REF-1" }],
    });
    expect(resultHydrations).toBe(1);

    const terminalUnchanged = await application(new Request("http://127.0.0.1:8787/v1/jobs/job_poll", {
      headers: { ...headers, "if-none-match": "*" },
    }));
    expect(terminalUnchanged.status).toBe(304);
    expect(terminalUnchanged.headers.get("etag")).toBe(completedTag);
    expect(terminalUnchanged.headers.get("retry-after")).toBeNull();
    expect(resultHydrations).toBe(1);

    const unauthorized = await application(new Request("http://127.0.0.1:8787/v1/jobs/job_poll", {
      headers: { "if-none-match": completedTag },
    }));
    expect(unauthorized.status).toBe(401);
  } finally {
    registry.closeAll();
    controlDatabase.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }

  function instrumentedStore(input: { stateDirectory: string; workspaceId: string }): LocalWorkspaceProductStore {
    const store = createLocalWorkspaceProductStore(input);
    return {
      ...store,
      getExtractionJobResults: (jobId) => {
        resultHydrations += 1;
        return store.getExtractionJobResults(jobId);
      },
    };
  }
});

test("accepted submissions direct clients to the job resource and initial delay", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-submission-location-"));
  const controlDatabase = new Database(":memory:");
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database: controlDatabase,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });
  const workspaceControl = createLocalWorkspaceControl(controlDatabase);
  const signUp = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Submit User", email: "submit@example.com", password: "Strong1!" }),
  }));
  const user = await signUp.json() as { user: { id: string; name: string } };
  const workspace = workspaceControl.listAcceptedWorkspaces({ userId: user.user.id, userName: user.user.name })[0]!;
  configureTestWorkspace({ stateDirectory, workspaceId: workspace.id });
  const apiKey = workspaceControl.rotateApiKey({ workspaceId: workspace.id, userId: user.user.id }).api_key;
  const application = createLocalApplication({ auth, stateDirectory, workspaceControl });

  try {
    const templates = await application(new Request("http://127.0.0.1:8787/v1/templates", {
      headers: { authorization: `Bearer ${apiKey}` },
    }));
    const templateId = ((await templates.json()) as { templates: Array<{ id: string }> }).templates[0]!.id;
    const form = new FormData();
    form.append("template_id", templateId);
    form.append("document", new File([new Uint8Array([137, 80, 78, 71])], "poll.png", { type: "image/png" }));
    const response = await application(new Request("http://127.0.0.1:8787/v1/extract", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    }));
    const queued = await response.json() as { job_id: string };
    expect(queued).toHaveProperty("job_id");
    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toBe(`/v1/jobs/${queued.job_id}`);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(response.headers.get("cache-control")).toBe("no-store");
  } finally {
    controlDatabase.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
