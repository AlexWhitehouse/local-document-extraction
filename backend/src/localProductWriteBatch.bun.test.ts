import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitProductWrite } from "./localProductWriteBatch";
import { createLocalWorkspaceProductStore } from "./localWorkspaceProductStore";

test("shared durable commits isolate failed mutations and are visible after reopening", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "go-commit-"));
  const location = { stateDirectory, workspaceId: "workspace_batch" };
  const store = createLocalWorkspaceProductStore(location);
  const signal = new AbortController().signal;

  const insert = (id: string) => store.createTemplate({ templateId: id, name: id, description: null, fields: [], createdAt: new Date().toISOString() });

  try {
    const outcomes = await Promise.allSettled([
      commitProductWrite(store, signal, () => insert("first")),
      commitProductWrite(store, signal, () => { insert("rolled_back"); throw new Error("Reject this mutation"); }),
      commitProductWrite(store, signal, () => insert("last")),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    const reopened = createLocalWorkspaceProductStore(location);

    try {
      expect(reopened.getTemplate("first")).not.toBeNull();
      expect(reopened.getTemplate("last")).not.toBeNull();
      expect(reopened.getTemplate("rolled_back")).toBeNull();
    } finally { reopened.close(); }
  } finally { store.close(); await rm(stateDirectory, { recursive: true, force: true }); }
});

test("workspace cancellation before the commit batch prevents mutation", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "go-cancel-"));
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "workspace_cancel" });
  const controller = new AbortController();

  try {
    const pending = commitProductWrite(store, controller.signal, () => store.createTemplate({ templateId: "canceled", name: "Canceled", description: null, fields: [], createdAt: new Date().toISOString() }));
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(store.getTemplate("canceled")).toBeNull();
  } finally { store.close(); await rm(stateDirectory, { recursive: true, force: true }); }
});
