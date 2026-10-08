import { act, fireEvent, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDocumentController } from "./useDocumentController.js";

const child = {
  job_id: "single_child",
  parent_packet_id: "single_packet",
  status: "completed",
  source_name: "invoice.pdf",
  source_retained: true,
  source_pages: [1, 2],
  template_id: "invoice",
  template_version: 1,
  created_at: "2026-10-02T20:00:00.000Z",
  updated_at: "2026-10-02T20:01:00.000Z",
  results: [{ field_id: "total", answer: 10 }],
};

const finished = {
  packet_id: "single_packet",
  source_name: "invoice.pdf",
  selected_pages: [1, 2],
  status: "completed",
  plan_accepted: true,
  plan: { groups: [{ pages: [1, 2] }], exclusions: [] },
  children: [child],
};

async function setup(initialPacket = finished, initialDocuments = []) {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", undefined);
  let packets = [initialPacket];

  const requests = {
    listDocuments: vi.fn(async () => ({ jobs: initialDocuments, total: initialDocuments.length })),
    listDocumentEntries: vi.fn(async () => ({
      jobs: initialDocuments.filter((document) => !document.parent_packet_id),
      packets,
      total: initialDocuments.length + packets.flatMap((packet) => packet.children || []).length,
    })),
    getFilterOptions: vi.fn(async () => ({ available_models: [] })),
    listPackets: vi.fn(async () => ({ packets })),
    getPacket: vi.fn(async (id) => packets.find((packet) => packet.packet_id === id)),
    getDocument: vi.fn(async (id) =>
      id === child.job_id ? child : initialDocuments.find((document) => document.job_id === id),
    ),
    deleteDocument: vi.fn(async (id) => ({ deleted: true, job_id: id })),
    deletePacket: vi.fn(async (id) => {
      packets = packets.filter((packet) => packet.packet_id !== id);

      return { deleted: true };
    }),
    getOriginal: vi.fn(async () => ({ blob: new Blob(["pdf"]), filename: "invoice.pdf" })),
    exportDocuments: vi.fn(async () => ({
      blob: new Blob(["export"]),
      filename: "export.xlsx",
      exportedCount: 1,
      skippedCount: 0,
    })),
  };

  const showActionToast = vi.fn();
  let hook;
  await act(async () => {
    hook = renderHook(
      ({ workspaceId }) =>
        useDocumentController({
          documentRequests: requests,
          templates: [{ id: "invoice", name: "Invoice" }],
          workspaceId,
          sessionId: "session",
          hasApiAccess: true,
          hasWorkspaceApiAccess: true,
          showActionToast,
          showDocumentUploadToast: vi.fn(),
          onActivePageChange: vi.fn(),
        }),
      { initialProps: { workspaceId: "workspace_single" } },
    );
  });

  return {
    ...hook,
    requests,
    showActionToast,
    setPacket: (packet) => {
      packets = [packet];
    },
  };
}

// Answers the confirmation dialog that a delete opened.
async function answerDialog(name) {
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name }));
  await act(async () => {});
}

