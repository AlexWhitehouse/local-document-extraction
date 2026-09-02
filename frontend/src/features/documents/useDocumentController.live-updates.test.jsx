import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { useDocumentController } from "./useDocumentController";

describe("useDocumentController Workspace live updates", () => {
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

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        initialWorkspace={{
          selectedDocumentId: "job_processing_1",
          jobHistory: [
            {
              job_id: "job_processing_1",
              status: "processing",
              source_name: "invoice.pdf",
              template_id: "template_test",
              created_at: "2026-05-06T12:00:00.000Z",
              updated_at: "2026-05-06T12:01:00.000Z",
            },
          ],
        }}
      />,
    );

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
    const processingDetails = {
      job_id: "job_processing_1",
      status: "processing",
      source_name: "invoice.pdf",
      template_id: "template_test",
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:01:00.000Z",
    };
    let failDetailRequest = false;
    const request = vi.fn(async (path) => {
      if (path === "/jobs/job_processing_1") {
        if (failDetailRequest) {
          throw new TypeError("Temporary network failure");
        }
        return processingDetails;
      }
      return { jobs: [processingDetails], next_cursor: null, has_more: false };
    });

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        request={request}
        initialWorkspace={{
          selectedDocumentId: "job_processing_1",
          jobHistory: [processingDetails],
        }}
      />,
    );

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
    let controller = null;
    const completedDetails = {
      job_id: "job_processing_1",
      status: "completed",
      source_name: "invoice.pdf",
      template_id: "template_test",
      template_version: 1,
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:02:00.000Z",
      completed_at: "2026-05-06T12:02:00.000Z",
      results: [
        {
          field_id: "invoice_total",
          name: "Invoice Total",
          answer: "$42.00",
          confidence: 0.99,
        },
      ],
    };
    const processingDetails = {
      job_id: "job_processing_1",
      status: "processing",
      source_name: "invoice.pdf",
      template_id: "template_test",
      template_version: 1,
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:01:00.000Z",
    };
    let shouldReturnCompletedDetails = false;
    const request = vi.fn(async (path) => {
      if (path === "/jobs/job_processing_1") {
        return shouldReturnCompletedDetails ? completedDetails : processingDetails;
      }
      return { jobs: [], next_cursor: null, has_more: false };
    });

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        request={request}
        onController={(nextController) => {
          controller = nextController;
        }}
        initialWorkspace={{
          selectedDocumentId: "job_processing_1",
          jobHistory: [
            {
              job_id: "job_processing_1",
              status: "processing",
              source_name: "invoice.pdf",
              template_id: "template_test",
              template_version: 1,
              created_at: "2026-05-06T12:00:00.000Z",
              updated_at: "2026-05-06T12:01:00.000Z",
            },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
    });
    request.mockClear();

    shouldReturnCompletedDetails = true;
    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [
            {
              type: "extraction_job_lifecycle",
              job: {
                job_id: "job_processing_1",
                status: "completed",
                source_name: "invoice.pdf",
                template_id: "template_test",
                template_version: 1,
                error_code: null,
                error_message: null,
                created_at: "2026-05-06T12:00:00.000Z",
                updated_at: "2026-05-06T12:02:00.000Z",
                completed_at: "2026-05-06T12:02:00.000Z",
                current_attempt: 1,
                completed_attempt: 1,
                last_failed_attempt: 0,
              },
            },
          ],
        }),
      });
    });

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith("/jobs/job_processing_1", {
        method: "GET",
      });
    });
    await waitFor(() => {
      expect(controller.contextList.documents[0]).toMatchObject({
        job_id: "job_processing_1",
        status: "completed",
        completed_at: "2026-05-06T12:02:00.000Z",
        results: [
          expect.objectContaining({
            field_id: "invoice_total",
            answer: "$42.00",
          }),
        ],
      });
    });
  });

  it("deduplicates selected completed detail hydration while live updates are active", async () => {
    const WebSocketStub = installWebSocketStub();
    const completedSummary = {
      job_id: "job_completed_1",
      status: "completed",
      source_name: "invoice.pdf",
      template_id: "template_test",
      template_version: 1,
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:02:00.000Z",
      completed_at: "2026-05-06T12:02:00.000Z",
      results: [],
    };
    const completedDetails = {
      ...completedSummary,
      results: [
        {
          field_id: "invoice_total",
          name: "Invoice Total",
          answer: "$42.00",
          confidence: 0.99,
        },
      ],
    };
    const request = vi.fn(async (path) => {
      if (path === "/jobs/job_completed_1") {
        return completedDetails;
      }
      return { jobs: [completedSummary], next_cursor: null, has_more: false };
    });

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        request={request}
        initialWorkspace={{
          selectedDocumentId: "job_completed_1",
          jobHistory: [completedSummary],
        }}
      />,
    );

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
      expect(
        request.mock.calls.filter(([path]) => path === "/jobs/job_completed_1"),
      ).toHaveLength(1);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      request.mock.calls.filter(([path]) => path === "/jobs/job_completed_1"),
    ).toHaveLength(1);
  });

  it("does not select a background document when its live lifecycle update completes", async () => {
    const WebSocketStub = installWebSocketStub();
    let controller = null;
    const jobs = [
      {
        job_id: "job_reviewing_1",
        status: "completed",
        source_name: "selected.pdf",
        template_id: "template_test",
        created_at: "2026-05-06T12:00:00.000Z",
        updated_at: "2026-05-06T12:02:00.000Z",
      },
      {
        job_id: "job_processing_1",
        status: "processing",
        source_name: "background.pdf",
        template_id: "template_test",
        created_at: "2026-05-06T12:01:00.000Z",
        updated_at: "2026-05-06T12:01:00.000Z",
      },
    ];
    const request = vi.fn(async (path) => {
      if (path === "/jobs") {
        return { jobs, next_cursor: null, has_more: false };
      }
      return jobs.find((job) => path === `/jobs/${job.job_id}`) || jobs[0];
    });

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        request={request}
        onController={(nextController) => {
          controller = nextController;
        }}
        initialWorkspace={{
          selectedDocumentId: "job_reviewing_1",
          jobHistory: jobs,
        }}
      />,
    );

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
      expect(controller.contextList.selectedDocumentId).toBe("job_reviewing_1");
    });
    request.mockClear();

    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [
            {
              type: "extraction_job_lifecycle",
              job: {
                job_id: "job_processing_1",
                status: "completed",
                source_name: "background.pdf",
                template_id: "template_test",
                error_code: null,
                error_message: null,
                updated_at: "2026-05-06T12:03:00.000Z",
                completed_at: "2026-05-06T12:03:00.000Z",
              },
            },
          ],
        }),
      });
    });

    await waitFor(() => {
      expect(
        controller.contextList.documents.find(
          (document) => document.job_id === "job_processing_1",
        ),
      ).toMatchObject({
        status: "completed",
        completed_at: "2026-05-06T12:03:00.000Z",
      });
    });
    expect(controller.contextList.selectedDocumentId).toBe("job_reviewing_1");
    expect(request).not.toHaveBeenCalledWith("/jobs/job_processing_1", {
      method: "GET",
    });
  });

  it("updates Documents UI without refreshing Workspace context when live lifecycle updates arrive", async () => {
    const WebSocketStub = installWebSocketStub();
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});
    const timeoutSpy = vi.spyOn(window, "setTimeout");
    let controller = null;

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        onWorkspaceCapacityRefresh={onWorkspaceCapacityRefresh}
        onController={(nextController) => {
          controller = nextController;
        }}
        initialWorkspace={{
          selectedDocumentId: "job_processing_1",
          jobHistory: [
            {
              job_id: "job_processing_1",
              status: "processing",
              source_name: "invoice.pdf",
              template_id: "template_test",
              created_at: "2026-05-06T12:00:00.000Z",
              updated_at: "2026-05-06T12:01:00.000Z",
            },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
    });

    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [
            {
              type: "extraction_job_lifecycle",
              job: {
                job_id: "job_processing_1",
                status: "completed",
                source_name: "invoice.pdf",
                template_id: "template_test",
                updated_at: "2026-05-06T12:02:00.000Z",
                completed_at: "2026-05-06T12:02:00.000Z",
              },
            },
          ],
        }),
      });
    });

    await waitFor(() => {
      expect(
        controller.contextList.documents.find(
          (document) => document.job_id === "job_processing_1",
        ),
      ).toMatchObject({
        status: "completed",
        completed_at: "2026-05-06T12:02:00.000Z",
      });
    });
    expect(timeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 150);
    expect(onWorkspaceCapacityRefresh).not.toHaveBeenCalled();
  });

  it("increments the document total once when live updates add a new Document", async () => {
    const WebSocketStub = installWebSocketStub();
    let controller = null;

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        onController={(nextController) => {
          controller = nextController;
        }}
        request={vi.fn(async () => ({
          jobs: [],
          total: 0,
          next_cursor: null,
          has_more: false,
        }))}
      />,
    );

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
      expect(controller.toolbar.documentCount).toBe(0);
    });

    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [{
            type: "extraction_job_lifecycle",
            job: {
              job_id: "job_live_1",
              status: "queued",
              source_name: "invoice.pdf",
              template_id: "template_test",
              created_at: "2026-05-06T12:00:00.000Z",
              updated_at: "2026-05-06T12:00:00.000Z",
            },
          }],
        }),
      });
    });

    await waitFor(() => {
      expect(controller.toolbar.documentCount).toBe(1);
    });

    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [{
            type: "extraction_job_lifecycle",
            job: {
              job_id: "job_live_1",
              status: "processing",
              source_name: "invoice.pdf",
              template_id: "template_test",
              created_at: "2026-05-06T12:00:00.000Z",
              updated_at: "2026-05-06T12:01:00.000Z",
            },
          }],
        }),
      });
    });

    expect(controller.toolbar.documentCount).toBe(1);
  });

  it("refreshes Workspace context when live invalidation updates arrive", async () => {
    const WebSocketStub = installWebSocketStub();
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        onWorkspaceCapacityRefresh={onWorkspaceCapacityRefresh}
      />,
    );

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
    });

    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [
            {
              type: "workspace_context_invalidated",
              reason: "workspace_product_changed",
              occurred_at: "2026-05-06T12:02:00.000Z",
            },
          ],
        }),
      });
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
      render(
        <DocumentControllerHarness
          workspaceId="ws_1"
          onWorkspaceCapacityRefresh={onWorkspaceCapacityRefresh}
        />,
      );

      expect(WebSocketStub.instances).toHaveLength(1);

      await act(async () => {
        WebSocketStub.instances[0].onmessage({
          data: JSON.stringify({
            version: 1,
            events: [
              {
                type: "workspace_context_invalidated",
                reason: "workspace_access",
                occurred_at: "2026-05-06T12:02:00.000Z",
              },
            ],
          }),
        });
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

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        isWorkspaceDeletionInProgress
        onWorkspaceCapacityRefresh={onWorkspaceCapacityRefresh}
      />,
    );

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
    });
    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [{
            type: "workspace_context_invalidated",
            reason: "workspace_access",
            occurred_at: "2026-05-06T12:02:00.000Z",
          }],
        }),
      });
    });

    expect(onWorkspaceCapacityRefresh).not.toHaveBeenCalled();
  });

  it("blocks useful live update effects until Workspace access revalidation succeeds", async () => {
    const WebSocketStub = installWebSocketStub();
    let controller = null;
    let resolveAccessRevalidation;
    const accessRevalidation = new Promise((resolve) => {
      resolveAccessRevalidation = resolve;
    });
    const onWorkspaceCapacityRefresh = vi.fn(() => accessRevalidation);
    const processingJob = {
      job_id: "job_processing_1",
      status: "processing",
      source_name: "invoice.pdf",
      template_id: "template_test",
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:01:00.000Z",
    };
    const request = vi.fn(async () => ({
      jobs: [processingJob],
      next_cursor: null,
      has_more: false,
    }));

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        request={request}
        onWorkspaceCapacityRefresh={onWorkspaceCapacityRefresh}
        onController={(nextController) => {
          controller = nextController;
        }}
        initialWorkspace={{
          jobHistory: [processingJob],
        }}
      />,
    );

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
      expect(
        controller.contextList.documents.find(
          (document) => document.job_id === "job_processing_1",
        ),
      ).toMatchObject({ status: "processing" });
    });

    await act(async () => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [
            {
              type: "workspace_context_invalidated",
              reason: "workspace_access",
              occurred_at: "2026-05-06T12:02:00.000Z",
            },
          ],
        }),
      });
      await Promise.resolve();
    });
    expect(onWorkspaceCapacityRefresh).toHaveBeenCalledOnce();

    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [
            {
              type: "extraction_job_lifecycle",
              job: {
                job_id: "job_processing_1",
                status: "completed",
                source_name: "invoice.pdf",
                template_id: "template_test",
                updated_at: "2026-05-06T12:03:00.000Z",
                completed_at: "2026-05-06T12:03:00.000Z",
              },
            },
          ],
        }),
      });
    });

    expect(
      controller.contextList.documents.find(
        (document) => document.job_id === "job_processing_1",
      ),
    ).toMatchObject({ status: "processing" });

    await act(async () => {
      resolveAccessRevalidation();
      await accessRevalidation;
      await Promise.resolve();
    });

    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [
            {
              type: "extraction_job_lifecycle",
              job: {
                job_id: "job_processing_1",
                status: "completed",
                source_name: "invoice.pdf",
                template_id: "template_test",
                updated_at: "2026-05-06T12:04:00.000Z",
                completed_at: "2026-05-06T12:04:00.000Z",
              },
            },
          ],
        }),
      });
    });

    await waitFor(() => {
      expect(
        controller.contextList.documents.find(
          (document) => document.job_id === "job_processing_1",
        ),
      ).toMatchObject({
        status: "completed",
        completed_at: "2026-05-06T12:04:00.000Z",
      });
    });
  });

  it("ignores malformed and unknown live update events while applying valid job events", async () => {
    const WebSocketStub = installWebSocketStub();
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});
    const timeoutSpy = vi.spyOn(window, "setTimeout");
    let controller = null;

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        onWorkspaceCapacityRefresh={onWorkspaceCapacityRefresh}
        onController={(nextController) => {
          controller = nextController;
        }}
        initialWorkspace={{
          selectedDocumentId: "job_processing_1",
          jobHistory: [
            {
              job_id: "job_processing_1",
              status: "processing",
              source_name: "invoice.pdf",
              template_id: "template_test",
              created_at: "2026-05-06T12:00:00.000Z",
              updated_at: "2026-05-06T12:01:00.000Z",
            },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
    });

    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [
            {
              type: "workspace_context_invalidated",
              reason: "",
              occurred_at: "2026-05-06T12:02:00.000Z",
            },
            {
              type: "future_event",
              payload: { value: "ignored" },
            },
            {
              type: "extraction_job_lifecycle",
              job: {
                job_id: "job_processing_1",
                status: "completed",
                source_name: "invoice.pdf",
                template_id: "template_test",
                updated_at: "2026-05-06T12:03:00.000Z",
                completed_at: "2026-05-06T12:03:00.000Z",
              },
            },
          ],
        }),
      });
    });

    await waitFor(() => {
      expect(
        controller.contextList.documents.find(
          (document) => document.job_id === "job_processing_1",
        ),
      ).toMatchObject({
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

    try {
      render(
        <DocumentControllerHarness
          workspaceId="ws_1"
          onWorkspaceCapacityRefresh={onWorkspaceCapacityRefresh}
        />,
      );

      expect(WebSocketStub.instances).toHaveLength(1);

      act(() => {
        WebSocketStub.instances[0].onmessage({
          data: JSON.stringify({
            version: 1,
            events: [
              {
                type: "workspace_context_invalidated",
                reason: "workspace_product_changed",
                occurred_at: "2026-05-06T12:02:00.000Z",
              },
            ],
          }),
        });
      });

      await act(async () => {
        vi.advanceTimersByTime(150);
        await Promise.resolve();
      });
      expect(onWorkspaceCapacityRefresh).toHaveBeenCalledOnce();

      act(() => {
        WebSocketStub.instances[0].onmessage({
          data: JSON.stringify({
            version: 1,
            events: [
              {
                type: "workspace_context_invalidated",
                reason: "workspace_product_changed",
                occurred_at: "2026-05-06T12:02:01.000Z",
              },
              {
                type: "workspace_context_invalidated",
                reason: "template_shape_changed",
                occurred_at: "2026-05-06T12:02:02.000Z",
              },
            ],
          }),
        });
      });

      await act(async () => {
        vi.advanceTimersByTime(2999);
        await Promise.resolve();
      });
      expect(onWorkspaceCapacityRefresh).toHaveBeenCalledOnce();

      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });
      expect(onWorkspaceCapacityRefresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores live update events from stale sockets after the accepted Workspace context changes", async () => {
    vi.useFakeTimers();
    const WebSocketStub = installWebSocketStub();
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});

    try {
      const { rerender } = render(
        <DocumentControllerHarness
          workspaceId="ws_1"
          onWorkspaceCapacityRefresh={onWorkspaceCapacityRefresh}
        />,
      );

      expect(WebSocketStub.instances).toHaveLength(1);
      const staleSocket = WebSocketStub.instances[0];

      act(() => {
        staleSocket.onmessage({
          data: JSON.stringify({
            version: 1,
            events: [
              {
                type: "workspace_context_invalidated",
                reason: "workspace_product_changed",
                occurred_at: "2026-05-06T12:01:00.000Z",
              },
            ],
          }),
        });
      });

      rerender(
        <DocumentControllerHarness
          workspaceId="ws_2"
          onWorkspaceCapacityRefresh={onWorkspaceCapacityRefresh}
        />,
      );

      expect(WebSocketStub.instances).toHaveLength(2);
      expect(staleSocket.close).toHaveBeenCalled();

      act(() => {
        staleSocket.onmessage({
          data: JSON.stringify({
            version: 1,
            events: [
              {
                type: "workspace_context_invalidated",
                reason: "workspace_product_changed",
                occurred_at: "2026-05-06T12:02:00.000Z",
              },
            ],
          }),
        });
      });

      await act(async () => {
        vi.advanceTimersByTime(150);
        await Promise.resolve();
      });
      expect(onWorkspaceCapacityRefresh).not.toHaveBeenCalled();

      act(() => {
        WebSocketStub.instances[1].onmessage({
          data: JSON.stringify({
            version: 1,
            events: [
              {
                type: "workspace_context_invalidated",
                reason: "workspace_product_changed",
                occurred_at: "2026-05-06T12:03:00.000Z",
              },
            ],
          }),
        });
      });

      await act(async () => {
        vi.advanceTimersByTime(150);
        await Promise.resolve();
      });
      expect(onWorkspaceCapacityRefresh).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not refresh Workspace capacity when selecting a document whose status is unchanged", async () => {
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});
    const timeoutSpy = vi.spyOn(window, "setTimeout");
    const completedJob = {
      job_id: "job_completed_1",
      status: "completed",
      source_name: "invoice.pdf",
      template_id: "template_test",
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:02:00.000Z",
      completed_at: "2026-05-06T12:02:00.000Z",
      results: [],
    };
    const request = vi.fn(async (path) => {
      if (path === "/jobs/job_completed_1") {
        return completedJob;
      }
      return { jobs: [completedJob], next_cursor: null, has_more: false };
    });

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        request={request}
        onWorkspaceCapacityRefresh={onWorkspaceCapacityRefresh}
        initialWorkspace={{
          selectedDocumentId: "job_completed_1",
          jobHistory: [completedJob],
        }}
      />,
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith("/jobs/job_completed_1", {
        method: "GET",
      });
    });

    expect(timeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 150);
    expect(onWorkspaceCapacityRefresh).not.toHaveBeenCalled();
  });

  it("preserves document list order when a live lifecycle update omits the created timestamp", async () => {
    const WebSocketStub = installWebSocketStub();
    let controller = null;
    const jobs = [
      {
        job_id: "job_newer_1",
        status: "completed",
        source_name: "newer.pdf",
        template_id: "template_test",
        created_at: "2026-05-06T12:03:00.000Z",
        updated_at: "2026-05-06T12:04:00.000Z",
      },
      {
        job_id: "job_processing_1",
        status: "processing",
        source_name: "processing.pdf",
        template_id: "template_test",
        created_at: "2026-05-06T12:02:00.000Z",
        updated_at: "2026-05-06T12:02:30.000Z",
      },
      {
        job_id: "job_older_1",
        status: "completed",
        source_name: "older.pdf",
        template_id: "template_test",
        created_at: "2026-05-06T12:01:00.000Z",
        updated_at: "2026-05-06T12:01:30.000Z",
      },
    ];
    const completedProcessingJob = {
      job_id: "job_processing_1",
      status: "completed",
      source_name: "processing.pdf",
      template_id: "template_test",
      updated_at: "2026-05-06T12:05:00.000Z",
      completed_at: "2026-05-06T12:05:00.000Z",
    };
    const request = vi.fn(async (path) => {
      if (path === "/jobs") {
        return { jobs, next_cursor: null, has_more: false };
      }
      if (path === "/jobs/job_processing_1") {
        return completedProcessingJob;
      }
      return jobs.find((job) => path === `/jobs/${job.job_id}`) || jobs[0];
    });

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        request={request}
        onController={(nextController) => {
          controller = nextController;
        }}
        initialWorkspace={{
          selectedDocumentId: "job_newer_1",
          jobHistory: jobs,
        }}
      />,
    );

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
      expect(controller.contextList.documents.map((job) => job.job_id)).toEqual([
        "job_newer_1",
        "job_processing_1",
        "job_older_1",
      ]);
    });

    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [
            {
              type: "extraction_job_lifecycle",
              job: completedProcessingJob,
            },
          ],
        }),
      });
    });

    await waitFor(() => {
      expect(
        controller.contextList.documents.find(
          (document) => document.job_id === "job_processing_1",
        )?.status,
      ).toBe("completed");
    });
    expect(controller.contextList.documents.map((job) => job.job_id)).toEqual([
      "job_newer_1",
      "job_processing_1",
      "job_older_1",
    ]);
  });

  it("revalidates job and model configuration state over HTTP after reconnecting live updates", async () => {
    vi.useFakeTimers();
    const WebSocketStub = installWebSocketStub();
    const request = vi.fn(async () => ({ jobs: [], next_cursor: null, has_more: false }));
    const onModelConfigurationInvalidation = vi.fn();

    try {
      render(<DocumentControllerHarness workspaceId="ws_1" request={request} onModelConfigurationInvalidation={onModelConfigurationInvalidation} />);

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
      act(() => { WebSocketStub.instances[1].onopen(); });
      expect(request).toHaveBeenCalledWith("/jobs", { method: "GET" });
      expect(onModelConfigurationInvalidation).toHaveBeenCalledTimes(1);
      act(() => { WebSocketStub.instances[1].onmessage({ data: JSON.stringify({ version: 1, events: [{ type: "workspace_context_invalidated", reason: "model_configuration_changed", occurred_at: "2026-09-03T00:00:00.000Z" }] }) }); });
      expect(onModelConfigurationInvalidation).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restore a locally deleted Document when a stale lifecycle message arrives", async () => {
    const WebSocketStub = installWebSocketStub();
    let controller = null;
    const job = {
      job_id: "job_deleted_1",
      status: "processing",
      source_name: "invoice.pdf",
      template_id: "template_test",
      template_version: 1,
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:01:00.000Z",
    };
    const documentRequests = {
      deleteDocument: vi.fn(async () => ({ deleted: true, job_id: "job_deleted_1" })),
    };
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        documentRequests={documentRequests}
        initialWorkspace={{ selectedDocumentId: "job_deleted_1", jobHistory: [job] }}
        onController={(nextController) => {
          controller = nextController;
        }}
        request={vi.fn(async () => ({ jobs: [job], next_cursor: null, has_more: false }))}
      />,
    );

    await waitFor(() => {
      expect(WebSocketStub.instances).toHaveLength(1);
      expect(controller.contextList.selectedDocumentId).toBe("job_deleted_1");
      expect(controller.toolbar.documentCount).toBe(1);
    });
    await act(async () => {
      await controller.actions.deleteSelectedDocument();
    });
    expect(controller.contextList.documents).toEqual([]);
    expect(controller.toolbar.documentCount).toBe(0);

    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [{ type: "extraction_job_lifecycle", job }],
        }),
      });
    });
    expect(controller.contextList.documents).toEqual([]);
  });

  it("uses the backend's unfiltered total for the Documents count while rendering a filtered collection", async () => {
    installWebSocketStub();
    let controller = null;
    const filteredJob = {
      job_id: "job_invoice_1",
      status: "completed",
      source_name: "invoice.pdf",
      template_id: "template_invoice",
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:01:00.000Z",
    };

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        onController={(nextController) => {
          controller = nextController;
        }}
        request={vi.fn(async () => ({
          jobs: [filteredJob],
          total: 4,
          next_cursor: null,
          has_more: false,
        }))}
      />,
    );

    await waitFor(() => {
      expect(controller.contextList.documents).toEqual([expect.objectContaining({ job_id: "job_invoice_1" })]);
      expect(controller.toolbar.documentCount).toBe(4);
    });
  });

  it("reloads paginated Documents with applied advanced filters and exposes model choices", async () => {
    const WebSocketStub = installWebSocketStub();
    let controller = null;
    const listDocuments = vi.fn(async () => ({
      jobs: [],
      total: 4,
      next_cursor: null,
      has_more: false,
    }));
    const getFilterOptions = vi.fn(async () => ({
      available_models: ["provider/model-b", "provider/model-a", "provider/model-a"],
    }));

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        documentRequests={{ getFilterOptions, listDocuments }}
        onController={(nextController) => {
          controller = nextController;
        }}
      />,
    );

    await waitFor(() => {
      expect(listDocuments).toHaveBeenCalledWith({
        search: "",
        filters: { dateFrom: "", dateTo: "", model: "" },
        cursor: null,
      });
      expect(controller.contextList.availableModels).toEqual([
        "provider/model-a",
        "provider/model-b",
      ]);
      expect(getFilterOptions).toHaveBeenCalledOnce();
    });

    act(() => {
      controller.contextList.onFiltersChange({
        dateFrom: "2026-08-01",
        dateTo: "2026-08-16",
        model: "provider/model-b",
      });
    });

    await waitFor(() => {
      expect(listDocuments).toHaveBeenLastCalledWith({
        search: "",
        filters: {
          dateFrom: "2026-08-01",
          dateTo: "2026-08-16",
          model: "provider/model-b",
        },
        cursor: null,
      });
      expect(controller.contextList.hasActiveFilters).toBe(true);
      expect(getFilterOptions).toHaveBeenCalledOnce();
    });

    act(() => {
      WebSocketStub.instances[0].onmessage({
        data: JSON.stringify({
          version: 1,
          events: [{
            type: "extraction_job_lifecycle",
            job: {
              job_id: "job_new_model",
              status: "completed",
              source_name: "new-model.pdf",
              template_id: "template_test",
              model_name: "provider/model-c",
              created_at: "2026-08-16T12:00:00.000Z",
              updated_at: "2026-08-16T12:01:00.000Z",
            },
          }],
        }),
      });
    });
    expect(controller.contextList.availableModels).toEqual([
      "provider/model-a",
      "provider/model-b",
      "provider/model-c",
    ]);
    expect(getFilterOptions).toHaveBeenCalledOnce();
  });

  it("appends a cursor page without duplicates while retaining the selected Document", async () => {
    installWebSocketStub();
    let controller = null;
    const firstPage = [
      { job_id: "job_2", status: "completed", source_name: "two.pdf", template_id: "template_test", created_at: "2026-05-06T12:02:00.000Z", updated_at: "2026-05-06T12:02:00.000Z" },
      { job_id: "job_1", status: "completed", source_name: "one.pdf", template_id: "template_test", created_at: "2026-05-06T12:01:00.000Z", updated_at: "2026-05-06T12:01:00.000Z" },
    ];
    const nextPage = [
      firstPage[1],
      { job_id: "job_0", status: "completed", source_name: "zero.pdf", template_id: "template_test", created_at: "2026-05-06T12:00:00.000Z", updated_at: "2026-05-06T12:00:00.000Z" },
    ];
    const listDocuments = vi.fn(async ({ cursor } = {}) => (
      cursor
        ? { jobs: nextPage, total: 3, next_cursor: null, has_more: false }
        : { jobs: firstPage, total: 3, next_cursor: "cursor_1", has_more: true }
    ));

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        documentRequests={{ listDocuments }}
        initialWorkspace={{ selectedDocumentId: "job_2" }}
        onController={(nextController) => {
          controller = nextController;
        }}
      />,
    );

    await waitFor(() => {
      expect(controller.contextList.documents.map((job) => job.job_id)).toEqual(["job_2", "job_1"]);
      expect(controller.contextList.hasMoreDocuments).toBe(true);
    });
    await act(async () => {
      await controller.actions.listJobs({ append: true });
    });
    expect(controller.contextList.documents.map((job) => job.job_id)).toEqual(["job_2", "job_1", "job_0"]);
    expect(controller.contextList.selectedDocumentId).toBe("job_2");
    expect(controller.contextList.hasMoreDocuments).toBe(false);
    expect(controller.toolbar.documentCount).toBe(3);
  });
});

