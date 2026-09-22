import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { createLocalAuth } from "./localAuth";
import { createLocalLiveUpdateHub } from "./localLiveUpdateHub";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceDeletion } from "./localWorkspaceDeletion";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";

test("Workspace deletion emits a privacy-safe Workspace access invalidation after revocation", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-delete-invalidation-"));
  const database = new Database(":memory:");
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });
  const workspaceControl = createLocalWorkspaceControl(database);
  const liveUpdateHub = createLocalLiveUpdateHub();
  const messages: string[] = [];

  try {
    const signUp = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
    }));
    const user = await signUp.json() as { user: { id: string; name: string } };
    const deletedWorkspace = workspaceControl.listAcceptedWorkspaces({ userId: user.user.id, userName: user.user.name })[0]!;
    workspaceControl.createWorkspace({ userId: user.user.id, name: "Remaining Workspace" });
    liveUpdateHub.subscribe({
      workspaceId: deletedWorkspace.id,
      socket: { send: (message) => messages.push(message) },
    });

    await createLocalWorkspaceDeletion({
      onWorkspaceAccessRevoked: liveUpdateHub.broadcastWorkspaceContextInvalidation,
      sourceFileStore: createLocalSourceFileStore({ stateDirectory }),
      stateDirectory,
      workspaceControl,
    }).deleteWorkspace({ workspaceId: deletedWorkspace.id, userId: user.user.id });

    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0]!)).toEqual({
      version: 1,
      events: [
        {
          type: "workspace_context_invalidated",
          reason: "workspace_access",
          occurred_at: expect.any(String),
        },
      ],
    });
    expect(messages[0]).not.toContain("ada@example.com");
    expect(messages[0]).not.toContain("source");
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
