import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DocumentUploadModal } from "./DocumentUploadModal.jsx";

const templates = [{ id: "t1", name: "Invoice", tags: [] }];

function renderModal(props = {}) {
  return render(
    <DocumentUploadModal
      isOpen
      templates={templates}
      selectedTemplateId=""
      sourceFiles={[]}
      isUploadingDocuments={false}
      hasApiAccess
      maxSourceFileBytes={10 * 1024 * 1024}
      onClose={vi.fn()}
      onSelectTemplate={vi.fn()}
      onSelectSourceFiles={vi.fn()}
      onDragOver={vi.fn()}
      onDragLeave={vi.fn()}
      onDrop={vi.fn()}
      onRemoveSourceFile={vi.fn()}
      onSubmit={vi.fn()}
      {...props}
    />,
  );
}

describe("DocumentUploadModal", () => {
  it("explains why Upload is disabled when no template or file is chosen", () => {
    renderModal();

    expect(screen.getByText("Choose a template and at least one file")).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Upload documents" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(submit.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("hides the hint once a template and a file are chosen", () => {
    const file = { id: "f1", file: new File(["x"], "invoice.pdf", { type: "application/pdf" }), queueStatus: "pending" };
    renderModal({ selectedTemplateId: "t1", sourceFiles: [file] });

    expect(screen.queryByText("Choose a template and at least one file")).toBeNull();
    expect(screen.getByRole("button", { name: "Upload documents" }).hasAttribute("disabled")).toBe(false);
  });

  it("shows refused files inside the drop zone with the reason", () => {
    renderModal({ uploadRejections: ["invoice.docx isn't a PDF, PNG, JPG or WEBP file"] });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("invoice.docx isn't a PDF, PNG, JPG or WEBP file");
    expect(screen.getByText("PDF, PNG, JPG or WEBP · up to 10 MB")).toBeTruthy();
  });

  it("closes without a discard prompt once every selected file is queued", async () => {
    const onClose = vi.fn();
    const queued = { id: "f1", file: new File(["x"], "invoice.pdf", { type: "application/pdf" }), queueStatus: "success" };
    renderModal({ selectedTemplateId: "t1", sourceFiles: [queued], onClose });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard changes?")).toBeNull();
  });

  it("does not treat listed failures as unsaved edits", async () => {
    const onClose = vi.fn();

    const failed = {
      id: "f1",
      file: new File(["x"], "invoice.pdf", { type: "application/pdf" }),
      queueStatus: "failed",
      queueError: "Too large",
    };

    renderModal({ selectedTemplateId: "t1", sourceFiles: [failed], onClose });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard changes?")).toBeNull();
  });

  it("asks before discarding files that have not been uploaded yet", async () => {
    const onClose = vi.fn();
    const pending = { id: "f1", file: new File(["x"], "invoice.pdf", { type: "application/pdf" }), queueStatus: "pending" };
    renderModal({ selectedTemplateId: "t1", sourceFiles: [pending], onClose });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {});
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps Cancel usable during an upload", () => {
    const onClose = vi.fn();
    renderModal({ isUploadingDocuments: true, sourceFiles: [], selectedTemplateId: "t1", onClose });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
