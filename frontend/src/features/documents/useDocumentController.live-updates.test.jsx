import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useDocumentController } from "./useDocumentController";
import { createDocumentRequestAdapter } from "./documentRequestAdapter";
import { DocumentContextList } from "./DocumentContextList.jsx";

// Answers the confirmation dialog that a delete opened.
async function answerDialog(name) {
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name }));
  await act(async () => {});
}

describe("useDocumentController Workspace live updates", () => {
  it("shows workspace status totals when only the first 50 documents are loaded", async () => {
    installWebSocketStub();
    const jobs = Array.from({ length: 50 }, (_, i) => ({ job_id: `job_${i}`, status: "completed" }));

    const request = vi.fn(async (path) =>
      path === "/jobs?group_packets=true"
        ? {
            jobs,
            total: 137,
            status_counts: { queued: 7, processing: 5, completed: 120, failed: 5 },
            has_more: true,
            next_cursor: "next",
          }
        : { available_models: [] },
    );

    const { controller } = renderController({ documentRequests: createDocumentRequestAdapter({ request }) });
    await waitFor(() => expect(controller().contextList.documents).toHaveLength(50));
    expect(controller().statusCounts).toEqual({ queued: 7, processing: 5, completed: 120, failed: 5 });
  });

  it("renders 50 combined entries, loads the next entry, and never flashes unlisted packet children", async () => {
    const sockets = installWebSocketStub();

    const jobs = Array.from({ length: 50 }, (_, i) => ({
      job_id: `ordinary_${i}`,
      source_name: `ordinary-${i}.pdf`,
      status: "completed",
    }));

    const children = Array.from({ length: 50 }, (_, i) => ({
      job_id: `child_${i}`,
      parent_packet_id: "packet",
      status: "completed",
    }));

    const packet = { packet_id: "packet", source_name: "bundle.pdf", status: "completed", children };

    const request = vi.fn(async (path) => {
      if (path.startsWith("/jobs?group_packets=true"))
        return path.includes("cursor=next")
          ? { jobs: jobs.slice(49), packets: [], total: 100, has_more: false }
          : {
              jobs: jobs.slice(0, 49),
              packets: [packet],
              total: 100,
              status_counts: { completed: 100 },
              has_more: true,
              next_cursor: "next",
            };

      if (path.startsWith("/jobs/ordinary_")) return jobs.find((job) => path.endsWith(job.job_id));

      return { available_models: [] };
    });

    const { getAllByRole, getByRole, controller } = renderController({
      showList: true,
      documentRequests: createDocumentRequestAdapter({ request }),
    });

    await waitFor(() => expect(getAllByRole("listitem")).toHaveLength(50));
    expect(controller().toolbar.documentCount).toBe(100);
    expect(controller().statusCounts.completed).toBe(100);
    act(() =>
      sockets.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [
            {
              type: "extraction_job_lifecycle",
              job: { job_id: "new_child", parent_packet_id: "not_loaded_packet", status: "processing" },
            },
          ],
        }),
      }),
    );
    expect(getAllByRole("listitem")).toHaveLength(50);
    fireEvent.click(getByRole("button", { name: /Load more Documents/ }));
    await waitFor(() => expect(getAllByRole("listitem")).toHaveLength(51));
    expect(request.mock.calls.some(([path]) => path.startsWith("/packets"))).toBe(false);
  });

  it("opens one session-only live update connection for the accepted Workspace context", async () => {
    const WebSocketStub = installWebSocketStub();

    const { rerender } = render(<DocumentControllerHarness workspaceId="ws_1" />);

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
    });
    expect(WebSocketStub.instances[0].url).toMatch(/^ws:\/\/localhost(:\d+)?\/v1\/workspaces\/ws_1\/live$/);

    rerender(<DocumentControllerHarness workspaceId="ws_2" />);

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(2);
    });
    expect(WebSocketStub.instances[0].close).toHaveBeenCalled();
    expect(WebSocketStub.instances[1].url).toMatch(/^ws:\/\/localhost(:\d+)?\/v1\/workspaces\/ws_2\/live$/);
  });

  it("does not poll selected live Extraction jobs while live updates are active", async () => {
    installWebSocketStub();
    const intervalSpy = vi.spyOn(window, "setInterval").mockReturnValue(123);
    vi.spyOn(window, "clearInterval").mockImplementation(() => {});

    renderController({ initialWorkspace: seeded(processingJob()) });

    await waitFor(() => {
      expect(intervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 1000);
    });
  });

  it("backs off and retries fallback polling after a transient detail failure", async () => {
    globalThis.WebSocket = undefined;
    const nativeSetTimeout = window.setTimeout;
    const polls = [];
    vi.spyOn(window, "setTimeout").mockImplementation((callback, delay, ...args) => {
      if (delay >= 5000) {
        polls.push({ callback, delay });

        return 123;
      }

      return nativeSetTimeout(callback, delay, ...args);
    });
    const processingDetails = processingJob();
    let failDetailRequest = false;

    const request = vi.fn(async (path) => {
      if (path === "/jobs/job_processing_1") {
        if (failDetailRequest) {
          throw new TypeError("Temporary network failure");
        }

        return processingDetails;
      }

      return jobList([processingDetails]);
    });

    renderController({ request, initialWorkspace: seeded(processingDetails) });

    await waitFor(() => {
      expect(polls).toHaveLength(1);
      expect(request).toHaveBeenCalledWith("/jobs/job_processing_1", { method: "GET" });
    });
    const firstPoll = polls.shift();
    failDetailRequest = true;
    await act(async () => {
      await firstPoll.callback();
    });

    expect(polls).toHaveLength(1);
    expect(polls[0].delay).toBeGreaterThanOrEqual(10000);
    expect(polls[0].delay).toBeLessThanOrEqual(12000);
  });

  it("hydrates selected document details when a live lifecycle update completes", async () => {
    const WebSocketStub = installWebSocketStub();
    const processingDetails = processingJob({ template_version: 1 });

    const completedDetails = {
      ...processingDetails,
      status: "completed",
      updated_at: "2026-05-06T12:02:00.000Z",
      completed_at: "2026-05-06T12:02:00.000Z",
      results: [{ field_id: "invoice_total", name: "Invoice Total", answer: "$42.00", confidence: 0.99 }],
    };

    let shouldReturnCompletedDetails = false;

    const request = vi.fn(async (path) => {
      if (path === "/jobs/job_processing_1") {
        return shouldReturnCompletedDetails ? completedDetails : processingDetails;
      }

      return jobList([]);
    });

    const { controller } = renderController({ request, initialWorkspace: seeded(processingDetails) });

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
    });
    request.mockClear();

    shouldReturnCompletedDetails = true;
    act(() => {
      WebSocketStub.instances[0].onmessage(
        liveMessage(
          lifecycle({
            ...processingDetails,
            status: "completed",
            error_code: null,
            error_message: null,
            updated_at: "2026-05-06T12:02:00.000Z",
            completed_at: "2026-05-06T12:02:00.000Z",
            current_attempt: 1,
            completed_attempt: 1,
            last_failed_attempt: 0,
          }),
        ),
      );
    });

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith("/jobs/job_processing_1", { method: "GET" });
    });
    await waitFor(() => {
      expect(controller().contextList.documents[0]).toMatchObject({
        job_id: "job_processing_1",
        status: "completed",
        completed_at: "2026-05-06T12:02:00.000Z",
        results: [expect.objectContaining({ field_id: "invoice_total", answer: "$42.00" })],
      });
    });
  });

  it("deduplicates selected completed detail hydration while live updates are active", async () => {
    const WebSocketStub = installWebSocketStub();
    const completedSummary = completedJob({ template_version: 1, results: [] });

    const completedDetails = {
      ...completedSummary,
      results: [{ field_id: "invoice_total", name: "Invoice Total", answer: "$42.00", confidence: 0.99 }],
    };

    const request = vi.fn(async (path) =>
      path === "/jobs/job_completed_1" ? completedDetails : jobList([completedSummary]),
    );

    const detailRequests = () => request.mock.calls.filter(([path]) => path === "/jobs/job_completed_1");

    renderController({ request, initialWorkspace: seeded(completedSummary) });

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
      expect(detailRequests()).toHaveLength(1);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(detailRequests()).toHaveLength(1);
  });

  it("does not select a background document when its live lifecycle update completes", async () => {
    const WebSocketStub = installWebSocketStub();

    const jobs = [
      completedJob({ job_id: "job_reviewing_1", source_name: "selected.pdf" }),
      processingJob({ source_name: "background.pdf", created_at: "2026-05-06T12:01:00.000Z" }),
    ];

    const request = vi.fn(async (path) =>
      path === "/jobs" ? jobList(jobs) : jobs.find((job) => path === `/jobs/${job.job_id}`) || jobs[0],
    );

    const { controller } = renderController({ request, initialWorkspace: seeded(...jobs) });

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
      expect(controller().contextList.selectedDocumentId).toBe("job_reviewing_1");
    });
    request.mockClear();

    act(() => {
      WebSocketStub.instances[0].onmessage(
        liveMessage(
          lifecycle(
            completedUpdate("2026-05-06T12:03:00.000Z", {
              source_name: "background.pdf",
              error_code: null,
              error_message: null,
            }),
          ),
        ),
      );
    });

    await waitFor(() => {
      expect(findDocument(controller(), "job_processing_1")).toMatchObject({
        status: "completed",
        completed_at: "2026-05-06T12:03:00.000Z",
      });
    });
    expect(controller().contextList.selectedDocumentId).toBe("job_reviewing_1");
    expect(request).not.toHaveBeenCalledWith("/jobs/job_processing_1", { method: "GET" });
  });

  it("updates Documents UI without refreshing Workspace context when live lifecycle updates arrive", async () => {
    const WebSocketStub = installWebSocketStub();
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});
    const timeoutSpy = vi.spyOn(window, "setTimeout");

    const { controller } = renderController({
      onWorkspaceCapacityRefresh,
      initialWorkspace: seeded(processingJob()),
    });

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
    });

    act(() => {
      WebSocketStub.instances[0].onmessage(liveMessage(lifecycle(completedUpdate("2026-05-06T12:02:00.000Z"))));
    });

    await waitFor(() => {
      expect(findDocument(controller(), "job_processing_1")).toMatchObject({
        status: "completed",
        completed_at: "2026-05-06T12:02:00.000Z",
      });
    });
    expect(timeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 150);
    expect(onWorkspaceCapacityRefresh).not.toHaveBeenCalled();
  });

  it("increments the document total once when live updates add a new Document", async () => {
    const WebSocketStub = installWebSocketStub();
    const liveJob = processingJob({ job_id: "job_live_1", status: "queued", updated_at: "2026-05-06T12:00:00.000Z" });

    const { controller } = renderController({ request: vi.fn(async () => jobList([], { total: 0 })) });

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
      expect(controller().toolbar.documentCount).toBe(0);
    });

    act(() => {
      WebSocketStub.instances[0].onmessage(liveMessage(lifecycle(liveJob)));
    });

    await waitFor(() => {
      expect(controller().toolbar.documentCount).toBe(1);
    });

    act(() => {
      WebSocketStub.instances[0].onmessage(
        liveMessage(
          lifecycle({
            ...liveJob,
            status: "processing",
            updated_at: "2026-05-06T12:01:00.000Z",
          }),
        ),
      );
    });

    expect(controller().toolbar.documentCount).toBe(1);
  });

  it("refreshes Workspace context when live invalidation updates arrive", async () => {
    const WebSocketStub = installWebSocketStub();
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});

    renderController({ onWorkspaceCapacityRefresh });

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
    });

    act(() => {
      WebSocketStub.instances[0].onmessage(liveMessage(invalidation("workspace_product_changed")));
    });

    await waitFor(() => {
      expect(onWorkspaceCapacityRefresh).toHaveBeenCalledOnce();
    });
  });

  it("immediately revalidates Workspace context when Workspace access invalidation arrives", async () => {
    vi.useFakeTimers();
    const WebSocketStub = installWebSocketStub();
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});

    try {
      renderController({ onWorkspaceCapacityRefresh });

      expect(WebSocketStub.instances).toHaveLength(1);

      await act(async () => {
        WebSocketStub.instances[0].onmessage(liveMessage(invalidation("workspace_access")));
        await Promise.resolve();
      });

      expect(onWorkspaceCapacityRefresh).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not duplicate access recovery while this browser is deleting the Workspace", async () => {
    const WebSocketStub = installWebSocketStub();
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});

    renderController({ isWorkspaceDeletionInProgress: true, onWorkspaceCapacityRefresh });

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
    });
    act(() => {
      WebSocketStub.instances[0].onmessage(liveMessage(invalidation("workspace_access")));
    });

    expect(onWorkspaceCapacityRefresh).not.toHaveBeenCalled();
  });

  it("blocks useful live update effects until Workspace access revalidation succeeds", async () => {
    const WebSocketStub = installWebSocketStub();
    let resolveAccessRevalidation;

    const accessRevalidation = new Promise((resolve) => {
      resolveAccessRevalidation = resolve;
    });

    const onWorkspaceCapacityRefresh = vi.fn(() => accessRevalidation);
    const job = processingJob();

    const { controller } = renderController({
      request: vi.fn(async () => jobList([job])),
      onWorkspaceCapacityRefresh,
      initialWorkspace: { jobHistory: [job] },
    });

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
      expect(findDocument(controller(), "job_processing_1")).toMatchObject({ status: "processing" });
    });

    await act(async () => {
      WebSocketStub.instances[0].onmessage(liveMessage(invalidation("workspace_access")));
      await Promise.resolve();
    });
    expect(onWorkspaceCapacityRefresh).toHaveBeenCalledOnce();

    act(() => {
      WebSocketStub.instances[0].onmessage(liveMessage(lifecycle(completedUpdate("2026-05-06T12:03:00.000Z"))));
    });

    expect(findDocument(controller(), "job_processing_1")).toMatchObject({ status: "processing" });

    await act(async () => {
      resolveAccessRevalidation();
      await accessRevalidation;
      await Promise.resolve();
    });

    act(() => {
      WebSocketStub.instances[0].onmessage(liveMessage(lifecycle(completedUpdate("2026-05-06T12:04:00.000Z"))));
    });

    await waitFor(() => {
      expect(findDocument(controller(), "job_processing_1")).toMatchObject({
        status: "completed",
        completed_at: "2026-05-06T12:04:00.000Z",
      });
    });
  });

  it("ignores malformed and unknown live update events while applying valid job events", async () => {
    const WebSocketStub = installWebSocketStub();
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});
    const timeoutSpy = vi.spyOn(window, "setTimeout");

    const { controller } = renderController({
      onWorkspaceCapacityRefresh,
      initialWorkspace: seeded(processingJob()),
    });

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
    });

    act(() => {
      WebSocketStub.instances[0].onmessage(
        liveMessage(
          invalidation(""),
          { type: "future_event", payload: { value: "ignored" } },
          lifecycle(completedUpdate("2026-05-06T12:03:00.000Z")),
        ),
      );
    });

    await waitFor(() => {
      expect(findDocument(controller(), "job_processing_1")).toMatchObject({
        status: "completed",
        completed_at: "2026-05-06T12:03:00.000Z",
      });
    });
    expect(timeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 150);
    expect(onWorkspaceCapacityRefresh).not.toHaveBeenCalled();
  });

  it("coalesces burst invalidations into a throttled trailing Workspace context refresh", async () => {
    vi.useFakeTimers();
    const WebSocketStub = installWebSocketStub();
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});

    const advance = (ms) =>
      act(async () => {
        vi.advanceTimersByTime(ms);
        await Promise.resolve();
      });

    try {
      renderController({ onWorkspaceCapacityRefresh });

      expect(WebSocketStub.instances).toHaveLength(1);

      act(() => {
        WebSocketStub.instances[0].onmessage(liveMessage(invalidation("workspace_product_changed")));
      });

      await advance(150);
      expect(onWorkspaceCapacityRefresh).toHaveBeenCalledOnce();

      act(() => {
        WebSocketStub.instances[0].onmessage(
          liveMessage(
            invalidation("workspace_product_changed", "2026-05-06T12:02:01.000Z"),
            invalidation("template_shape_changed", "2026-05-06T12:02:02.000Z"),
          ),
        );
      });

      await advance(2999);
      expect(onWorkspaceCapacityRefresh).toHaveBeenCalledOnce();

      await advance(1);
      expect(onWorkspaceCapacityRefresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores live update events from stale sockets after the accepted Workspace context changes", async () => {
    vi.useFakeTimers();
    const WebSocketStub = installWebSocketStub();
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});

    const advance = (ms) =>
      act(async () => {
        vi.advanceTimersByTime(ms);
        await Promise.resolve();
      });

    try {
      const { rerender } = render(
        <DocumentControllerHarness workspaceId="ws_1" onWorkspaceCapacityRefresh={onWorkspaceCapacityRefresh} />,
      );

      expect(WebSocketStub.instances).toHaveLength(1);
      const staleSocket = WebSocketStub.instances[0];

      act(() => {
        staleSocket.onmessage(liveMessage(invalidation("workspace_product_changed", "2026-05-06T12:01:00.000Z")));
      });

      rerender(
        <DocumentControllerHarness workspaceId="ws_2" onWorkspaceCapacityRefresh={onWorkspaceCapacityRefresh} />,
      );

      expect(WebSocketStub.instances).toHaveLength(2);
      expect(staleSocket.close).toHaveBeenCalled();

      act(() => {
        staleSocket.onmessage(liveMessage(invalidation("workspace_product_changed")));
      });

      await advance(150);
      expect(onWorkspaceCapacityRefresh).not.toHaveBeenCalled();

      act(() => {
        WebSocketStub.instances[1].onmessage(
          liveMessage(invalidation("workspace_product_changed", "2026-05-06T12:03:00.000Z")),
        );
      });

      await advance(150);
      expect(onWorkspaceCapacityRefresh).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not refresh Workspace capacity when selecting a document whose status is unchanged", async () => {
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});
    const timeoutSpy = vi.spyOn(window, "setTimeout");
    const job = completedJob({ results: [] });
    const request = vi.fn(async (path) => (path === "/jobs/job_completed_1" ? job : jobList([job])));

    renderController({ request, onWorkspaceCapacityRefresh, initialWorkspace: seeded(job) });

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith("/jobs/job_completed_1", { method: "GET" });
    });

    expect(timeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 150);
    expect(onWorkspaceCapacityRefresh).not.toHaveBeenCalled();
  });

  it("preserves document list order when a live lifecycle update omits the created timestamp", async () => {
    const WebSocketStub = installWebSocketStub();

    const jobs = [
      completedJob({
        job_id: "job_newer_1",
        source_name: "newer.pdf",
        created_at: "2026-05-06T12:03:00.000Z",
        updated_at: "2026-05-06T12:04:00.000Z",
      }),
      processingJob({
        source_name: "processing.pdf",
        created_at: "2026-05-06T12:02:00.000Z",
        updated_at: "2026-05-06T12:02:30.000Z",
      }),
      completedJob({
        job_id: "job_older_1",
        source_name: "older.pdf",
        created_at: "2026-05-06T12:01:00.000Z",
        updated_at: "2026-05-06T12:01:30.000Z",
      }),
    ];

    const completedProcessingJob = completedUpdate("2026-05-06T12:05:00.000Z", { source_name: "processing.pdf" });

    const request = vi.fn(async (path) => {
      if (path === "/jobs") return jobList(jobs);

      if (path === "/jobs/job_processing_1") return completedProcessingJob;

      return jobs.find((job) => path === `/jobs/${job.job_id}`) || jobs[0];
    });

    const documentIds = () => controller().contextList.documents.map((job) => job.job_id);

    const { controller } = renderController({ request, initialWorkspace: seeded(...jobs) });

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
      expect(documentIds()).toEqual(["job_newer_1", "job_processing_1", "job_older_1"]);
    });

    act(() => {
      WebSocketStub.instances[0].onmessage(liveMessage(lifecycle(completedProcessingJob)));
    });

    await waitFor(() => {
      expect(findDocument(controller(), "job_processing_1")?.status).toBe("completed");
    });
    expect(documentIds()).toEqual(["job_newer_1", "job_processing_1", "job_older_1"]);
  });

  it("revalidates job and model configuration state over HTTP after reconnecting live updates", async () => {
    vi.useFakeTimers();
    const WebSocketStub = installWebSocketStub();
    const request = vi.fn(async () => jobList([]));
    const onModelConfigurationInvalidation = vi.fn();

    try {
      renderController({ request, onModelConfigurationInvalidation });

      expect(WebSocketStub.instances).toHaveLength(1);
      request.mockClear();

      act(() => {
        WebSocketStub.instances[0].onclose();
      });
      await act(async () => {
        vi.runOnlyPendingTimers();
        await Promise.resolve();
      });

      expect(WebSocketStub.instances).toHaveLength(2);
      act(() => {
        WebSocketStub.instances[1].onopen();
      });
      expect(request).toHaveBeenCalledWith("/jobs", { method: "GET" });
      expect(onModelConfigurationInvalidation).toHaveBeenCalledTimes(1);
      act(() => {
        WebSocketStub.instances[1].onmessage(
          liveMessage(invalidation("model_configuration_changed", "2026-09-03T00:00:00.000Z")),
        );
      });
      expect(onModelConfigurationInvalidation).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restore a locally deleted Document when a stale lifecycle message arrives", async () => {
    const WebSocketStub = installWebSocketStub();
    const job = processingJob({ job_id: "job_deleted_1", template_version: 1 });

    const { controller } = renderController({
      documentRequests: { deleteDocument: vi.fn(async () => ({ deleted: true, job_id: "job_deleted_1" })) },
      initialWorkspace: seeded(job),
      request: vi.fn(async () => jobList([job])),
    });

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
      expect(controller().contextList.selectedDocumentId).toBe("job_deleted_1");
      expect(controller().toolbar.documentCount).toBe(1);
    });
    let deletion;
    await act(async () => {
      deletion = controller().toolbar.onDeleteDocument();
    });
    await answerDialog("Delete document");
    await act(async () => {
      await deletion;
    });
    expect(controller().contextList.documents).toEqual([]);
    expect(controller().toolbar.documentCount).toBe(0);

    act(() => {
      WebSocketStub.instances[0].onmessage(liveMessage(lifecycle(job)));
    });
    expect(controller().contextList.documents).toEqual([]);
  });

  it("uses the backend's unfiltered total for the Documents count while rendering a filtered collection", async () => {
    installWebSocketStub();
    const filteredJob = completedJob({ job_id: "job_invoice_1", template_id: "template_invoice" });

    const { controller } = renderController({ request: vi.fn(async () => jobList([filteredJob], { total: 4 })) });

    await waitFor(() => {
      expect(controller().contextList.documents).toEqual([expect.objectContaining({ job_id: "job_invoice_1" })]);
      expect(controller().toolbar.documentCount).toBe(4);
    });
  });

  it("reloads paginated Documents with applied advanced filters and exposes model choices", async () => {
    const WebSocketStub = installWebSocketStub();
    const listDocuments = vi.fn(async () => jobList([], { total: 4 }));

    const getFilterOptions = vi.fn(async () => ({
      available_models: ["provider/model-b", "provider/model-a", "provider/model-a"],
    }));

    const { controller } = renderController({ documentRequests: { getFilterOptions, listDocuments } });

    await waitFor(() => {
      expect(listDocuments).toHaveBeenCalledWith({
        search: "",
        filters: { dateFrom: "", dateTo: "", model: "" },
        cursor: null,
      });
      expect(controller().contextList.availableModels).toEqual(["provider/model-a", "provider/model-b"]);
      expect(getFilterOptions).toHaveBeenCalledOnce();
    });

    const filters = { dateFrom: "2026-08-01", dateTo: "2026-08-16", model: "provider/model-b" };
    act(() => {
      controller().contextList.onFiltersChange(filters);
    });

    await waitFor(() => {
      expect(listDocuments).toHaveBeenLastCalledWith({ search: "", filters, cursor: null });
      expect(controller().contextList.hasActiveFilters).toBe(true);
      expect(getFilterOptions).toHaveBeenCalledOnce();
    });

    act(() => {
      WebSocketStub.instances[0].onmessage(
        liveMessage(
          lifecycle(
            completedJob({
              job_id: "job_new_model",
              source_name: "new-model.pdf",
              model_name: "provider/model-c",
              created_at: "2026-08-16T12:00:00.000Z",
              updated_at: "2026-08-16T12:01:00.000Z",
            }),
          ),
        ),
      );
    });
    expect(controller().contextList.availableModels).toEqual([
      "provider/model-a",
      "provider/model-b",
      "provider/model-c",
    ]);
    expect(getFilterOptions).toHaveBeenCalledOnce();
  });

  it("appends a cursor page without duplicates while retaining the selected Document", async () => {
    installWebSocketStub();

    const page = (id, minute) =>
      completedJob({
        job_id: id,
        source_name: `${id}.pdf`,
        created_at: `2026-05-06T12:0${minute}:00.000Z`,
        updated_at: `2026-05-06T12:0${minute}:00.000Z`,
      });

    const firstPage = [page("job_2", 2), page("job_1", 1)];
    const nextPage = [firstPage[1], page("job_0", 0)];

    const listDocuments = vi.fn(async ({ cursor } = {}) =>
      cursor
        ? jobList(nextPage, { total: 3 })
        : jobList(firstPage, { total: 3, next_cursor: "cursor_1", has_more: true }),
    );

    const documentIds = () => controller().contextList.documents.map((job) => job.job_id);

    const { controller } = renderController({
      documentRequests: { listDocuments },
      initialWorkspace: { selectedDocumentId: "job_2" },
    });

    await waitFor(() => {
      expect(documentIds()).toEqual(["job_2", "job_1"]);
      expect(controller().contextList.hasMoreDocuments).toBe(true);
    });
    await act(async () => {
      await controller().contextList.onLoadMoreDocuments();
    });
    expect(documentIds()).toEqual(["job_2", "job_1", "job_0"]);
    expect(controller().contextList.selectedDocumentId).toBe("job_2");
    expect(controller().contextList.hasMoreDocuments).toBe(false);
    expect(controller().toolbar.documentCount).toBe(3);
  });
});

