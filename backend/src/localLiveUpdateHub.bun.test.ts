import { expect, test } from "bun:test";

import { createLocalLiveUpdateHub } from "./localLiveUpdateHub";

test("the local live update hub isolates Workspace broadcasts and strips private job data", () => {
  const hub = createLocalLiveUpdateHub();
  const researchMessages: string[] = [];
  const legalMessages: string[] = [];
  const researchSocket = { send: (message: string) => researchMessages.push(message) };
  const legalSocket = { send: (message: string) => legalMessages.push(message) };
  hub.subscribe({ workspaceId: "workspace_research", socket: researchSocket });
  hub.subscribe({ workspaceId: "workspace_legal", socket: legalSocket });

  hub.broadcastJob("workspace_research", {
    job_id: "job_invoice",
    status: "completed",
    source_name: "private-invoice.png",
    source_mime_type: "image/png",
    source_file_page_count: null,
    template_id: "tpl_invoice",
    template_version: 1,
    error_code: null,
    error_message: null,
    created_at: "2026-07-09T12:00:00.000Z",
    updated_at: "2026-07-09T12:01:00.000Z",
    completed_at: "2026-07-09T12:01:00.000Z",
    current_attempt: 1,
    completed_attempt: 1,
    last_failed_attempt: 0,
    results: [{ answer: "private answer", evidence: "private evidence" }],
    account_email: "ada@example.com",
    api_key: "secret",
  });

  expect(legalMessages).toEqual([]);
  expect(researchMessages).toHaveLength(1);
  const envelope = JSON.parse(researchMessages[0]!);
  expect(envelope).toEqual({
    version: 1,
    events: [
      {
        type: "extraction_job_lifecycle",
        job: {
          job_id: "job_invoice",
          status: "completed",
          template_id: "tpl_invoice",
          template_version: 1,
          error_code: null,
          error_message: null,
          created_at: "2026-07-09T12:00:00.000Z",
          updated_at: "2026-07-09T12:01:00.000Z",
          completed_at: "2026-07-09T12:01:00.000Z",
          current_attempt: 1,
          completed_attempt: 1,
          last_failed_attempt: 0,
        },
      },
    ],
  });
  expect(researchMessages[0]).not.toContain("private");
  expect(researchMessages[0]).not.toContain("ada@example.com");
});

test("the local live update hub closes every Workspace connection during forced shutdown", () => {
  const hub = createLocalLiveUpdateHub();
  const closed: Array<{ code: number; reason: string }> = [];
  const messages: string[] = [];
  const socket = {
    close: (code: number, reason: string) => {
      closed.push({ code, reason });
    },
    send: (message: string) => {
      return messages.push(message);
    },
  };
  hub.subscribe({ workspaceId: "workspace_research", socket });

  hub.closeAll();
  hub.closeAll();
  hub.broadcastWorkspaceContextInvalidation({
    workspaceId: "workspace_research",
    reason: "workspace_access",
    occurredAt: "2026-08-20T12:00:00.000Z",
  });

  expect(closed).toEqual([{ code: 1001, reason: "Local Bun Runtime shutting down" }]);
  expect(messages).toEqual([]);
});

test("the live update hub classifies delivery, backpressure, drops, failures, and drain", () => {
  const hub = createLocalLiveUpdateHub();
  const closed: string[] = [];
  const delivered = { send: () => 32 };
  const backpressured = { send: () => -1 };
  const dropped = {
    close: (code: number) => closed.push(`dropped:${code}`),
    send: () => 0,
  };
  const failed = {
    close: (code: number) => closed.push(`failed:${code}`),
    send: () => {
      throw new Error("socket failed");
    },
  };
  for (const socket of [delivered, backpressured, dropped, failed]) {
    hub.subscribe({ workspaceId: "workspace_private", socket });
  }

  hub.broadcastWorkspaceContextInvalidation({
    workspaceId: "workspace_private",
    reason: "workspace_access",
    occurredAt: "2026-08-20T12:00:00.000Z",
  });

  expect(closed).toEqual(["dropped:1011", "failed:1011"]);
  expect(hub.diagnostics()).toEqual({
    connections: { closed: 2, open: 2, opened: 4, pending: 1 },
    delivery: { backpressured: 1, delivered: 1, dropped: 1, failed: 1 },
    workspaces: { maximumSubscribers: 2, minimumSubscribers: 2, total: 1, totalSubscribers: 2 },
  });
  expect(JSON.stringify(hub.diagnostics())).not.toContain("workspace_private");

  hub.drain(backpressured);
  expect(hub.diagnostics().connections.pending).toBe(0);
  hub.unsubscribe({ workspaceId: "workspace_private", socket: delivered });
  hub.unsubscribe({ workspaceId: "workspace_private", socket: backpressured });
  expect(hub.diagnostics().connections).toEqual({ closed: 4, open: 0, opened: 4, pending: 0 });
});
