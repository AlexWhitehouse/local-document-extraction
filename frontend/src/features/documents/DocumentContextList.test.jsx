import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DocumentContextList } from "./DocumentContextList.jsx";

describe("DocumentContextList", () => {
  it("lets users search, select a Document, and load more Documents", () => {
    const onSearchChange = vi.fn();
    const onSelectDocument = vi.fn();
    const onToggleDocumentSelection = vi.fn();
    const onLoadMoreDocuments = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <DocumentContextList
        search="invoice"
        documents={[
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
        ]}
        selectedDocumentId="job_2"
        selectedDocumentIds={["job_1"]}
        debouncedSearch="invoice"
        hasMoreDocuments={true}
        isLoadingMoreDocuments={false}
        onSearchChange={onSearchChange}
        onSelectDocument={onSelectDocument}
        onToggleDocumentSelection={onToggleDocumentSelection}
        onLoadMoreDocuments={onLoadMoreDocuments}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Jobs"), {
      target: { value: "receipt" },
    });
    fireEvent.click(screen.getByRole("button", { name: /receipt.pdfjob_2/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select job job_2" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy document ID job_2" }));
    fireEvent.click(screen.getByRole("button", { name: /Load More Documents/ }));

    expect(onSearchChange).toHaveBeenCalledWith("receipt");
    expect(onSelectDocument).toHaveBeenCalledWith("job_2");
    expect(onToggleDocumentSelection).toHaveBeenCalledWith("job_2", true);
    expect(onLoadMoreDocuments).toHaveBeenCalledOnce();
    expect(screen.getByRole("checkbox", { name: "Select job job_1" }).checked).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: /receipt.pdfjob_2/ }).className).toContain(
      "active",
    );
    expect(writeText).toHaveBeenCalledWith("job_2");
    expect(screen.getByText("Continue searching older jobs")).toBeTruthy();
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
});
