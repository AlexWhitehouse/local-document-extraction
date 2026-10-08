import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentUploadModal } from "./DocumentUploadModal.jsx";
import { DocumentPage } from "./DocumentPage.jsx";
import { PacketPage } from "./PacketPage.jsx";

afterEach(cleanup);

const file = new File(["pdf"], "packet.pdf", { type: "application/pdf" });

const uploadProps = {
  isOpen: true,
  templates: [{ id: "tpl_invoice", name: "Invoice" }],
  selectedTemplateId: "automatic",
  availableTags: ["invoice", "finance"],
  selectedTags: [],
  sourceFiles: [{ id: "a", file, queueStatus: "pending" }],
  hasApiAccess: true,
  onSelectTags: vi.fn(),
  onSelectTemplate: vi.fn(),
};

const packet = {
  packet_id: "packet_1",
  status: "awaiting_review",
  plan_revision: 2,
  selected_pages: [1, 2, 3],
  source_name: "packet.pdf",
  plan: { groups: [{ pages: [1, 2] }, { pages: [3] }], exclusions: [] },
  children: [],
};

describe("Automatic document processing UI", () => {
  it("requires an explicit template or at least one tag", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DocumentUploadModal {...uploadProps} />);
    expect(screen.getByRole("button", { name: "Upload documents" }).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "invoice" }));
    expect(uploadProps.onSelectTags).toHaveBeenCalledWith(["invoice"]);
    expect(screen.queryByRole("checkbox", { name: /splitting/i })).toBeNull();
    rerender(<DocumentUploadModal {...uploadProps} selectedTags={["invoice"]} />);
    expect(screen.getByRole("button", { name: "Upload documents" }).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Preview and select pages" })).toBeNull();
  });

  it("resolves an automatic hold with a manual choice using the existing document", async () => {
    const user = userEvent.setup();
    const onResolveTemplate = vi.fn();
    render(
      <DocumentPage
        selectedDocument={{
          job_id: "job_1",
          status: "awaiting_template",
          selection_mode: "automatic",
          template_tags: ["invoice"],
          selection_reason: "Descriptions overlap",
        }}
        templates={uploadProps.templates}
        onResolveTemplate={onResolveTemplate}
      />,
    );
    expect(screen.getByText("Descriptions overlap")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Use template and continue" });
    expect(button.disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText("Template for this document"), "tpl_invoice");
    await user.click(button);
    expect(onResolveTemplate).toHaveBeenCalledWith("job_1", "tpl_invoice");
  });

  it("keeps the model's selection reasoning off an automatically routed document", async () => {
    render(
      <DocumentPage
        selectedDocument={{
          job_id: "job_2",
          status: "completed",
          selection_mode: "automatic",
          template_id: "tpl_invoice",
          template_version: 3,
          selection_reason: "Invoice number and total",
          parent_packet_id: "packet_1",
          source_pages: [2, 3],
        }}
        templates={uploadProps.templates}
      />,
    );
    expect(screen.queryByText(/Automatically selected/)).toBeNull();
    expect(screen.queryByText("Invoice number and total")).toBeNull();
    expect(screen.getByText("Pages 2, 3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View parent packet" })).toBeNull();
  });

  it("validates complete page coverage before confirming the current plan revision", async () => {
    const user = userEvent.setup();
    const onConfirmPlan = vi.fn();
    render(<PacketPage packet={packet} onConfirmPlan={onConfirmPlan} />);
    const first = screen.getByLabelText("Document 1 pages");
    await user.clear(first);
    await user.type(first, "1");
    await user.click(screen.getByRole("button", { name: "Confirm plan and extract" }));
    expect(screen.getByRole("alert").textContent).toContain("Assign or explicitly exclude pages: 2");
    expect(onConfirmPlan).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Exclude a page" }));
    await user.selectOptions(screen.getByLabelText("Excluded page 1"), "2");
    await user.type(screen.getByLabelText("Reason for exclusion 1"), "Blank");
    await user.click(screen.getByRole("button", { name: "Confirm plan and extract" }));
    expect(onConfirmPlan).toHaveBeenCalledWith("packet_1", {
      revision: 2,
      groups: [{ pages: [1] }, { pages: [3] }],
      exclusions: [{ page: 2, reason: "Blank" }],
    });
  });

  it("shows successful zero-child completion and records all excluded pages", () => {
    render(
      <PacketPage
        packet={{
          ...packet,
          status: "completed",
          outcome: "no_documents",
          plan: {
            groups: [],
            exclusions: [
              { page: 1, reason: "Verified blank" },
              { page: 2, reason: "Verified blank" },
              { page: 3, reason: "Verified blank" },
            ],
          },
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "No documents to extract" })).toBeTruthy();
    const excluded = screen.getByRole("region", { name: "Excluded pages" });
    expect(within(excluded).getByRole("row", { name: "3 Verified blank" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm plan and extract" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Documents in this packet" })).toBeNull();
  });

  it("loads original-page previews only in review and links children without parent exports", async () => {
    const preview = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
    const onSelectDocument = vi.fn();
    const { rerender } = render(<PacketPage packet={packet} loadPagePreview={preview} />);
    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith("packet_1", 1, expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    await waitFor(() => expect(screen.getByAltText("Original page 1")).toBeTruthy());
    rerender(
      <PacketPage
        packet={{
          ...packet,
          status: "processing_children",
          children: [{ job_id: "child_1", status: "completed", source_pages: [1, 2] }],
        }}
        onSelectDocument={onSelectDocument}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open document 1 · Pages 1, 2" }));
    expect(onSelectDocument).toHaveBeenCalledWith("child_1");
  });

  it("shows packet children as tabs and renders the active child document", async () => {
    const onSelectDocument = vi.fn();

    const children = [
      { job_id: "child_1", status: "completed", source_pages: [1, 2] },
      { job_id: "child_2", status: "processing", source_pages: [3] },
    ];

    const props = {
      packet: { ...packet, status: "processing_children", children },
      onSelectDocument,
      renderDocument: (job) => <p>Results for {job.job_id}</p>,
    };

    const { rerender } = render(<PacketPage {...props} />);
    expect(screen.getByRole("tab", { name: /^Overview/ }).getAttribute("aria-selected")).toBe("true");
    await userEvent.click(screen.getByRole("tab", { name: /Document 2/ }));
    expect(onSelectDocument).toHaveBeenCalledWith("child_2");
    rerender(<PacketPage {...props} pendingDocumentId="child_2" />);
    expect(screen.getByRole("tab", { name: /Document 2/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("region", { name: "Documents in this packet" })).toBeTruthy();
    rerender(<PacketPage {...props} pendingDocumentId="child_1" isOpeningDocument />);
    expect(screen.queryByRole("region", { name: "Documents in this packet" })).toBeNull();
    rerender(<PacketPage {...props} activeDocumentId="child_2" />);
    expect(screen.getByRole("status").textContent).toBe("Loading document…");
    rerender(<PacketPage {...props} activeDocumentId="child_2" activeDocument={{ job_id: "child_2" }} />);
    expect(screen.getByText("Results for child_2")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Document 2/ }).getAttribute("aria-selected")).toBe("true");
    await userEvent.click(screen.getByRole("tab", { name: /^Overview/ }));
    expect(onSelectDocument).toHaveBeenCalledWith("");
  });

  it("moves between packet tabs with the arrow keys", async () => {
    const onSelectDocument = vi.fn();

    const children = [
      { job_id: "child_1", status: "completed", source_pages: [1] },
      { job_id: "child_2", status: "processing", source_pages: [2] },
    ];

    render(
      <PacketPage
        packet={{ ...packet, status: "processing_children", plan_accepted: true, children }}
        onSelectDocument={onSelectDocument}
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: /^Overview/ }));
    await userEvent.keyboard("{ArrowRight}");
    expect(onSelectDocument).toHaveBeenLastCalledWith("child_1");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Document 1/ }));
    await userEvent.keyboard("{End}");
    expect(onSelectDocument).toHaveBeenLastCalledWith("child_2");
  });

  it("shows how many templates carry each tag and which templates a selection allows", async () => {
    const onSelectTags = vi.fn();

    const templates = [
      { id: "a", name: "Invoice", tags: ["invoice", "finance"] },
      { id: "b", name: "Receipt", tags: ["finance"] },
      { id: "c", name: "Letter", tags: [] },
    ];

    const { rerender } = render(
      <DocumentUploadModal {...uploadProps} templates={templates} onSelectTags={onSelectTags} />,
    );

    expect(screen.getByText(/Choose at least one tag/)).toBeTruthy();
    expect(screen.getByTitle("2 templates tagged finance")).toBeTruthy();
    rerender(
      <DocumentUploadModal
        {...uploadProps}
        templates={templates}
        onSelectTags={onSelectTags}
        selectedTags={["finance"]}
      />,
    );
    expect(screen.getByText(/matched to one of/).textContent).toBe(
      "Each document is matched to one of 2 templates: Invoice, Receipt",
    );
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onSelectTags).toHaveBeenCalledWith([]);
  });

  it.each(["", "child_1"])(
    "shows failed child retrieval and retries that child from the %s tab",
    async (activeDocumentId) => {
      const onSelectDocument = vi.fn();

      const children = [
        { job_id: "child_1", status: "completed", source_pages: [1, 2] },
        { job_id: "child_2", status: "completed", source_pages: [3] },
      ];

      const props = {
        packet: { ...packet, status: "completed", children },
        activeDocumentId,
        activeDocument: { job_id: activeDocumentId },
        onSelectDocument,
        renderDocument: (job) => <p>Results for {job.job_id}</p>,
      };

      const { rerender } = render(
        <PacketPage
          {...props}
          documentError="Couldn't load document details. Try again."
          documentErrorId="child_2"
        />,
      );

      expect(screen.getByRole("alert").textContent).toContain("Couldn't load document details");

      if (activeDocumentId) expect(screen.getByText("Results for child_1")).toBeTruthy();
      else expect(screen.getByRole("region", { name: "Documents in this packet" })).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(onSelectDocument).toHaveBeenCalledWith("child_2");
      rerender(<PacketPage {...props} pendingDocumentId="child_2" />);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    },
  );

  it("tracks the split and extraction stages on the packet tabs", () => {
    const children = [
      { job_id: "child_1", status: "completed", source_pages: [1, 2], template_id: "tpl_invoice" },
      { job_id: "child_2", status: "processing", source_pages: [3] },
    ];

    const { rerender } = render(<PacketPage packet={{ ...packet, status: "processing" }} />);
    const overview = () => screen.getByRole("tab", { name: /^Overview/ });
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(overview().id);
    expect(overview().textContent).toContain("Finding documents");
    rerender(
      <PacketPage
        packet={{ ...packet, status: "processing_children", plan_accepted: true, children }}
        templates={uploadProps.templates}
      />,
    );
    expect(overview().textContent).toContain("Split into 2. 1 of 2 extracted");
    expect(screen.getByRole("tab", { name: /Document 1/ }).className).toContain("ui-tone-success");
    expect(screen.getByRole("tab", { name: /Document 2/ }).textContent).toContain("Page 3 · Processing");
    const table = screen.getByRole("region", { name: "Documents in this packet" });
    expect(within(table).getByRole("row", { name: /Document 1 1, 2 Invoice Completed/ })).toBeTruthy();
    expect(within(table).getByText("Choosing a template…")).toBeTruthy();
    rerender(
      <PacketPage packet={{ ...packet, status: "completed", plan_accepted: true, children: [children[0]] }} />,
    );
    expect(overview().textContent).toContain("All documents extracted");
  });
});
