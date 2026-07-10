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
