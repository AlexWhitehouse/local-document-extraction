import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentUploadModal } from "./DocumentUploadModal.jsx";
import { DocumentPage } from "./DocumentPage.jsx";
import { PacketPage } from "./PacketPage.jsx";

afterEach(cleanup);
const file = new File(["pdf"], "packet.pdf", { type: "application/pdf" });
const uploadProps = {
  isOpen: true, templates: [{ id: "tpl_invoice", name: "Invoice" }], selectedTemplateId: "automatic",
  availableTags: ["invoice", "finance"], selectedTags: [], sourceFiles: [{ id: "a", file, queueStatus: "pending" }],
  hasApiAccess: true, onSelectTags: vi.fn(), onSelectTemplate: vi.fn(), onPageSelectionChange: vi.fn(),
};
const packet = {
  packet_id: "packet_1", status: "awaiting_review", plan_revision: 2, selected_pages: [1, 2, 3], source_name: "packet.pdf",
  plan: { groups: [{ pages: [1, 2] }, { pages: [3] }], exclusions: [] }, children: [],
};

describe("Automatic document processing UI", () => {
  it("requires an explicit template or at least one tag and shows authoritative policy", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DocumentUploadModal {...uploadProps} processingPolicy={{ enable_smart_splitting: false, exclude_blank_pages: true }} />);
    expect(screen.getByRole("button", { name: "Upload Documents" }).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "invoice" }));
    expect(uploadProps.onSelectTags).toHaveBeenCalledWith(["invoice"]);
    expect(screen.getByText(/Each file is processed as one document/)).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /splitting/i })).toBeNull();
    rerender(<DocumentUploadModal {...uploadProps} selectedTags={["invoice"]} />);
    expect(screen.getByRole("button", { name: "Upload Documents" }).disabled).toBe(false);
    await user.type(screen.getByLabelText("Pages from packet.pdf"), "1,3");
    expect(uploadProps.onPageSelectionChange).toHaveBeenCalled();
  });

  it("resolves an automatic hold with a manual choice using the existing document", async () => {
    const user = userEvent.setup();
    const onResolveTemplate = vi.fn();
    render(<DocumentPage selectedDocument={{ job_id: "job_1", status: "awaiting_template", selection_mode: "automatic", template_tags: ["invoice"], selection_reason: "Descriptions overlap" }} templates={uploadProps.templates} onResolveTemplate={onResolveTemplate} />);
    expect(screen.getByText("Descriptions overlap")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Use template and continue" });
    expect(button.disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText("Template for this document"), "tpl_invoice");
    await user.click(button);
    expect(onResolveTemplate).toHaveBeenCalledWith("job_1", "tpl_invoice");
  });

  it("shows the automatic explanation and pinned version with a parent link", async () => {
    const onSelectPacket = vi.fn();
    render(<DocumentPage selectedDocument={{ job_id: "job_2", status: "completed", selection_mode: "automatic", template_id: "tpl_invoice", template_version: 3, selection_reason: "Invoice number and total", parent_packet_id: "packet_1", source_pages: [2, 3] }} templates={uploadProps.templates} onSelectPacket={onSelectPacket} />);
    expect(screen.getByText(/Automatically selected: Invoice · version 3/)).toBeTruthy();
    expect(screen.getByText("Invoice number and total")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "View parent packet" }));
    expect(onSelectPacket).toHaveBeenCalledWith("packet_1");
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
    expect(onConfirmPlan).toHaveBeenCalledWith("packet_1", { revision: 2, groups: [{ pages: [1] }, { pages: [3] }], exclusions: [{ page: 2, reason: "Blank" }] });
  });

  it("shows successful zero-child completion and records all excluded pages", () => {
    render(<PacketPage packet={{ ...packet, status: "completed", outcome: "no_documents", plan: { groups: [], exclusions: [{ page: 1, reason: "Verified blank" }, { page: 2, reason: "Verified blank" }, { page: 3, reason: "Verified blank" }] } }} />);
    expect(screen.getByRole("heading", { name: "No documents to extract" })).toBeTruthy();
    expect(screen.getByText("Page 3: Verified blank")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm plan and extract" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Documents in this packet" })).toBeNull();
  });

  it("loads original-page previews only in review and links children without parent exports", async () => {
    const preview = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
    const onSelectDocument = vi.fn();
    const { rerender } = render(<PacketPage packet={packet} loadPagePreview={preview} />);
    await waitFor(() => expect(preview).toHaveBeenCalledWith("packet_1", 1, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    await waitFor(() => expect(screen.getByAltText("Original page 1")).toBeTruthy());
    rerender(<PacketPage packet={{ ...packet, status: "processing_children", children: [{ job_id: "child_1", status: "completed", source_pages: [1, 2] }] }} onSelectDocument={onSelectDocument} />);
    await userEvent.click(screen.getByRole("button", { name: /Document 1 · Pages 1, 2/ }));
    expect(onSelectDocument).toHaveBeenCalledWith("child_1");
  });
});