function processingJob(overrides = {}) {
  return {
    job_id: "job_processing_1",
    status: "processing",
    source_name: "invoice.pdf",
    template_id: "template_test",
    created_at: "2026-05-06T12:00:00.000Z",
    updated_at: "2026-05-06T12:01:00.000Z",
    ...overrides,
  };
}

function completedJob(overrides = {}) {
  return {
    job_id: "job_completed_1",
    status: "completed",
    source_name: "invoice.pdf",
    template_id: "template_test",
    created_at: "2026-05-06T12:00:00.000Z",
    updated_at: "2026-05-06T12:02:00.000Z",
    completed_at: "2026-05-06T12:02:00.000Z",
    ...overrides,
  };
}

// A lifecycle payload completing job_processing_1; like real live updates, it omits created_at.
function completedUpdate(at, overrides = {}) {
  return {
    job_id: "job_processing_1",
    status: "completed",
    source_name: "invoice.pdf",
    template_id: "template_test",
    updated_at: at,
    completed_at: at,
    ...overrides,
  };
}

function seeded(...jobs) {
  return { selectedDocumentId: jobs[0].job_id, jobHistory: jobs };
}

function jobList(jobs, overrides = {}) {
  return { jobs, next_cursor: null, has_more: false, ...overrides };
}