function DocumentControllerHarness({
  workspaceId,
  initialWorkspace = {},
  isWorkspaceDeletionInProgress = false,
  documentRequests,
  onController,
  onWorkspaceAccessRevalidation,
  onWorkspaceCapacityRefresh,
  onModelConfigurationInvalidation,
  request = vi.fn(async () => ({ jobs: [], next_cursor: null, has_more: false })),
}) {
  const [latestResponse, setLatestResponse] = React.useState(null);
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
    request,
    addLog: vi.fn(),
    showActionToast: vi.fn(),
    showDocumentUploadToast: vi.fn(),
    hasApiAccess: true,
    hasWorkspaceApiAccess: true,
    isAppBusy: false,
    isWorkspaceDeletionInProgress,
    workspaceId,
    latestResponse,
    setLatestResponse,
    onWorkspaceAccessRevalidation:
      onWorkspaceAccessRevalidation || onWorkspaceCapacityRefresh,
    onWorkspaceCapacityRefresh,
    onModelConfigurationInvalidation,
    onActivePageChange: vi.fn(),
  });
  onController?.(controller);
  return null;
}

function installWebSocketStub() {
  class WebSocketStub {
    static instances = [];
    close = vi.fn();
    onclose = null;
    onerror = null;
    onmessage = null;
    onopen = null;
    readyState = 0;

    constructor(url) {
      this.url = url;
      WebSocketStub.instances.push(this);
    }
  }

  WebSocketStub.CONNECTING = 0;
  WebSocketStub.OPEN = 1;
  WebSocketStub.CLOSING = 2;
  WebSocketStub.CLOSED = 3;

  globalThis.WebSocket = WebSocketStub;
  return WebSocketStub;
}
