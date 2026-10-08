import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DocumentContextList } from "./DocumentContextList.jsx";

const baseProps = {
  search: "",
  documents: [],
  onSearchChange: vi.fn(),
  onSelectDocument: vi.fn(),
};

describe("DocumentContextList states", () => {
  it("shows a skeleton on first load and never the empty message", () => {
    render(<DocumentContextList {...baseProps} listStatus="loading" />);

    expect(screen.getByRole("status", { name: "Loading…" })).toBeTruthy();
    expect(screen.queryByText("No documents yet")).toBeNull();
  });

  it("shows the load error with Try again instead of the empty message", () => {
    const onRetryDocumentList = vi.fn();
    render(
      <DocumentContextList
        {...baseProps}
        listStatus="error"
        listError={new Error("Network failed")}
        onRetryDocumentList={onRetryDocumentList}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("This couldn't be loaded.");
    expect(screen.queryByText("No documents yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetryDocumentList).toHaveBeenCalledTimes(1);
  });

  it("offers Upload documents in an empty Workspace and disables it when uploads are unavailable", () => {
    const onUploadDocument = vi.fn();

    const { rerender } = render(
      <DocumentContextList {...baseProps} listStatus="ready" onUploadDocument={onUploadDocument} canUploadDocuments />,
    );

    expect(screen.getByText("No documents yet")).toBeTruthy();
    expect(screen.queryByText("No documents uploaded yet.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Upload documents" }));
    expect(onUploadDocument).toHaveBeenCalledTimes(1);

    rerender(
      <DocumentContextList {...baseProps} listStatus="ready" onUploadDocument={onUploadDocument} canUploadDocuments={false} />,
    );
    expect(screen.getByRole("button", { name: "Upload documents" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps the filter message without an upload action when a search finds nothing", () => {
    render(<DocumentContextList {...baseProps} listStatus="ready" debouncedSearch="invoice" />);

    expect(screen.getByText("No documents match these filters.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upload documents" })).toBeNull();
  });

  it("reports a load-more failure inline with Try again", () => {
    const onLoadMoreDocuments = vi.fn();
    render(
      <DocumentContextList
        {...baseProps}
        documents={[{ job_id: "a", source_name: "a.pdf", status: "completed" }]}
        listStatus="ready"
        hasMoreDocuments
        loadMoreError={new Error("Older documents failed")}
        onLoadMoreDocuments={onLoadMoreDocuments}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("This couldn't be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onLoadMoreDocuments).toHaveBeenCalledTimes(1);
  });
});
