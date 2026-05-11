import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompletedDocumentCache,
  COMPLETED_DOCUMENT_CACHE_STORAGE_KEY,
} from "./completedDocumentCache";

describe("Completed document cache", () => {
  let storage;

  beforeEach(() => {
    storage = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key) => storage.get(key) ?? null),
        setItem: vi.fn((key, value) => storage.set(key, String(value))),
        removeItem: vi.fn((key) => storage.delete(key)),
      },
    });
  });

  it("stores only completed Extraction job details without source preview data", () => {
    const cache = createCompletedDocumentCache();
    const completedDocument = {
      job_id: "job_completed_1",
      status: "completed",
      source_name: "invoice.pdf",
      source_preview_url: "blob:http://localhost/source-preview",
      file: new File(["private"], "invoice.pdf"),
      results: [
        {
          field_id: "total",
          name: "Total",
          status: "found",
          answer: "$42.00",
        },
      ],
    };

    cache.store("ws_1", completedDocument);

    expect(cache.get("ws_1", "job_completed_1")).toEqual({
      job_id: "job_completed_1",
      status: "completed",
      source_name: "invoice.pdf",
      results: [
        {
          field_id: "total",
          name: "Total",
          status: "found",
          answer: "$42.00",
        },
      ],
    });
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      COMPLETED_DOCUMENT_CACHE_STORAGE_KEY,
      expect.not.stringContaining("source_preview_url"),
    );
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      COMPLETED_DOCUMENT_CACHE_STORAGE_KEY,
      expect.not.stringContaining("blob:http://localhost/source-preview"),
    );
  });

  it("keeps at most 50 completed Documents for an accepted Workspace", () => {
    const cache = createCompletedDocumentCache();

    for (let index = 1; index <= 51; index += 1) {
      cache.store("ws_1", completedDocument({ job_id: `job_${index}` }));
    }

    expect(cache.get("ws_1", "job_1")).toBeNull();
    expect(cache.get("ws_1", "job_2")).toMatchObject({ job_id: "job_2" });
    expect(cache.get("ws_1", "job_51")).toMatchObject({ job_id: "job_51" });
  });

  it("survives refresh for the same accepted Workspace", () => {
    const cache = createCompletedDocumentCache();
    cache.store("ws_1", completedDocument({ job_id: "job_completed_1" }));

    const refreshedCache = createCompletedDocumentCache();

    expect(refreshedCache.get("ws_1", "job_completed_1")).toMatchObject({
      job_id: "job_completed_1",
      status: "completed",
    });
  });

  it("does not store queued, processing, or failed Extraction jobs", () => {
    const cache = createCompletedDocumentCache();

    cache.store("ws_1", completedDocument({ job_id: "job_queued", status: "queued" }));
    cache.store(
      "ws_1",
      completedDocument({ job_id: "job_processing", status: "processing" }),
    );
    cache.store("ws_1", completedDocument({ job_id: "job_failed", status: "failed" }));

    expect(cache.get("ws_1", "job_queued")).toBeNull();
    expect(cache.get("ws_1", "job_processing")).toBeNull();
    expect(cache.get("ws_1", "job_failed")).toBeNull();
  });

  it("clears cache entries for a specific accepted Workspace", () => {
    const cache = createCompletedDocumentCache();
    cache.store("ws_1", completedDocument({ job_id: "job_ws_1" }));
    cache.store("ws_2", completedDocument({ job_id: "job_ws_2" }));

    cache.clearWorkspace("ws_1");

    expect(cache.get("ws_1", "job_ws_1")).toBeNull();
    expect(cache.get("ws_2", "job_ws_2")).toMatchObject({ job_id: "job_ws_2" });
  });

  it("removes a completed Document when it is deleted or not found", () => {
    const cache = createCompletedDocumentCache();
    cache.store("ws_1", completedDocument({ job_id: "job_completed_1" }));

    cache.remove("ws_1", "job_completed_1");

    expect(cache.get("ws_1", "job_completed_1")).toBeNull();
  });

  it("does not prune for filtered job-list absence", () => {
    const cache = createCompletedDocumentCache();
    cache.store("ws_1", completedDocument({ job_id: "job_completed_1" }));

    cache.pruneFromJobList("ws_1", [], { filtered: true });

    expect(cache.get("ws_1", "job_completed_1")).toMatchObject({
      job_id: "job_completed_1",
    });
  });

  it("prunes conservatively from unfiltered job-list evidence", () => {
    const cache = createCompletedDocumentCache();
    cache.store("ws_1", completedDocument({ job_id: "job_missing" }));
    cache.store("ws_1", completedDocument({ job_id: "job_listed" }));

    cache.pruneFromJobList(
      "ws_1",
      [{ job_id: "job_listed", status: "completed" }],
      { filtered: false },
    );

    expect(cache.get("ws_1", "job_missing")).toBeNull();
    expect(cache.get("ws_1", "job_listed")).toMatchObject({ job_id: "job_listed" });
  });
});

function completedDocument(overrides = {}) {
  return {
    job_id: "job_completed_1",
    status: "completed",
    source_name: "invoice.pdf",
    results: [
      {
        field_id: "total",
        name: "Total",
        status: "found",
        answer: "$42.00",
      },
    ],
    ...overrides,
  };
}
