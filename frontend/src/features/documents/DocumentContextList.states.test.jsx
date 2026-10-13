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

  it("shows only the heading over an empty Workspace and leaves the upload to the page body", () => {
    render(<DocumentContextList {...baseProps} listStatus="ready" />);

    expect(screen.getByRole("heading", { name: "Documents" }).className).toBe("");
    expect(screen.getByText("No documents yet")).toBeTruthy();
    expect(screen.getByText("Uploads appear here")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload documents" })).toBeNull();
  });

  it("says a search found nothing without an upload action", () => {
    render(
      <DocumentContextList
        {...baseProps}
        listStatus="ready"
        searchFilter={{ filter: { statuses: ["failed"] }, summary: "Failed" }}
      />,
    );

    expect(screen.getByText("No documents match this search.")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Search filter" }).textContent).toContain("0 matches");
    expect(screen.queryByText("No documents yet")).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload documents" })).toBeNull();
  });

  it("explains a search whose template or field has gone", () => {
    render(
      <DocumentContextList
        {...baseProps}
        listStatus="error"
        listError={Object.assign(new Error("Bad filter"), { code: "invalid_search_filter" })}
        searchFilter={{ filter: { template_ids: ["gone"] }, summary: "gone" }}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("no longer available. Clear it to see every document.");
  });

  it("has no search field or filters; search lives in the command palette", () => {
    render(
      <DocumentContextList {...baseProps} documents={[{ job_id: "a", source_name: "a.pdf", status: "completed" }]} />,
    );

    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /filter/i })).toBeNull();
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
