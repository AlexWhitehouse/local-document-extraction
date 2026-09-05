import { afterEach, describe, expect, it, vi } from "vitest";
import { createCompletedDocumentCache } from "../../lib/completedDocumentCache";
import { createDocumentReconciliation } from "./documentReconciliation";

const running = [];
afterEach(() => { for (const module of running.splice(0)) module.dispose(); });

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const job = (id, overrides = {}) => ({
  job_id: id, status: "processing", source_name: `${id}.pdf`,
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:01Z",
  current_attempt: 1, ...overrides,
});
const page = (jobs, extra = {}) => ({ jobs, total: jobs.length, has_more: false, ...extra });
function setup(options = {}) {
  const storage = { getItem: () => null, setItem: vi.fn() };
  const cache = options.cache || createCompletedDocumentCache({ storage });
  const requests = {
    listDocuments: vi.fn(async () => page([])),
    getDocument: vi.fn(async (id) => job(id)),
    getFilterOptions: vi.fn(async () => ({ available_models: [] })),
    submitDocument: vi.fn(async () => ({ job_id: "new", status: "queued" })),
    deleteDocument: vi.fn(async () => ({ deleted: true })),
    exportDocuments: vi.fn(async () => ({ blob: new Blob() })),
  };
  const callbacks = { onResponse: vi.fn(), onAccessDenied: vi.fn(), onCapacityChange: vi.fn(), onLog: vi.fn() };
  const module = createDocumentReconciliation({ cache, uploadConcurrency: 1, ...options });
  const configure = (patch = {}) => module.configure({ sessionId: "session-a", workspaceId: "workspace-a", enabled: true, requests, callbacks, ...patch });
  configure();
  running.push(module);
  return { module, requests, callbacks, cache, configure, snapshot: module.getSnapshot };
}
const entries = () => ["first", "second"].map((id) => ({ id, file: new File([id], `${id}.png`, { type: "image/png" }) }));

