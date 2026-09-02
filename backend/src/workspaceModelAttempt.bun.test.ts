import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { createLocalExtractionRunner } from "./localExtractionRunner";
import { configureTestWorkspace } from "./testing/workspaceModelFixture";

test("each claimed attempt checks configuration before reading Source bytes, without gateway retries or outcomes", async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), "workspace-model-attempt-"));
  const workspaceId = "workspace_a";
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  let sourceReads = 0;
  let extractions = 0;
  let retries = 0;
  const gatewayOutcomes: string[] = [];
  const runner = createLocalExtractionRunner({ stateDirectory, sourceFileStore: {
    read: async () => { sourceReads += 1; return new Uint8Array([1]); }, write: async () => "unused", delete: async () => {}, eraseWorkspace: async () => {},
  }, extract: async () => { extractions += 1; return []; }, scheduleJob: async () => { retries += 1; }, onGatewayOutcome: (outcome) => gatewayOutcomes.push(outcome) });
  try {
    for (const [id, errorCode] of [["absent", "workspace_model_not_configured"], ["unreadable", "workspace_model_configuration_unavailable"]]) {
      if (id === "unreadable") {
        configureTestWorkspace({ stateDirectory, workspaceId });
        rmSync(join(stateDirectory, "secrets", "model-gateway.key"));
      }
      store.createQueuedExtractionJob({ jobId: id!, templateId: "tpl", templateVersion: 1, sourceFileKey: `source/${id}`, sourceMimeType: "image/png", sourceName: "source.png", sourceFilePageCount: null, submittedAt: "2026-09-02T00:00:00Z" });
      await runner.run({ job_id: id!, workspace_id: workspaceId, template_id: "tpl", template_version: 1, enqueued_at: "2026-09-02T00:00:00Z" });
      expect(store.getExtractionJob(id!)).toMatchObject({ status: "failed", error_code: errorCode, current_attempt: 1, model_configuration_revision: null });
    }
    expect({ sourceReads, extractions, retries, gatewayOutcomes }).toEqual({ sourceReads: 0, extractions: 0, retries: 0, gatewayOutcomes: [] });
    expect(store.listRetainedTerminalSourceFiles({ failedBefore: "9999-01-01" })).toHaveLength(2);
  } finally { store.close(); rmSync(stateDirectory, { recursive: true, force: true }); }
});

test("an in-flight attempt keeps its configuration snapshot when the Workspace is cleared", async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), "workspace-model-snapshot-"));
  const workspaceId = "workspace_a";
  const initial = configureTestWorkspace({ stateDirectory, workspaceId, modelName: "initial/model" });
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  try {
    store.createQueuedExtractionJob({ jobId: "job", templateId: "tpl", templateVersion: 1, sourceFileKey: "source/job", sourceMimeType: "image/png", sourceName: "source.png", sourceFilePageCount: null, submittedAt: "2026-09-02T00:00:00Z" });
    const runner = createLocalExtractionRunner({ stateDirectory, sourceFileStore: {
      read: async () => { expect(store.clearModelConfiguration(initial.revision)).toBe(true); return new Uint8Array([1]); }, write: async () => "unused", delete: async () => {}, eraseWorkspace: async () => {},
    }, extract: async () => [] });
    await runner.run({ job_id: "job", workspace_id: workspaceId, template_id: "tpl", template_version: 1, enqueued_at: "2026-09-02T00:00:00Z" });
    expect(store.getModelConfiguration()).toBeNull();
    expect(store.getExtractionJob("job")).toMatchObject({ status: "completed", model_name: "initial/model", model_configuration_revision: initial.revision });
  } finally { store.close(); rmSync(stateDirectory, { recursive: true, force: true }); }
});
