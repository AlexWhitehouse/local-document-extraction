import { describe, expect, test } from "bun:test";

import {
  sanitizeConsoleText,
  sanitizeUrlMetadata,
  summarizeWorkspaceFrame,
} from "./browserEvidence";

describe("browser journey evidence", () => {
  test("keeps URL routing metadata without credentials, query values, or fragments", () => {
    expect(sanitizeUrlMetadata(
      "http://user:secret@127.0.0.1:8787/api/auth/verify-email?token=verification-secret#done",
    )).toBe("http://127.0.0.1:8787/api/auth/verify-email");
  });

  test("redacts common credential shapes and bounds console evidence", () => {
    const sanitized = sanitizeConsoleText([
      "Authorization: Bearer bearer-secret",
      "password=account-secret",
      "https://example.test/callback?token=query-secret",
      "x".repeat(2_000),
    ].join(" "));

    expect(sanitized).not.toContain("bearer-secret");
    expect(sanitized).not.toContain("account-secret");
    expect(sanitized).not.toContain("query-secret");
    expect(sanitized.length).toBeLessThanOrEqual(1_000);
  });

  test("retains only lifecycle routing fields from Workspace frames", () => {
    expect(summarizeWorkspaceFrame(JSON.stringify({
      version: 1,
      events: [{
        type: "extraction_job_lifecycle",
        job: {
          job_id: "job_e2e",
          status: "completed",
          source_name: "private-invoice.png",
          results: [{ answer: "private-answer" }],
        },
      }],
    }))).toEqual([{
      type: "extraction_job_lifecycle",
      jobId: "job_e2e",
      status: "completed",
    }]);
  });
});
