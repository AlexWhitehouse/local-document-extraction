import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DocumentContextList } from "./DocumentContextList.jsx";

const baseProps = {
  documents: [],
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

  it("hides the toolbar in an empty Workspace and leaves the upload to the page body", () => {
    render(<DocumentContextList {...baseProps} listStatus="ready" />);

    expect(screen.getByText("No documents yet")).toBeTruthy();
    expect(screen.getByText("Uploads appear here")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Advanced document filters/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload documents" })).toBeNull();
  });

  it("keeps the filter message without an upload action when filters find nothing", () => {
    render(
      <DocumentContextList
        {...baseProps}
        listStatus="ready"
        filters={{ dateFrom: "2026-01-01", dateTo: "", model: "" }}
        hasActiveFilters
      />,
    );

    expect(screen.getByText("No documents match these filters.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Advanced document filters, 1 active/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upload documents" })).toBeNull();
  });

  it("has no search field; search lives in the command palette", () => {
    render(
      <DocumentContextList {...baseProps} documents={[{ job_id: "a", source_name: "a.pdf", status: "completed" }]} />,
    );

    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Advanced document filters" })).toBeTruthy();
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