describe("Single-document smart split actions", () => {
  it("opens the only document automatically when assessment finishes while selected", async () => {
    const f = await setup({ ...finished, status: "processing", plan_accepted: false, plan: null, children: [] });
    await act(async () => {
      f.result.current.contextList.onSelectPacket("single_packet");
    });
    f.setPacket(finished);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(f.result.current.documentPage.packetPage.activeDocument?.job_id).toBe("single_child");
    expect(f.result.current.documentPage.selectedDocumentTemplateName).toBe("Invoice · version 1");
    expect(f.result.current.documentPage.isSingleDocument).toBe(true);
    expect(f.result.current.toolbar.exportableDocumentCount).toBe(1);
  });

  it("deletes the displayed document and its hidden packet together", async () => {
    const f = await setup();
    await act(async () => {
      f.result.current.contextList.onSelectPacket("single_packet");
    });
    let deletion;
    await act(async () => {
      deletion = f.result.current.toolbar.onDeleteDocument();
    });
    await act(async () => {});
    expect(screen.getByRole("alertdialog", { name: 'Delete "invoice.pdf"?' })).toBeTruthy();
    await answerDialog("Delete document");
    await act(async () => {
      await deletion;
    });
    expect(f.requests.deletePacket).toHaveBeenCalledWith("single_packet");
    expect(f.requests.deleteDocument).not.toHaveBeenCalled();
    expect(f.result.current.contextList.packets).toEqual([]);
    expect(f.showActionToast).toHaveBeenCalledWith("document.delete", "success", { targetName: "invoice.pdf" });
  });

  it("downloads and exports the one child using ordinary document endpoints", async () => {
    const f = await setup();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    globalThis.URL.createObjectURL = vi.fn(() => "blob:single-document");
    globalThis.URL.revokeObjectURL = vi.fn();
    await act(async () => {
      f.result.current.contextList.onSelectPacket("single_packet");
    });
    await act(async () => {
      await f.result.current.toolbar.onDownloadOriginal();
      await f.result.current.toolbar.onExportDocuments();
    });
    expect(f.requests.getOriginal).toHaveBeenCalledWith("single_child", undefined);
    expect(f.requests.exportDocuments).toHaveBeenCalledWith(["single_child"]);
  });

  it("offers a retry when the only document's details cannot be loaded", async () => {
    const f = await setup();
    f.requests.getDocument.mockRejectedValueOnce(new Error("Temporary failure"));
    await act(async () => {
      f.result.current.contextList.onSelectPacket("single_packet");
    });
    expect(f.result.current.documentPage.packetPage.documentError).toBe(
      "Couldn't load document details. Try again.",
    );
    await act(async () => {
      await f.result.current.documentPage.packetPage.onSelectDocument("single_child");
    });
    expect(f.result.current.documentPage.packetPage.activeDocument?.job_id).toBe("single_child");
    expect(f.result.current.documentPage.packetPage.documentError).toBe("");
  });

  it("does not continue mixed deletion or report success in a different workspace", async () => {
    const f = await setup(finished, [{ ...child, job_id: "ordinary_job", parent_packet_id: null }]);
    act(() => {
      f.result.current.contextList.onToggleDocumentSelection("ordinary_job", true);
      f.result.current.contextList.onTogglePacketSelection("single_packet", true);
    });
    expect(f.result.current.toolbar.selectedDocumentCount).toBe(2);
    let release;
    f.requests.deletePacket.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let deletion;
    act(() => {
      deletion = f.result.current.toolbar.onDeleteDocument();
    });
    await answerDialog("Delete 2 documents");
    await act(async () => {
      f.rerender({ workspaceId: "another_workspace" });
    });
    await act(async () => {
      release({ deleted: true });
      await deletion;
    });
    expect(f.requests.deleteDocument).not.toHaveBeenCalled();
    expect(f.showActionToast).not.toHaveBeenCalled();
  });

  it("keeps the failed child ID for retry without replacing another packet document", async () => {
    const second = { ...child, job_id: "second_child", source_pages: [3] };

    const f = await setup({
      ...finished,
      selected_pages: [1, 2, 3],
      plan: { groups: [{ pages: [1, 2] }, { pages: [3] }], exclusions: [] },
      children: [child, second],
    });

    await act(async () => {
      f.result.current.contextList.onSelectPacket("single_packet");
    });
    expect(f.result.current.documentPage.packetPage.activeDocument?.job_id).toBe("single_child");
    f.requests.getDocument.mockRejectedValueOnce(new Error("Temporary failure"));
    await act(async () => {
      await f.result.current.documentPage.packetPage.onSelectDocument("second_child");
    });
    expect(f.result.current.documentPage.packetPage.documentErrorId).toBe("second_child");
    expect(f.result.current.documentPage.packetPage.activeDocument?.job_id).toBe("single_child");
    f.requests.getDocument.mockResolvedValueOnce(second);
    await act(async () => {
      await f.result.current.documentPage.packetPage.onSelectDocument("second_child");
    });
    expect(f.result.current.documentPage.packetPage.activeDocument?.job_id).toBe("second_child");
    expect(f.result.current.documentPage.packetPage.documentError).toBe("");
    expect(f.result.current.documentPage.packetPage.documentErrorId).toBe("");
  });

  it("clears pending document selection when the workspace changes", async () => {
    const f = await setup();
    let release;
    f.requests.getDocument.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await act(async () => {
      f.result.current.contextList.onSelectPacket("single_packet");
    });
    expect(f.result.current.documentPage.packetPage.pendingDocumentId).toBe("single_child");
    await act(async () => {
      f.rerender({ workspaceId: "another_workspace" });
    });
    await act(async () => {
      release(child);
    });
    expect(f.result.current.documentPage.packetPage.pendingDocumentId).toBe("");
    expect(f.result.current.documentPage.packetPage.isOpeningDocument).toBe(false);
    expect(f.result.current.documentPage.packetPage.activeDocument).toBeNull();
  });
});
