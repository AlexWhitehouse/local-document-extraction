import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { DocumentContextList } from "./DocumentContextList.jsx";

describe("DocumentContextList", () => {
  it("windows long lists, preserves offscreen selections, and navigates to selected rows", () => {
    const documents = Array.from({ length: 1000 }, (_, i) => ({ job_id: `job_${i}`, source_name: `invoice-${i}.pdf` }));
    const onSelectDocument = vi.fn();
    const onToggleAllDocumentSelections = vi.fn();
    const props = { search: "", documents, selectedDocumentId: "job_0", selectedDocumentIds: ["job_500"], onSelectDocument, onToggleAllDocumentSelections, onSearchChange() {}, onLoadMoreDocuments() {} };
    const { container, rerender } = render(<DocumentContextList {...props} />);
    expect(container.querySelectorAll('[role="listitem"]').length).toBeLessThan(30);
    fireEvent.click(within(container).getByRole("checkbox", { name: "Select all available jobs" }));
    expect(onToggleAllDocumentSelections.mock.lastCall[0]).toHaveLength(1000);
    fireEvent.keyDown(within(container).getByRole("button", { name: /invoice-0\.pdf/ }), { key: "End" });
    expect(onSelectDocument).toHaveBeenLastCalledWith("job_999");
    rerender(<DocumentContextList {...props} selectedDocumentId="job_999" />);
    expect(within(container).getByRole("button", { name: /invoice-999\.pdf/ })).toBe(document.activeElement);
    const list = container.querySelector(".context-list");
    fireEvent.scroll(list, { target: { scrollTop: 500 * 60 } });
    expect(within(container).getByRole("checkbox", { name: "Select job job_500" }).checked).toBe(true);
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

  it("selects and deselects all available jobs", () => {
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
      name: "Select all available jobs",
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
      name: "Deselect all available jobs",
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
      within(container).getByRole("checkbox", { name: "Deselect all available jobs" }).disabled,
    ).toBe(true);
    expect(
      within(container).getByRole("checkbox", { name: "Select job job_1" }).disabled,
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

    fireEvent.click(view.getByRole("button", { name: "Advanced job filters" }));
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
      view.getByRole("button", { name: "Advanced job filters, 3 active" }),
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

    fireEvent.click(view.getByRole("button", { name: "Advanced job filters" }));
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
