import { describe, expect, it, vi } from "vitest";

import { createDocumentRequestAdapter } from "./documentRequestAdapter.js";

describe("Document request adapter conditional reads", () => {
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

