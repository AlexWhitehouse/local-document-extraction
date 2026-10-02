import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { DocumentContextList } from "./DocumentContextList.jsx";
import { isSingleDocumentPacket, singlePacketDocument } from "./packetListing.js";

describe("DocumentContextList", () => {
  it.each([{ pages: [1] }, { pages: [1, 2, 3] }])("shows an accepted one-document split as a normal document for pages $pages", ({ pages }) => {
    const child = { job_id: "child_single", status: "completed", source_pages: pages };
    const packet = { packet_id: "packet_single", source_name: "invoice.pdf", status: "completed", selected_pages: pages, plan_accepted: true, plan: { groups: [{ pages }] }, children: [child] };
    const onSelectPacket = vi.fn();
    const onTogglePacketSelection = vi.fn();
    const { container } = render(<DocumentContextList search="" packets={[packet]}
      documents={[{ ...child, source_name: "invoice.pdf", parent_packet_id: packet.packet_id }]}
      selectedPacketId={packet.packet_id} selectedPacketIds={[packet.packet_id]}
      onSearchChange={vi.fn()} onSelectDocument={vi.fn()} onSelectPacket={onSelectPacket}
      onTogglePacketSelection={onTogglePacketSelection} onLoadMoreDocuments={vi.fn()} />);
    const rows = within(container).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0].classList.contains("context-item-packet")).toBe(false);
    expect(rows[0].classList.contains("status-completed")).toBe(true);
    expect(rows[0].classList.contains("active")).toBe(true);
    expect(rows[0].querySelector(".context-packet-mark")).toBeNull();
    expect(within(rows[0]).getByText("child_single")).toBeTruthy();
    expect(within(rows[0]).queryByText("1 document · Completed")).toBeNull();
    expect(within(rows[0]).getByRole("button", { name: "Copy document ID child_single" })).toBeTruthy();
    const checkbox = within(rows[0]).getByRole("checkbox", { name: "Select document child_single" });
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(onTogglePacketSelection).toHaveBeenCalledWith("packet_single", false);
    fireEvent.click(within(rows[0]).getByRole("button", { name: /invoice\.pdf/ }));
    expect(onSelectPacket).toHaveBeenCalledWith("packet_single");
  });

  it("shows pending single-page uploads as ordinary processing documents", () => {
    const { container } = render(<DocumentContextList search="" packets={[{
      packet_id: "packet_pending", source_name: "single.pdf", status: "processing", selected_pages: [1], children: [],
    }]} documents={[]} onSearchChange={vi.fn()} onSelectDocument={vi.fn()} onLoadMoreDocuments={vi.fn()} />);
    const row = within(container).getByRole("listitem");
    expect(row.classList.contains("context-item-packet")).toBe(false);
    expect(row.classList.contains("status-progress")).toBe(true);
    expect(within(row).getByText("Processing")).toBeTruthy();
  });

  it("uses the current child's status when its packet summary has not refreshed yet", () => {
    const { container } = render(<DocumentContextList search="" packets={[{
      packet_id: "packet_single", source_name: "single.pdf", status: "processing_children",
      plan: { groups: [{ pages: [1, 2] }] }, children: [{ job_id: "child_single", status: "processing" }],
    }]} documents={[{ job_id: "child_single", status: "awaiting_template" }]}
      onSearchChange={vi.fn()} onSelectDocument={vi.fn()} onLoadMoreDocuments={vi.fn()} />);
    const row = within(container).getByRole("listitem");
    expect(row.classList.contains("context-item-packet")).toBe(false);
    expect(row.classList.contains("status-failed")).toBe(true);
  });

  it("keeps unresolved and genuinely split documents in packet rows, including a sole surviving child", () => {
    const packets = [
      { packet_id: "unresolved", source_name: "unresolved.pdf", status: "processing", selected_pages: [1, 2], children: [] },
      { packet_id: "review", source_name: "review.pdf", status: "awaiting_review", selected_pages: [1], plan: { groups: [{ pages: [1] }] }, children: [] },
      { packet_id: "multiple", source_name: "multiple.pdf", status: "completed", plan_accepted: true, plan: { groups: [{ pages: [1] }, { pages: [2] }] }, children: [{ job_id: "a" }, { job_id: "b" }] },
      { packet_id: "survivor", source_name: "survivor.pdf", status: "completed", plan_accepted: true, plan: { groups: [{ pages: [1] }, { pages: [2] }] }, children: [{ job_id: "c" }] },
    ];
    const { container } = render(<DocumentContextList search="" packets={packets} documents={[]}
      onSearchChange={vi.fn()} onSelectDocument={vi.fn()} onLoadMoreDocuments={vi.fn()} />);
    const rows = within(container).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.classList.contains("context-item-packet")).toBe(true);
  });

  it("only resolves a sole child after a one-group split is committed", () => {
    const child = { job_id: "only_child" };
    const packet = { status: "processing", selected_pages: [1, 2], plan: { groups: [{ pages: [1, 2] }] }, children: [child] };
    expect(singlePacketDocument(packet)).toBeNull();
    expect(singlePacketDocument({ ...packet, plan_accepted: true })).toBe(child);
    expect(singlePacketDocument({ ...packet, status: "processing_children" })).toBe(child);
    expect(isSingleDocumentPacket({ ...packet, plan_accepted: true, status: "materializing", children: [] })).toBe(true);
    expect(isSingleDocumentPacket({ ...packet, plan_accepted: true, status: "completed", children: [] })).toBe(false);
    expect(isSingleDocumentPacket({ ...packet, plan_accepted: true, status: "completed", outcome: "no_documents", children: [] })).toBe(false);
  });
  it("windows long lists, preserves offscreen selections, and navigates to selected rows", () => {
    const documents = Array.from({ length: 1000 }, (_, i) => ({ job_id: `job_${i}`, source_name: `invoice-${i}.pdf` }));
    const onSelectDocument = vi.fn();
    const onToggleAllDocumentSelections = vi.fn();
    const props = { search: "", documents, selectedDocumentId: "job_0", selectedDocumentIds: ["job_500"], onSelectDocument, onToggleAllDocumentSelections, onSearchChange() {}, onLoadMoreDocuments() {} };
    const { container, rerender } = render(<DocumentContextList {...props} />);
    expect(container.querySelectorAll('[role="listitem"]').length).toBeLessThan(30);
    fireEvent.click(within(container).getByRole("checkbox", { name: "Select all available documents" }));
    expect(onToggleAllDocumentSelections.mock.lastCall[0]).toHaveLength(1000);
    fireEvent.keyDown(within(container).getByRole("button", { name: /invoice-0\.pdf/ }), { key: "End" });
    expect(onSelectDocument).toHaveBeenLastCalledWith("job_999");
    rerender(<DocumentContextList {...props} selectedDocumentId="job_999" />);
    expect(within(container).getByRole("button", { name: /invoice-999\.pdf/ })).toBe(document.activeElement);
    const list = container.querySelector(".context-list");
    fireEvent.scroll(list, { target: { scrollTop: 500 * 60 } });
    expect(within(container).getByRole("checkbox", { name: "Select document job_500" }).checked).toBe(true);
    expect(container.querySelectorAll('[role="listitem"]').length).toBeLessThan(30);
  });
  it("uses the document status to colour each row's left edge", () => {
    const { container } = render(
      <DocumentContextList
        search=""
        documents={[
          { job_id: "job_completed", source_name: "completed.pdf", status: "completed" },
          { job_id: "job_queued", source_name: "queued.pdf", status: "queued" },
          { job_id: "job_processing", source_name: "processing.pdf", status: "processing" },
          { job_id: "job_failed", source_name: "failed.pdf", status: "failed" },
        ]}
        selectedDocumentId="job_failed"
        debouncedSearch=""
        hasMoreDocuments={false}
        isLoadingMoreDocuments={false}
        onSearchChange={vi.fn()}
        onSelectDocument={vi.fn()}
        onLoadMoreDocuments={vi.fn()}
      />,
    );

    const rowFor = (name) =>
      within(container).getByRole("button", { name: new RegExp(name) })
        .closest(".context-item-document");

    expect(rowFor("completed.pdf").classList.contains("status-completed")).toBe(true);
    expect(rowFor("queued.pdf").classList.contains("status-progress")).toBe(true);
    expect(rowFor("processing.pdf").classList.contains("status-progress")).toBe(true);
    expect(rowFor("failed.pdf").classList.contains("status-failed")).toBe(true);
    expect(rowFor("failed.pdf").classList.contains("active")).toBe(true);
  });

  it("shows a packet as one dated row in place of its child documents", () => {
    const onSelectPacket = vi.fn();
    const onTogglePacketSelection = vi.fn();
    const onToggleAllDocumentSelections = vi.fn();
    const { container, rerender } = render(
      <DocumentContextList
        search=""
        packets={[{ packet_id: "packet_1", source_name: "bundle.pdf", status: "completed", created_at: "2026-01-02T00:00:00Z", children: [{ job_id: "child_1" }, { job_id: "child_2" }] }]}
        documents={[
          { job_id: "newer", source_name: "newer.pdf", status: "completed", created_at: "2026-01-03T00:00:00Z" },
          { job_id: "child_1", source_name: "bundle.pdf", status: "completed", parent_packet_id: "packet_1", created_at: "2026-01-02T00:00:01Z" },
          { job_id: "child_2", status: "completed", created_at: "2026-01-02T00:00:01Z" },
          { job_id: "older", source_name: "older.pdf", status: "completed", created_at: "2026-01-01T00:00:00Z" },
        ]}
        selectedPacketId="packet_1"
        debouncedSearch=""
        onSearchChange={vi.fn()}
        onSelectDocument={vi.fn()}
        onSelectPacket={onSelectPacket}
        onTogglePacketSelection={onTogglePacketSelection}
        onToggleAllDocumentSelections={onToggleAllDocumentSelections}
        onLoadMoreDocuments={vi.fn()}
      />,
    );
    const rows = within(container).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("strong").textContent)).toEqual(["newer.pdf", "bundle.pdf", "older.pdf"]);
    expect(rows[1].classList.contains("active")).toBe(true);
    expect(rows[1].textContent).toContain("2 documents · Completed");
    fireEvent.click(within(rows[1]).getByRole("checkbox", { name: "Select packet packet_1" }));
    expect(onTogglePacketSelection).toHaveBeenCalledWith("packet_1", true);
    fireEvent.click(within(container).getByRole("checkbox", { name: "Select all available documents" }));
    expect(onToggleAllDocumentSelections).toHaveBeenCalledWith(["newer", "older"], true);
    expect(onTogglePacketSelection).toHaveBeenLastCalledWith("packet_1", true);
    fireEvent.click(within(rows[1]).getByRole("button", { name: /bundle\.pdf/ }));
    expect(onSelectPacket).toHaveBeenCalledWith("packet_1");
    rerender(
      <DocumentContextList search="older" debouncedSearch="older" hasActiveFilters={false}
        packets={[{ packet_id: "packet_1", source_name: "bundle.pdf", status: "completed", children: [] }]}
        documents={[{ job_id: "older", source_name: "older.pdf", status: "completed" }]}
        onSearchChange={vi.fn()} onSelectDocument={vi.fn()} onLoadMoreDocuments={vi.fn()} />,
    );
    expect(within(container).getAllByRole("listitem")).toHaveLength(1);
  });

  it("selects and deselects all available documents", () => {
    const documents = [
      {
        job_id: "job_1",
        source_name: "invoice.pdf",
        source_mime_type: "application/pdf",
      },
      {
        job_id: "job_2",
        source_name: "receipt.pdf",
        source_mime_type: "application/pdf",
      },
    ];
    const onToggleAllDocumentSelections = vi.fn();
    const sharedProps = {
      search: "",
      documents,
      selectedDocumentId: "job_1",
      debouncedSearch: "",
      hasMoreDocuments: false,
      isLoadingMoreDocuments: false,
      onSearchChange: vi.fn(),
      onSelectDocument: vi.fn(),
      onToggleAllDocumentSelections,
      onToggleDocumentSelection: vi.fn(),
      onLoadMoreDocuments: vi.fn(),
    };
    const { container, rerender } = render(
      <DocumentContextList {...sharedProps} selectedDocumentIds={["job_1"]} />,
    );

    const selectAll = within(container).getByRole("checkbox", {
      name: "Select all available documents",
    });
    expect(selectAll.indeterminate).toBe(true);
    fireEvent.click(selectAll);
    expect(onToggleAllDocumentSelections).toHaveBeenLastCalledWith(
      ["job_1", "job_2"],
      true,
    );

    rerender(
      <DocumentContextList
        {...sharedProps}
        selectedDocumentIds={["job_1", "job_2"]}
      />,
    );
    const deselectAll = within(container).getByRole("checkbox", {
      name: "Deselect all available documents",
    });
    expect(deselectAll.checked).toBe(true);
    fireEvent.click(deselectAll);
    expect(onToggleAllDocumentSelections).toHaveBeenLastCalledWith(
      ["job_1", "job_2"],
      false,
    );
  });

  it("locks individual and bulk selection during export", () => {
    const { container } = render(
      <DocumentContextList
        search=""
        documents={[{ job_id: "job_1", source_name: "invoice.pdf" }]}
        selectedDocumentId="job_1"
        selectedDocumentIds={["job_1"]}
        debouncedSearch=""
        hasMoreDocuments={false}
        isLoadingMoreDocuments={false}
        isExportingDocuments={true}
        onSearchChange={vi.fn()}
        onSelectDocument={vi.fn()}
        onToggleAllDocumentSelections={vi.fn()}
        onToggleDocumentSelection={vi.fn()}
        onLoadMoreDocuments={vi.fn()}
      />,
    );

    expect(
      within(container).getByRole("checkbox", { name: "Deselect all available documents" }).disabled,
    ).toBe(true);
    expect(
      within(container).getByRole("checkbox", { name: "Select document job_1" }).disabled,
    ).toBe(true);
  });

  it("applies and clears date and model filters from the integrated search action", () => {
    const onFiltersChange = vi.fn();
    const sharedProps = {
      search: "",
      documents: [],
      selectedDocumentId: "",
      selectedDocumentIds: [],
      debouncedSearch: "",
      availableModels: ["provider/model-a", "provider/model-b"],
      hasMoreDocuments: false,
      isLoadingMoreDocuments: false,
      onSearchChange: vi.fn(),
      onFiltersChange,
      onSelectDocument: vi.fn(),
      onLoadMoreDocuments: vi.fn(),
    };
    const { container, rerender } = render(
      <DocumentContextList
        {...sharedProps}
        filters={{ dateFrom: "", dateTo: "", model: "" }}
      />,
    );
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "Advanced document filters" }));
    expect(view.getByRole("dialog", { name: "Advanced filters" })).toBeTruthy();
    fireEvent.change(view.getByLabelText("Date from"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(view.getByLabelText("Date to"), {
      target: { value: "2026-08-16" },
    });
    fireEvent.change(view.getByLabelText("Model used"), {
      target: { value: "provider/model-b" },
    });
    fireEvent.click(view.getByRole("button", { name: "Apply filters" }));

    expect(onFiltersChange).toHaveBeenLastCalledWith({
      dateFrom: "2026-08-01",
      dateTo: "2026-08-16",
      model: "provider/model-b",
    });

    rerender(
      <DocumentContextList
        {...sharedProps}
        filters={{
          dateFrom: "2026-08-01",
          dateTo: "2026-08-16",
          model: "provider/model-b",
        }}
        hasActiveFilters={true}
      />,
    );
    fireEvent.click(
      view.getByRole("button", { name: "Advanced document filters, 3 active" }),
    );
    fireEvent.click(view.getByRole("button", { name: "Clear" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      dateFrom: "",
      dateTo: "",
      model: "",
    });
  });

  it("prevents applying an inverted date range", () => {
    const { container } = render(
      <DocumentContextList
        search=""
        documents={[]}
        selectedDocumentId=""
        debouncedSearch=""
        filters={{ dateFrom: "", dateTo: "", model: "" }}
        hasMoreDocuments={false}
        isLoadingMoreDocuments={false}
        onSearchChange={vi.fn()}
        onFiltersChange={vi.fn()}
        onSelectDocument={vi.fn()}
        onLoadMoreDocuments={vi.fn()}
      />,
    );
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "Advanced document filters" }));
    fireEvent.change(view.getByLabelText("Date from"), {
      target: { value: "2026-08-16" },
    });
    fireEvent.change(view.getByLabelText("Date to"), {
      target: { value: "2026-08-15" },
    });

    expect(view.getByRole("alert").textContent).toContain(
      "Date from must be on or before date to",
    );
    expect(view.getByRole("button", { name: "Apply filters" }).disabled).toBe(
      true,
    );
  });
});
