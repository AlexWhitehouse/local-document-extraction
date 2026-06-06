import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useDocumentController } from "./useDocumentController";

describe("useDocumentController Workspace live updates", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete globalThis.WebSocket;
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
      await new Promise((resolve) => {
        window.setTimeout(resolve, 20);
      });
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

  it("refreshes Workspace capacity when live lifecycle updates arrive", async () => {
    const WebSocketStub = installWebSocketStub();
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});

    render(
      <DocumentControllerHarness
        workspaceId="ws_1"
        onWorkspaceCapacityRefresh={onWorkspaceCapacityRefresh}
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
      expect(onWorkspaceCapacityRefresh).toHaveBeenCalledOnce();
    });
  });

  it("does not refresh Workspace capacity when selecting a document whose status is unchanged", async () => {
    const onWorkspaceCapacityRefresh = vi.fn(async () => {});
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

    await act(async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 200);
      });
    });

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

  it("revalidates job state over HTTP after reconnecting live updates", async () => {
    vi.useFakeTimers();
    const WebSocketStub = installWebSocketStub();
    const request = vi.fn(async () => ({ jobs: [], next_cursor: null, has_more: false }));

    try {
      render(<DocumentControllerHarness workspaceId="ws_1" request={request} />);

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
      expect(request).toHaveBeenCalledWith("/jobs", { method: "GET" });
    } finally {
      vi.useRealTimers();
    }
  });
});

function DocumentControllerHarness({
  workspaceId,
  initialWorkspace = {},
  onController,
  onWorkspaceCapacityRefresh,
  request = vi.fn(async () => ({ jobs: [], next_cursor: null, has_more: false })),
}) {
  const [latestResponse, setLatestResponse] = React.useState(null);
  const controller = useDocumentController({
    apiBase: "/v1",
    initialWorkspace,
    templates: [],
    selectedUploadTemplateId: "",
    onSelectedUploadTemplateChange: vi.fn(),
    request,
    addLog: vi.fn(),
    showActionToast: vi.fn(),
    showDocumentUploadToast: vi.fn(),
    hasApiAccess: true,
    hasWorkspaceApiAccess: true,
    isAppBusy: false,
    workspaceId,
    latestResponse,
    setLatestResponse,
    onWorkspaceCapacityRefresh,
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
