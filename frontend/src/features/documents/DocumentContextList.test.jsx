import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DocumentContextList } from "./DocumentContextList.jsx";

describe("DocumentContextList", () => {
  it("lets users search, select a Document, and load more Documents", () => {
    const onSearchChange = vi.fn();
    const onSelectDocument = vi.fn();
    const onLoadMoreDocuments = vi.fn();

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
        debouncedSearch="invoice"
        hasMoreDocuments={true}
        isLoadingMoreDocuments={false}
        onSearchChange={onSearchChange}
        onSelectDocument={onSelectDocument}
        onLoadMoreDocuments={onLoadMoreDocuments}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Jobs"), {
      target: { value: "receipt" },
    });
    fireEvent.click(screen.getByRole("button", { name: /receipt.pdfjob_2/ }));
    fireEvent.click(screen.getByRole("button", { name: /Load More Documents/ }));

    expect(onSearchChange).toHaveBeenCalledWith("receipt");
    expect(onSelectDocument).toHaveBeenCalledWith("job_2");
    expect(onLoadMoreDocuments).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /receipt.pdfjob_2/ }).className).toContain(
      "active",
    );
    expect(screen.getByText("Continue searching older jobs")).toBeTruthy();
  });
});