function findDocument(controller, jobId) {
  return controller.contextList.documents.find((document) => document.job_id === jobId);
}

function lifecycle(job) {
  return { type: "extraction_job_lifecycle", job };
}

function invalidation(reason, occurredAt = "2026-05-06T12:02:00.000Z") {
  return { type: "workspace_context_invalidated", reason, occurred_at: occurredAt };
}

function liveMessage(...events) {
  return { data: JSON.stringify({ version: 1, events }) };
}

function renderController(props = {}) {
  let controller = null;

  const view = render(
    <DocumentControllerHarness
      workspaceId="ws_1"
      onController={(value) => {
        controller = value;
      }}
      {...props}
    />,
  );

  return { ...view, controller: () => controller };
}

function DocumentControllerHarness({
  workspaceId,
  initialWorkspace = {},
  isWorkspaceDeletionInProgress = false,
  documentRequests,
  onController,
  showList = false,
  onWorkspaceCapacityRefresh,
  onModelConfigurationInvalidation,
  request = vi.fn(async () => jobList([])),
}) {
  const resolvedDocumentRequests = {
    deleteDocument: vi.fn(async () => ({ deleted: true, job_id: "" })),
    getFilterOptions: () => request("/jobs/filter-options", { method: "GET" }),
    listDocuments: async ({ search = "", cursor = null } = {}) => {
      const params = new URLSearchParams();

      if (search) params.set("search", search);

      if (cursor) params.set("cursor", cursor);
      const result = await request(`/jobs${params.size ? `?${params}` : ""}`, { method: "GET" });
      const jobs = Array.isArray(result?.jobs) ? result.jobs : [];

      return {
        jobs,
        total: Number.isFinite(result?.total) ? result.total : jobs.length,
        next_cursor: result?.next_cursor || null,
        has_more: Boolean(result?.has_more),
      };
    },
    getDocument: (documentId) => request(`/jobs/${encodeURIComponent(documentId)}`, { method: "GET" }),
    submitDocument: (formData) => request("/extract", { method: "POST", body: formData }),
    ...documentRequests,
  };

  const controller = useDocumentController({
    apiBase: "/v1",
    initialWorkspace,
    templates: [],
    selectedUploadTemplateId: "",
    onSelectedUploadTemplateChange: vi.fn(),
    documentRequests: resolvedDocumentRequests,
    showActionToast: vi.fn(),
    showDocumentUploadToast: vi.fn(),
    hasApiAccess: true,
    hasWorkspaceApiAccess: true,
    isAppBusy: false,
    isWorkspaceDeletionInProgress,
    workspaceId,
    sessionId: "user_1",
    onWorkspaceAccessRevalidation: onWorkspaceCapacityRefresh,
    onWorkspaceCapacityRefresh,
    onModelConfigurationInvalidation,
    onActivePageChange: vi.fn(),
  });

  onController?.(controller);

  return showList ? <DocumentContextList {...controller.contextList} /> : null;
}

function installWebSocketStub() {
  class WebSocketStub {
    static instances = [];
    close = vi.fn();
    onclose = null;
    onerror = null;
    onmessage = null;
    onopen = null;

    constructor(url) {
      this.url = url;
      WebSocketStub.instances.push(this);
    }
  }

  globalThis.WebSocket = WebSocketStub;

  return WebSocketStub;
}
