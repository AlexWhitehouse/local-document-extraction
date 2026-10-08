import React, { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentPage } from "./DocumentPage.jsx";
import { createDocumentRequestAdapter } from "./documentRequestAdapter.js";
import { useDocumentController } from "./useDocumentController.js";

const retainedDocument = {
  job_id: "job_preview",
  status: "completed",
  source_name: "invoice.pdf",
  source_mime_type: "application/pdf",
  source_file_page_count: 1,
  source_retained: true,
  created_at: "2026-10-02T12:00:00.000Z",
  updated_at: "2026-10-02T12:01:00.000Z",
  results: [{ field_id: "total", name: "Total", answer: "42.00", confidence: 0.9 }],
};

function Harness({ request, onController, sessionId = "session", workspaceId = "workspace", hasApiAccess = true }) {
  const [showNotes, setShowNotes] = useState(false);
  // App may replace the adapter on a render without changing the access scope.
  const documentRequests = createDocumentRequestAdapter({ request });

  const controller = useDocumentController({
    documentRequests,
    templates: [],
    sessionId,
    workspaceId,
    hasApiAccess,
    hasWorkspaceApiAccess: hasApiAccess,
  });

  onController?.(controller);

  return (
    <>
      <button onClick={() => setShowNotes((value) => !value)}>Toggle notes</button>
      {showNotes ? <aside>Document notes</aside> : null}
      <DocumentPage {...controller.documentPage} viewingLayout="side-by-side" />
    </>
  );
}

function sourceResponse() {
  return { blob: new Blob(["%PDF"], { type: "application/pdf" }), headers: new Headers() };
}

function createRequests() {
  const previews = [];
  let immediateSource = false;

  const request = vi.fn(async (path, options) => {
    if (path === `/jobs/${retainedDocument.job_id}/source`) {
      if (immediateSource) return sourceResponse();

      return new Promise((resolve, reject) => previews.push({ signal: options.signal, resolve, reject }));
    }

    if (path === "/jobs?group_packets=true") return { jobs: [retainedDocument], packets: [], total: 1 };

    if (path === `/jobs/${retainedDocument.job_id}`) return retainedDocument;

    if (path === "/jobs/counts")
      return { total: 1, status_counts: { queued: 0, processing: 0, completed: 1, failed: 0 } };

    if (path === "/jobs/filter-options") return { available_models: [] };

    if (path === "/packets") return { packets: [] };
    throw new Error(`Unexpected request ${path}`);
  });

  return {
    request,
    previews,
    respondImmediately: () => {
      immediateSource = true;
    },
  };
}

async function setup() {
  const requests = createRequests();
  let controller;

  const props = {
    request: requests.request,
    onController: (value) => {
      controller = value;
    },
  };

  let view;
  await act(async () => {
    view = render(<Harness {...props} />);
  });
  await act(async () => {
    await controller.contextList.onSelectDocument(retainedDocument.job_id);
  });

  return { ...requests, ...view, props, controller: () => controller };
}

describe("Completed Document preview lifetime", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", undefined);
    let nextUrl = 0;
    vi.stubGlobal(
      "URL",
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn(() => `blob:preview-${++nextUrl}`),
        revokeObjectURL: vi.fn(),
      }),
    );
  });

  it("preserves a pending and then loaded preview when unrelated renders replace the request adapter", async () => {
    const f = await setup();
    expect(f.previews).toHaveLength(1);
    const preview = f.previews[0];

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Toggle notes" }));
    });
    expect(screen.getByText("Document notes")).toBeTruthy();
    expect(preview.signal.aborted).toBe(false);
    expect(f.previews).toHaveLength(1);

    await act(async () => {
      preview.resolve(sourceResponse());
    });
    const frame = screen.getByTitle("Preview of invoice.pdf");
    const source = frame.getAttribute("src");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Toggle notes" }));
    });
    expect(screen.queryByText("Document notes")).toBeNull();
    expect(screen.getByTitle("Preview of invoice.pdf")).toBe(frame);
    expect(frame.getAttribute("src")).toBe(source);
    expect(preview.signal.aborted).toBe(false);
    expect(f.previews).toHaveLength(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("retries with the newest request adapter after an unrelated render", async () => {
    const f = await setup();
    await act(async () => {
      f.previews[0].reject(new Error("Storage unavailable"));
    });
    expect(screen.getByText("Original unavailable")).toBeTruthy();
    const replacement = createRequests();
    await act(async () => {
      f.rerender(<Harness {...f.props} request={replacement.request} />);
    });
    expect(screen.getByText("Original unavailable")).toBeTruthy();
    expect(replacement.previews).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(replacement.previews).toHaveLength(1);
    expect(f.previews).toHaveLength(1);
    await act(async () => {
      replacement.previews[0].resolve(sourceResponse());
    });
    expect(screen.getByTitle("Preview of invoice.pdf")).toBeTruthy();
  });

  for (const change of [
    { workspaceId: "another-workspace" },
    { sessionId: "another-session" },
    { hasApiAccess: false },
  ]) {
    const scope = Object.keys(change)[0];

    it(`cancels a pending preview and rejects its old loader when ${scope} changes`, async () => {
      const f = await setup();
      const preview = f.previews[0];
      const oldLoader = f.controller().documentPage.loadOriginal;
      await act(async () => {
        f.rerender(<Harness {...f.props} {...change} />);
      });
      expect(preview.signal.aborted).toBe(true);
      await act(async () => {
        preview.resolve(sourceResponse());
      });
      expect(screen.queryByTitle("Preview of invoice.pdf")).toBeNull();
      expect(URL.createObjectURL).not.toHaveBeenCalled();

      f.respondImmediately();
      await expect(oldLoader(retainedDocument.job_id)).rejects.toMatchObject({ name: "AbortError" });
    });

    it(`releases a loaded preview when ${scope} changes`, async () => {
      const f = await setup();
      await act(async () => {
        f.previews[0].resolve(sourceResponse());
      });
      const frame = screen.getByTitle("Preview of invoice.pdf");
      await act(async () => {
        f.rerender(<Harness {...f.props} {...change} />);
      });
      expect(frame.isConnected).toBe(false);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
    });
  }
});
