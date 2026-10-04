import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentPage } from "./DocumentPage.jsx";

function singleDocumentPacket(pages = [1]) {
  const child = {
    job_id: "job_single",
    status: "completed",
    parent_packet_id: "pkt_single",
    source_name: "invoice.pdf",
    source_mime_type: "application/pdf",
    source_retained: true,
    source_file_page_count: pages.length,
    source_pages: pages,
  };

  return {
    packet_id: "pkt_single",
    status: "completed",
    plan_accepted: true,
    source_name: "invoice.pdf",
    selected_pages: pages,
    children: [child],
    plan: { groups: [{ pages }], exclusions: [] },
  };
}

function detail(child) {
  return { ...child, results: [{ field_id: "total", name: "Total", answer: "751.68", confidence: 0.9 }] };
}

function expectSingleDocument() {
  expect(screen.getByRole("region", { name: "Document results" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Document packet" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "Overview" })).toBeNull();
  expect(screen.queryByRole("button", { name: "View parent packet" })).toBeNull();
}

describe("Single documents produced by smart splitting", () => {
  it.each([[1], [1, 2, 3]].map((pages) => [pages]))(
    "opens one document spanning pages %j directly in results",
    (pages) => {
      const packet = singleDocumentPacket(pages);
      render(
        <DocumentPage
          selectedPacketId={packet.packet_id}
          packetPage={{ packet, activeDocument: detail(packet.children[0]) }}
        />,
      );
      expectSingleDocument();
      expect(screen.getByRole("table", { name: "Extracted fields" })).toBeTruthy();
      expect(screen.getByText("751.68")).toBeTruthy();
    },
  );

  it.each([[1], [1, 2, 3]].map((pages) => [pages]))(
    "honours side by side for one document spanning pages %j",
    async (pages) => {
      vi.stubGlobal(
        "URL",
        Object.assign(class extends URL {}, {
          createObjectURL: vi.fn(() => "blob:single"),
          revokeObjectURL: vi.fn(),
        }),
      );
      const packet = singleDocumentPacket(pages);
      const loadOriginal = vi.fn(async () => ({ blob: new Blob(["pdf"], { type: "application/pdf" }) }));
      render(
        <DocumentPage
          selectedPacketId={packet.packet_id}
          packetPage={{ packet, activeDocument: detail(packet.children[0]) }}
          viewingLayout="side-by-side"
          loadOriginal={loadOriginal}
        />,
      );
      expectSingleDocument();
      expect(await screen.findByTitle("Preview of invoice.pdf")).toBeTruthy();
      expect(loadOriginal).toHaveBeenCalledWith(
        "job_single",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(screen.getByText("751.68")).toBeTruthy();
    },
  );

  it("shows a loading document instead of another document's results while details arrive", () => {
    const packet = singleDocumentPacket([1, 2]);

    const other = {
      job_id: "job_other",
      status: "completed",
      results: [{ field_id: "private", name: "Other result", answer: "Wrong document" }],
    };

    render(<DocumentPage selectedPacketId={packet.packet_id} packetPage={{ packet, activeDocument: other }} />);
    expectSingleDocument();
    expect(screen.getByText("Loading document results…")).toBeTruthy();
    expect(screen.queryByText("Wrong document")).toBeNull();
    expect(screen.queryByText("No result rows available yet.")).toBeNull();
  });

  it("replaces a failed details load with an error and retries the same document", () => {
    const packet = singleDocumentPacket([1, 2]);
    const onSelectDocument = vi.fn();
    const packetPage = { packet, onSelectDocument, documentError: "Could not load document results" };
    const { rerender } = render(<DocumentPage selectedPacketId={packet.packet_id} packetPage={packetPage} />);
    expectSingleDocument();
    expect(screen.getByRole("alert").textContent).toBe("Could not load document results");
    expect(screen.queryByText("Loading document results…")).toBeNull();
    expect(screen.queryByText("No result rows available yet.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry document" }));
    expect(onSelectDocument).toHaveBeenCalledWith("job_single");

    rerender(<DocumentPage selectedPacketId={packet.packet_id} packetPage={{ ...packetPage, documentError: "" }} />);
    expect(screen.getByText("Loading document results…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry document" })).toBeNull();
    rerender(
      <DocumentPage
        selectedPacketId={packet.packet_id}
        packetPage={{ ...packetPage, activeDocument: detail(packet.children[0]) }}
      />,
    );
    expect(screen.getByText("751.68")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a single-page upload preparing without requesting a nonexistent child's source", () => {
    const packet = { ...singleDocumentPacket(), status: "processing", plan_accepted: false, plan: null, children: [] };
    const loadOriginal = vi.fn();
    render(
      <DocumentPage
        selectedPacketId={packet.packet_id}
        packetPage={{ packet }}
        viewingLayout="side-by-side"
        loadOriginal={loadOriginal}
        sourceStorageConfigured
      />,
    );
    expectSingleDocument();
    expect(screen.getByText("Preparing document…")).toBeTruthy();
    expect(loadOriginal).not.toHaveBeenCalled();
    expect(screen.queryByRole("radiogroup", { name: "Document view" })).toBeNull();
    expect(screen.queryByText("Original not retained")).toBeNull();
  });

  it("retains packet overview when a multi-document packet has only one surviving child", () => {
    const packet = {
      ...singleDocumentPacket([1, 2]),
      plan: { groups: [{ pages: [1] }, { pages: [2] }], exclusions: [] },
    };

    render(<DocumentPage selectedPacketId={packet.packet_id} packetPage={{ packet }} />);
    expect(screen.getByRole("region", { name: "Document packet" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy();
  });

  it("keeps review available even when the unresolved plan contains one group", () => {
    const packet = { ...singleDocumentPacket(), status: "awaiting_review", plan_accepted: false, children: [] };
    render(<DocumentPage selectedPacketId={packet.packet_id} packetPage={{ packet }} />);
    expect(screen.getByRole("region", { name: "Review split plan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm plan and extract" })).toBeTruthy();
  });

  it("keeps the all-blank outcome visible without fabricating a document", () => {
    const packet = {
      ...singleDocumentPacket(),
      outcome: "no_documents",
      children: [],
      plan: { groups: [], exclusions: [{ page: 1, reason: "Verified blank" }] },
    };

    render(<DocumentPage selectedPacketId={packet.packet_id} packetPage={{ packet }} />);
    expect(screen.getByRole("heading", { name: "No documents to extract" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Document results" })).toBeNull();
  });

  it("keeps excluded-page information and loading errors visible in the single-document view", () => {
    const packet = {
      ...singleDocumentPacket(),
      selected_pages: [1, 2],
      plan: { groups: [{ pages: [1] }], exclusions: [{ page: 2, reason: "Verified blank" }] },
    };

    render(
      <DocumentPage
        selectedPacketId={packet.packet_id}
        packetPage={{ packet, activeDocument: detail(packet.children[0]), error: "Could not refresh this document" }}
      />,
    );
    expectSingleDocument();
    expect(screen.getByRole("alert").textContent).toBe("Could not refresh this document");
    expect(screen.getByText("Page 2: Verified blank")).toBeTruthy();
  });
});
