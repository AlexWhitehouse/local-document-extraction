import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { DocumentContextList } from "./DocumentContextList.jsx";

describe("DocumentContextList", () => {
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
