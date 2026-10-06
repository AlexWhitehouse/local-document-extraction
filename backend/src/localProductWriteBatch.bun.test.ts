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

test("a full batch's window timer leaves the next batch its own window", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "go-window-"));
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "workspace_window" });
  const signal = new AbortController().signal;
  const timers: Array<() => void> = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalBatch = store.batch;

  if (!originalBatch) throw new Error("Workspace stores batch their writes");
  let depth = 0;
  let commits = 0;

  store.batch = (operation) => {
    if (!depth) commits++;
    depth++;

    try { return originalBatch(operation); } finally { depth--; }
  };

  const insert = (id: string) => commitProductWrite(store, signal, () => store.createTemplate({ templateId: id, name: id, description: null, fields: [], createdAt: new Date().toISOString() }));

  try {
    globalThis.setTimeout = Object.assign((handler: () => void) => {
      timers.push(handler);

      return 0;
    }, originalSetTimeout);
    const full = Promise.all(Array.from({ length: 64 }, (_, index) => insert(`full_${index}`)));
    const next = [insert("next_first")];
    globalThis.setTimeout = originalSetTimeout;
    await full;
    expect(commits).toBe(1);

    // The full batch's timer fires while the next batch is still collecting.
    timers[0]!();
    next.push(insert("next_second"));
    timers[1]!();
    await Promise.all(next);
    expect(commits).toBe(2);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    store.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