describe("Document reconciliation", () => {
  it("refreshes counts for an unloaded lifecycle update without discarding loaded pages", async () => {
    vi.useFakeTimers();
    const { module, snapshot, requests } = setup();
    const counts = { queued: 0, processing: 1, completed: 120, failed: 0 };
    requests.listDocuments.mockResolvedValueOnce(page([job("a", { status: "completed" })], { total: 121, status_counts: counts, has_more: true, next_cursor: "next" }));
    await module.refresh();
    requests.listDocuments.mockResolvedValueOnce(page([job("b", { status: "completed" })], { total: 121, status_counts: counts }));
    await module.refresh({ append: true });
    expect(snapshot().statusCounts.completed).toBe(120);
    requests.getDocumentCounts = vi.fn(async () => ({ total: 121, status_counts: { ...counts, processing: 0, completed: 121 } }));
    module.receiveLiveUpdates([job("unloaded", { status: "completed" })]);
    module.receiveLiveUpdates([job("unloaded", { status: "completed" })]);
    await vi.advanceTimersByTimeAsync(150);
    expect(snapshot().statusCounts.completed).toBe(121);
    expect(snapshot().documents.map((row) => row.job_id)).toEqual(["a", "b", "unloaded"]);
    expect(requests.getDocumentCounts).toHaveBeenCalledTimes(1);
    expect(requests.listDocuments).toHaveBeenCalledTimes(2);
  });

  it("keeps live status changes when a stale list returns and decrements totals on deletion", async () => {
    vi.useFakeTimers();
    const { module, snapshot, requests } = setup();
    const counts = { queued: 0, processing: 1, completed: 120, failed: 0 };
    requests.listDocuments.mockResolvedValueOnce(page([job("a")], { total: 121, status_counts: counts }));
    await module.refresh();
    const pending = deferred();
    requests.listDocuments.mockReturnValueOnce(pending.promise);
    const refresh = module.refresh();
    requests.getDocumentCounts = vi.fn(async () => ({ total: 121, status_counts: { ...counts, processing: 0, completed: 121 } }));
    module.receiveLiveUpdates([job("a", { status: "completed", updated_at: "2026-09-01T00:00:03Z" })]);
    await vi.advanceTimersByTimeAsync(150);
    pending.resolve(page([job("a")], { total: 121, status_counts: counts }));
    await refresh;
    expect(snapshot().statusCounts).toEqual({ queued: 0, processing: 0, completed: 121, failed: 0 });
    requests.getDocumentCounts.mockResolvedValue({ total: 120, status_counts: { ...counts, processing: 0 } });
    await module.deleteDocuments(["a"]);
    requests.listDocuments.mockResolvedValue(page([], { total: 120, status_counts: { ...counts, processing: 0 } }));
    await vi.advanceTimersByTimeAsync(150);
    expect(snapshot().statusCounts.completed).toBe(120);
    expect(snapshot().totalDocuments).toBe(120);
  });

  it("rejects count responses overtaken by lifecycle updates or a Workspace change", async () => {
    vi.useFakeTimers();
    const { module, snapshot, requests, configure } = setup();
    const first = deferred(), second = deferred();
    requests.getDocumentCounts = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    module.receiveLiveUpdates([job("a")]);
    await vi.advanceTimersByTimeAsync(150);
    module.receiveLiveUpdates([job("a", { status: "completed", updated_at: "2026-09-01T00:00:03Z" })]);
    first.resolve({ total: 1, status_counts: { queued: 0, processing: 1, completed: 0, failed: 0 } });
    await Promise.resolve();
    expect(snapshot().statusCounts.completed).toBe(0);
    await vi.advanceTimersByTimeAsync(150);
    configure({ workspaceId: "workspace-b" });
    second.resolve({ total: 1, status_counts: { queued: 0, processing: 0, completed: 1, failed: 0 } });
    await Promise.resolve();
    expect(snapshot().statusCounts.completed).toBe(0);
  });

  it("preserves the list identity on selection and loading-only changes", async () => {
    const { module, snapshot, requests } = setup();
    module.receiveLiveUpdates([job("a"), job("b")]);
    const documents = snapshot().documents;
    module.selectDocument("b");
    module.toggleSelection(["b"], true);
    expect(snapshot().documents).toBe(documents);
    const pending = deferred();
    requests.getDocument.mockReturnValueOnce(pending.promise);
    const load = module.loadDetails("b", { showLoading: true });
    expect(snapshot().documents).toBe(documents);
    pending.resolve(job("b"));
    await load;
  });

  it("bounds parallel uploads and stops unsent files after the session ends", async () => {
    const { module, requests, configure } = setup({ uploadConcurrency: 2 });
    const first = deferred(), second = deferred();
    requests.submitDocument.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const files = [...entries(), { id: "third", file: new File(["third"], "third.png", { type: "image/png" }) }];
    const batch = module.submitBatch({ templateId: "template", entries: files });
    expect(requests.submitDocument).toHaveBeenCalledTimes(2);
    configure({ sessionId: "other-session" });
    first.resolve({ job_id: "first" });
    second.resolve({ job_id: "second" });
    await batch;
    expect(requests.submitDocument).toHaveBeenCalledTimes(2);
  });

  it("retries only explicit admission rejection with bounded backoff", async () => {
    vi.useFakeTimers();
    const { module, requests } = setup();
    requests.submitDocument.mockRejectedValueOnce(Object.assign(new Error("full"), { code: "local_submission_capacity_unavailable" }));
    const batch = module.submitBatch({ templateId: "template", entries: entries().slice(0, 1) });
    await vi.advanceTimersByTimeAsync(1000);
    await batch;
    expect(requests.submitDocument).toHaveBeenCalledTimes(2);
  });
  it("merges unaffected rows while protecting live changes from an overlapping list, then coalesces a refresh", async () => {
    vi.useFakeTimers();
    const { module, requests, snapshot } = setup();
    requests.listDocuments.mockResolvedValueOnce(page([job("a"), job("b")]));
    await module.refresh();
    const pending = deferred();
    requests.listDocuments.mockReturnValueOnce(pending.promise);
    const refresh = module.refresh();
    module.receiveLiveUpdates([job("a", { status: "completed", updated_at: "2026-09-01T00:00:03Z" })]);
    module.receiveLiveUpdates([job("c", { status: "queued" })]);
    pending.resolve(page([job("a"), job("b", { source_name: "renamed.pdf", model_name: "model-b" })]));
    await refresh;
    expect(snapshot().documents.map(({ job_id }) => job_id)).toEqual(["a", "b", "c"]);
    expect(snapshot().documents[0].status).toBe("completed");
    expect(snapshot().documents[1].model_name).toBe("model-b");
    expect(snapshot().totalDocuments).toBe(3);
    requests.listDocuments.mockResolvedValue(page(snapshot().documents));
    await vi.advanceTimersByTimeAsync(150);
    expect(requests.listDocuments).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests.listDocuments).toHaveBeenCalledTimes(3);
  });

  it("accepts only the latest list request and invalidates old pagination when the query changes", async () => {
    const { module, requests, snapshot } = setup();
    const old = deferred(), latest = deferred();
    requests.listDocuments.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const first = module.refresh(), second = module.refresh();
    latest.resolve(page([job("new", { model_name: "new-model" })], { total: 20, has_more: true, next_cursor: "page-2" }));
    await second;
    old.resolve(page([job("old")]));
    await first;
    expect(snapshot().documents[0].job_id).toBe("new");
    const more = deferred();
    requests.listDocuments.mockReturnValueOnce(more.promise);
    const append = module.refresh({ append: true });
    expect(requests.listDocuments.mock.lastCall[0].cursor).toBe("page-2");
    requests.listDocuments.mockResolvedValueOnce(page([job("filtered", { model_name: "other" })], { total: 20 }));
    module.setFilters({ model: "other" });
    await Promise.resolve();
    more.resolve(page([job("old-page", { model_name: "other" })], { has_more: true, next_cursor: "page-3" }));
    await append;
    expect(snapshot().documents.map(({ job_id }) => job_id)).toEqual(["filtered"]);
    expect(snapshot()).toMatchObject({ hasMore: false, nextCursor: null, totalDocuments: 20, loadingMore: false });
  });

  it("debounces search and rejects a list that started before the search changed", async () => {
    vi.useFakeTimers();
    const { module, requests, snapshot } = setup();
    const pending = deferred();
    requests.listDocuments.mockReturnValueOnce(pending.promise);
    const refresh = module.refresh();
    module.setSearch("fir");
    module.setSearch("first");
    pending.resolve(page([job("stale")]));
    await refresh;
    expect(snapshot().documents).toEqual([]);
    requests.listDocuments.mockResolvedValue(page([job("first")]));
    await vi.advanceTimersByTimeAsync(250);
    expect(requests.listDocuments).toHaveBeenCalledTimes(2);
    expect(requests.listDocuments.mock.lastCall[0].search).toBe("first");
    expect(snapshot().documents[0].job_id).toBe("first");
  });

  it("does not resurrect deleted Documents from pending reads or live updates and repairs selection/counts", async () => {
    const { module, requests, snapshot, cache } = setup();
    requests.listDocuments.mockResolvedValueOnce(page([job("a"), job("b")]));
    await module.refresh();
    cache.store("workspace-a", job("a", { status: "completed", results: [{ answer: "cached" }] }));
    module.toggleSelection(["a", "b"], true);
    const detail = deferred(), list = deferred();
    requests.getDocument.mockReturnValueOnce(detail.promise);
    requests.listDocuments.mockReturnValueOnce(list.promise);
    const reading = module.loadDetails("a"), refreshing = module.refresh();
    await module.deleteDocuments(["a"]);
    detail.resolve(job("a", { status: "completed", results: [{ answer: "stale" }] }));
    list.resolve(page([job("a"), job("b")]));
    await Promise.all([reading, refreshing]);
    module.receiveLiveUpdates([job("a", { status: "queued" })]);
    expect(snapshot()).toMatchObject({ selectedDocumentId: "b", selectedDocumentIds: ["b"], totalDocuments: 1 });
    expect(snapshot().documents.map(({ job_id }) => job_id)).toEqual(["b"]);
    expect(cache.get("workspace-a", "a")).toBeNull();
  });

  it("rejects an older detail response after a live completion and hydrates the current version once", async () => {
    const { module, requests, snapshot, cache } = setup();
    module.receiveLiveUpdates([job("a")]);
    const pending = deferred();
    requests.getDocument.mockReturnValueOnce(pending.promise);
    const reading = module.ensureSelectedDetails();
    await Promise.resolve();
    module.receiveLiveUpdates([job("a", { status: "completed", updated_at: "2026-09-01T00:00:03Z" })]);
    pending.resolve(job("a"));
    await reading;
    expect(snapshot().selectedDocument.status).toBe("completed");
    requests.getDocument.mockResolvedValue(job("a", { status: "completed", updated_at: "2026-09-01T00:00:03Z", results: [{ answer: "42" }] }));
    await module.ensureSelectedDetails();
    await module.ensureSelectedDetails();
    expect(requests.getDocument).toHaveBeenCalledTimes(2);
    expect(cache.get("workspace-a", "a").results).toEqual([{ answer: "42" }]);
    requests.listDocuments.mockResolvedValue(page([job("a", { status: "completed", updated_at: "2026-09-01T00:00:03Z", results: [] })]));
    await module.refresh();
    expect(snapshot().selectedDocument.results).toEqual([{ answer: "42" }]);
  });

  it("orders same-timestamp lifecycle updates by attempt and rejects events from an old Workspace", () => {
    const { module, configure, snapshot } = setup();
    const oldScope = snapshot().scopeKey;
    module.receiveLiveUpdates([job("a", { status: "completed" })]);
    module.receiveLiveUpdates([job("a", { status: "processing" })]);
    expect(snapshot().selectedDocument.status).toBe("completed");
    module.receiveLiveUpdates([job("a", { status: "queued", current_attempt: 2 })]);
    expect(snapshot().selectedDocument).toMatchObject({ status: "queued", current_attempt: 2 });
    module.receiveLiveUpdates([job("a", { status: "completed", current_attempt: 1 })]);
    expect(snapshot().selectedDocument.current_attempt).toBe(2);
    configure({ workspaceId: "workspace-b" });
    module.receiveLiveUpdates([job("old", { status: "queued" })], oldScope);
    expect(snapshot().documents).toEqual([]);
  });

  it("removes a missing Document on 404 but preserves observations made after the detail request began", async () => {
    const { module, requests, snapshot } = setup();
    requests.listDocuments.mockResolvedValue(page([job("a"), job("b")]));
    await module.refresh();
    const missing = Object.assign(new Error("missing"), { status: 404 });
    const pending = deferred();
    requests.getDocument.mockReturnValueOnce(pending.promise);
    const reading = module.loadDetails("a");
    module.receiveLiveUpdates([job("a", { status: "completed", updated_at: "2026-09-01T00:00:03Z" })]);
    pending.reject(missing);
    await reading;
    expect(snapshot().selectedDocument.job_id).toBe("a");
    requests.getDocument.mockRejectedValueOnce(missing);
    await module.loadDetails("a");
    expect(snapshot()).toMatchObject({ selectedDocumentId: "b", totalDocuments: 1 });
  });

  it("deduplicates details and settles synchronous adapter failures without retry loops", async () => {
    const { module, requests, snapshot } = setup();
    module.receiveLiveUpdates([job("a")]);
    requests.getDocument.mockImplementationOnce(() => { throw new Error("offline"); });
    await Promise.all([module.ensureSelectedDetails(), module.loadDetails("a")]);
    await module.ensureSelectedDetails();
    expect(requests.getDocument).toHaveBeenCalledTimes(1);
    expect(snapshot().loadingDocumentId).toBe("");
    await module.loadDetails("a");
    expect(requests.getDocument).toHaveBeenCalledTimes(2);
    requests.getFilterOptions.mockImplementationOnce(() => { throw new Error("offline"); });
    await module.loadModels();
    await module.loadModels();
    expect(requests.getFilterOptions).toHaveBeenCalledTimes(2);
  });

  it("keeps cached completed details on initial resolution and prunes only complete unfiltered lists", async () => {
    const { module, requests, cache, configure, snapshot } = setup();
    cache.store("workspace-a", job("a", { status: "completed", results: [{ answer: "42" }] }));
    cache.store("workspace-a", job("b", { status: "completed", results: [{ answer: "other" }] }));
    requests.listDocuments.mockResolvedValueOnce(page([job("a", { status: "completed", results: [] })], { has_more: true, next_cursor: "next" }));
    await module.refresh();
    expect(snapshot().selectedDocument.results).toEqual([{ answer: "42" }]);
    await module.ensureSelectedDetails();
    expect(requests.getDocument).not.toHaveBeenCalled();
    expect(cache.get("workspace-a", "b")).not.toBeNull();
    requests.listDocuments.mockResolvedValue(page([]));
    module.setFilters({ model: "other" });
    await Promise.resolve();
    expect(cache.get("workspace-a", "b")).not.toBeNull();
    module.setFilters({});
    await Promise.resolve();
    expect(cache.get("workspace-a", "b")).toBeNull();
    cache.store("workspace-a", job("a", { status: "completed" }));
    configure({ workspaceId: "workspace-b" });
    expect(cache.get("workspace-a", "a")).toBeNull();
  });

  it("ignores old Workspace reads, access failures, exports, and model options", async () => {
    const { module, requests, callbacks, configure, snapshot, cache } = setup();
    const detail = deferred(), list = deferred(), models = deferred(), exported = deferred(), deleted = deferred();
    requests.getDocument.mockReturnValue(detail.promise);
    requests.listDocuments.mockReturnValue(list.promise);
    requests.getFilterOptions.mockReturnValue(models.promise);
    requests.exportDocuments.mockReturnValue(exported.promise);
    requests.deleteDocument.mockReturnValue(deleted.promise);
    const onComplete = vi.fn();
    const pending = [module.loadDetails("a"), module.refresh(), module.loadModels(), module.exportDocuments(["a"], { onComplete }), module.deleteDocuments(["a"], { onComplete })];
    await Promise.resolve();
    configure({ workspaceId: "workspace-b" });
    detail.resolve(job("a", { status: "completed", results: [] }));
    list.reject(Object.assign(new Error("forbidden"), { status: 403 }));
    models.resolve({ available_models: ["old-model"] });
    exported.resolve({ blob: new Blob() });
    deleted.resolve({ deleted: true });
    await Promise.all(pending);
    expect(snapshot()).toMatchObject({ documents: [], availableModels: [], totalDocuments: 0 });
    expect(callbacks.onResponse).not.toHaveBeenCalled();
    expect(callbacks.onAccessDenied).not.toHaveBeenCalled();
    expect(callbacks.onLog).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(cache.get("workspace-a", "a")).toBeNull();
  });

  it("pins a batch to its original Workspace adapter and suppresses old UI effects after switching", async () => {
    const createPreview = vi.fn(() => "blob:preview");
    const { module, requests, callbacks, configure, snapshot } = setup({ createPreview });
    const first = deferred();
    requests.submitDocument.mockReturnValueOnce(first.promise);
    const onComplete = vi.fn(), onProgress = vi.fn();
    const batch = module.submitBatch({ templateId: "template-a", entries: entries(), onComplete, onProgress });
    const nextRequests = { ...requests, submitDocument: vi.fn() };
    configure({ workspaceId: "workspace-b", requests: nextRequests });
    first.resolve({ job_id: "first", status: "queued" });
    await batch;
    expect(requests.submitDocument).toHaveBeenCalledTimes(2);
    expect(requests.submitDocument.mock.calls.map(([form]) => form.get("template_id"))).toEqual(["template-a", "template-a"]);
    expect(nextRequests.submitDocument).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(callbacks.onResponse).not.toHaveBeenCalled();
    expect(createPreview).not.toHaveBeenCalled();
    expect(snapshot().documents).toEqual([]);
  });

  it.each(["identity", "explicit-clear", "auth-action"])("stops unsent batch entries on session invalidation (%s)", async (change) => {
    const { module, requests, configure, snapshot, callbacks } = setup();
    const first = deferred();
    requests.submitDocument.mockReturnValueOnce(first.promise);
    const onComplete = vi.fn();
    const batch = module.submitBatch({ templateId: "template-a", entries: entries(), onComplete });
    if (change === "identity") configure({ sessionId: "session-b" });
    if (change === "explicit-clear") {
      module.clear({ sessionEnded: true });
      configure(); // A render with the old session must not reactivate it.
    }
    if (change === "auth-action") module.cancelPendingSubmissions();
    first.resolve({ job_id: "first", status: "queued" });
    await batch;
    expect(requests.submitDocument).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(callbacks.onResponse).not.toHaveBeenCalled();
    expect(snapshot()).toMatchObject({ documents: [], uploading: false });
  });

  it("releases local previews exactly once when deleted or leaving a Workspace", async () => {
    const revokePreview = vi.fn();
    const { module, requests, configure } = setup({ createPreview: (file) => `blob:${file.name}`, revokePreview });
    requests.submitDocument.mockResolvedValueOnce({ job_id: "a", status: "queued" }).mockResolvedValueOnce({ job_id: "b", status: "queued" });
    await module.submitBatch({ templateId: "template-a", entries: entries() });
    await module.deleteDocuments(["a"]);
    configure({ workspaceId: "workspace-b" });
    module.dispose();
    expect(revokePreview.mock.calls).toEqual([["blob:first.png"], ["blob:second.png"]]);
  });

  it("continues to render completed details when browser cache writes fail", async () => {
    const cache = { get: () => null, store: () => { throw new Error("quota"); } };
    const { module, requests, snapshot } = setup({ cache });
    requests.getDocument.mockResolvedValue(job("a", { status: "completed", results: [{ answer: "42" }] }));
    await module.loadDetails("a");
    expect(snapshot().selectedDocument.results).toEqual([{ answer: "42" }]);
  });
});
