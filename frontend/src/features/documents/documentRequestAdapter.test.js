import { describe, expect, it, vi } from "vitest";

import { createDocumentRequestAdapter } from "./documentRequestAdapter.js";

describe("Document request adapter conditional reads", () => {
  it("rejects malformed summaries instead of replacing the displayed counts", async () => {
    const adapter = createDocumentRequestAdapter({ request: vi.fn(async () => ({ jobs: [] })) });
    await expect(adapter.getDocumentCounts()).rejects.toThrow("invalid response");
  });
  it("evicts oversized representations together with their validators", async () => {
    const request = vi.fn(async () => ({ data: { job_id: "large", status: "completed", results: [{ answer: "x".repeat(2000) }] }, headers: new Headers({ etag: '"large"' }) }));
    const adapter = createDocumentRequestAdapter({ request, cacheMaxBytes: 1000 });
    await adapter.getDocument("large");
    await adapter.getDocument("large");
    expect(request.mock.lastCall[1].headers.has("if-none-match")).toBe(false);
  });
  it("reuses the cached representation after a matching validator", async () => {
    const job = { job_id: "job_1", status: "processing", results: [] };
    const request = vi.fn()
      .mockResolvedValueOnce({
        data: job,
        headers: new Headers({ etag: 'W/"job-v1-first"' }),
        notModified: false,
        status: 200,
      })
      .mockResolvedValueOnce({
        data: null,
        headers: new Headers({ etag: 'W/"job-v1-first"' }),
        notModified: true,
        status: 304,
      });
    const adapter = createDocumentRequestAdapter({ request });

    await expect(adapter.getDocument("job_1")).resolves.toEqual(job);
    await expect(adapter.getDocument("job_1")).resolves.toBe(job);

    const [, secondOptions] = request.mock.calls[1];
    expect(secondOptions.responseType).toBe("conditional-json");
    expect(secondOptions.headers.get("if-none-match")).toBe('W/"job-v1-first"');
  });

  it("clears a cached validator when the Document is deleted", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        data: { job_id: "job_1", status: "completed", results: [] },
        headers: new Headers({ etag: 'W/"job-v1-terminal"' }),
      })
      .mockResolvedValueOnce({ deleted: true, job_id: "job_1" })
      .mockResolvedValueOnce({
        data: { job_id: "job_1", status: "queued", results: [] },
        headers: new Headers({ etag: 'W/"job-v1-new"' }),
      });
    const adapter = createDocumentRequestAdapter({ request });

    await adapter.getDocument("job_1");
    await adapter.deleteDocument("job_1");
    await adapter.getDocument("job_1");

    const [, finalOptions] = request.mock.calls[2];
    expect(finalOptions.headers.has("if-none-match")).toBe(false);
  });
});
