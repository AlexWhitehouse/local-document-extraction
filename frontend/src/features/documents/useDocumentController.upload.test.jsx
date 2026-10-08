import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { useDocumentController } from "./useDocumentController";
import { createDocumentRequestAdapter } from "./documentRequestAdapter";

const templates = [{ id: "t1", name: "Invoice", tags: [] }];

function png(name) {
  return new File(["x"], name, { type: "image/png" });
}

// Opens the upload modal, picks a template and two files, then submits.
async function openAndSubmit(controller, showToast = vi.fn()) {
  await act(async () => controller().contextList.onUploadDocument());
  await act(async () => controller().uploadModal.onSelectTemplate("t1"));
  await act(async () => controller().uploadModal.onSelectSourceFiles([png("a.png"), png("b.png")]));
  await act(async () => controller().uploadModal.onSubmit());

  return showToast;
}

function renderUploadController({ submitDocument, showDocumentUploadToast = vi.fn() }) {
  let controller = null;
  const request = vi.fn(async (path) => (path === "/jobs?group_packets=true" ? { jobs: [], total: 0, has_more: false, next_cursor: null } : { available_models: [] }));

  const documentRequests = {
    ...createDocumentRequestAdapter({ request }),
    submitDocument,
  };

  render(<UploadHarness documentRequests={documentRequests} showDocumentUploadToast={showDocumentUploadToast} onController={(value) => (controller = value)} />);

  return { controller: () => controller, showDocumentUploadToast };
}

function UploadHarness({ documentRequests, showDocumentUploadToast, onController }) {
  const controller = useDocumentController({
    apiBase: "/v1",
    initialWorkspace: {},
    templates,
    selectedUploadTemplateId: "",
    onSelectedUploadTemplateChange: vi.fn(),
    documentRequests,
    showActionToast: vi.fn(),
    showDocumentUploadToast,
    hasApiAccess: true,
    hasWorkspaceApiAccess: true,
    isAppBusy: false,
    isWorkspaceDeletionInProgress: false,
    workspaceId: "ws_1",
    sessionId: "user_1",
    onActivePageChange: vi.fn(),
  });

  onController(controller);

  return null;
}

function installWebSocketStub() {
  class WebSocketStub {
    close = vi.fn();
  }

  globalThis.WebSocket = WebSocketStub;
}

describe("useDocumentController upload modal", () => {
  it("closes the modal once every file is queued and reports the batch", async () => {
    installWebSocketStub();
    const submitDocument = vi.fn(async () => ({ job_id: "job_1", status: "queued" }));
    const { controller, showDocumentUploadToast } = renderUploadController({ submitDocument });

    await openAndSubmit(controller);

    await waitFor(() => expect(controller().uploadModal.isOpen).toBe(false));
    expect(submitDocument).toHaveBeenCalledTimes(2);
    expect(showDocumentUploadToast).toHaveBeenCalledWith({ queued: 2, failed: 0 });
  });

  it("keeps the modal open on partial failure and marks which files failed", async () => {
    installWebSocketStub();

    const submitDocument = vi
      .fn()
      .mockResolvedValueOnce({ job_id: "job_1", status: "queued" })
      .mockRejectedValueOnce(Object.assign(new Error("Too large"), { status: 413 }));

    const { controller, showDocumentUploadToast } = renderUploadController({ submitDocument });

    await openAndSubmit(controller);

    await waitFor(() => expect(showDocumentUploadToast).toHaveBeenCalledWith({ queued: 1, failed: 1 }));
    expect(controller().uploadModal.isOpen).toBe(true);
    const rows = controller().uploadModal.sourceFiles;
    expect(rows.map((row) => row.queueStatus).sort()).toEqual(["failed", "success"]);
    expect(rows.find((row) => row.queueStatus === "failed").queueError).toBeTruthy();
  });

  it("sends only the files that have not been queued when the user retries", async () => {
    installWebSocketStub();

    const submitDocument = vi
      .fn()
      .mockResolvedValueOnce({ job_id: "job_1", status: "queued" })
      .mockRejectedValueOnce(Object.assign(new Error("Too large"), { status: 413 }))
      .mockResolvedValueOnce({ job_id: "job_2", status: "queued" });

    const { controller, showDocumentUploadToast } = renderUploadController({ submitDocument });

    await openAndSubmit(controller);
    await waitFor(() => expect(showDocumentUploadToast).toHaveBeenCalledWith({ queued: 1, failed: 1 }));

    await act(async () => controller().uploadModal.onSubmit());

    await waitFor(() => expect(controller().uploadModal.isOpen).toBe(false));
    expect(submitDocument).toHaveBeenCalledTimes(3);
    expect(showDocumentUploadToast).toHaveBeenLastCalledWith({ queued: 1, failed: 0 });
  });
});
