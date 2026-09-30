import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DocumentPage } from "./DocumentPage.jsx";
import { createDocumentRequestAdapter } from "./documentRequestAdapter.js";
import { documentViewingPreferenceKey, useDocumentViewingPreference } from "./documentViewing.js";

const retainedDocument = {
  job_id: "job_1",
  status: "completed",
  source_name: "invoice.pdf",
  source_mime_type: "application/pdf",
  source_file_page_count: 3,
  source_retained: true,
  created_at: "2026-09-27T09:14:00.000Z",
  results: [{ field_id: "total", name: "Total", answer: "751.68", confidence: 0.9 }],
};

function stubObjectUrls() {
  const revoked = [];
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: vi.fn(() => "blob:preview-1"),
    revokeObjectURL: vi.fn((url) => revoked.push(url)),
  }));
  return revoked;
}

describe("Document viewing preference", () => {
  it("is stored per Account and defaults to results", () => {
    const { result, rerender } = renderHook((props) => useDocumentViewingPreference(props), { initialProps: { userId: "alex" } });
    expect(result.current[0]).toBe("results");
    act(() => result.current[1]("side-by-side"));
    expect(result.current[0]).toBe("side-by-side");
    expect(window.localStorage.getItem(documentViewingPreferenceKey("alex"))).toBe("side-by-side");

    rerender({ userId: "sam" });
    expect(result.current[0]).toBe("results");
    rerender({ userId: "alex" });
    expect(result.current[0]).toBe("side-by-side");
  });

  it("applies changes without storing them during impersonation", () => {
    window.localStorage.setItem(documentViewingPreferenceKey("sam"), "side-by-side");
    const { result } = renderHook(() => useDocumentViewingPreference({ userId: "sam", readOnly: true }));
    expect(result.current[0]).toBe("side-by-side");
    act(() => result.current[1]("results"));
    expect(result.current[0]).toBe("results");
    expect(window.localStorage.getItem(documentViewingPreferenceKey("sam"))).toBe("side-by-side");
  });
});

describe("Document page original viewing", () => {
  it("shows results without fetching the original until side by side is chosen", async () => {
    const revoked = stubObjectUrls();
    const loadOriginal = vi.fn(async () => ({ blob: new Blob(["%PDF"], { type: "application/pdf" }) }));
    const onViewingLayoutChange = vi.fn();
    const { rerender, unmount } = render(
      <DocumentPage selectedDocument={retainedDocument} loadOriginal={loadOriginal} onViewingLayoutChange={onViewingLayoutChange} />,
    );
    expect(screen.getByRole("radio", { name: "Results" }).getAttribute("aria-checked")).toBe("true");
    expect(loadOriginal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: "Side by side" }));
    expect(onViewingLayoutChange).toHaveBeenCalledWith("side-by-side");

    rerender(<DocumentPage selectedDocument={retainedDocument} loadOriginal={loadOriginal} viewingLayout="side-by-side" />);
    const frame = await screen.findByTitle("Preview of invoice.pdf");
    expect(frame.getAttribute("src")).toBe("blob:preview-1#pagemode=none&navpanes=0&view=FitH");
    expect(loadOriginal).toHaveBeenCalledWith("job_1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByText("PDF · 3 pages")).toBeTruthy();
    expect(screen.getByText("751.68")).toBeTruthy();

    unmount();
    expect(revoked).toEqual(["blob:preview-1"]);
  });

  it("hides the switch for originals that were not retained, keeping results", () => {
    const loadOriginal = vi.fn();
    const document = { ...retainedDocument, source_retained: false };
    const { rerender } = render(
      <DocumentPage selectedDocument={document} loadOriginal={loadOriginal} viewingLayout="side-by-side" sourceStorageConfigured />,
    );
    expect(screen.queryByRole("radiogroup", { name: "Document view" })).toBeNull();
    expect(screen.getByText("Original not retained")).toBeTruthy();
    expect(screen.getByText("751.68")).toBeTruthy();
    expect(loadOriginal).not.toHaveBeenCalled();

    rerender(<DocumentPage selectedDocument={document} loadOriginal={loadOriginal} viewingLayout="side-by-side" />);
    expect(screen.queryByText("Original not retained")).toBeNull();
  });

  it("reports unavailable and missing originals in the pane and retries unavailable ones", async () => {
    stubObjectUrls();
    const loadOriginal = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("down"), { code: "source_unavailable", status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { code: "source_missing", status: 404 }));
    render(<DocumentPage selectedDocument={retainedDocument} loadOriginal={loadOriginal} viewingLayout="side-by-side" />);
    expect(await screen.findByText("Original temporarily unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Original missing from storage")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByText("751.68")).toBeTruthy();
  });

  it("never renders a non-PDF response inside the PDF frame", async () => {
    stubObjectUrls();
    const loadOriginal = vi.fn(async () => ({ blob: new Blob(["<script>"], { type: "text/html" }) }));
    render(<DocumentPage selectedDocument={retainedDocument} loadOriginal={loadOriginal} viewingLayout="side-by-side" />);
    expect(await screen.findByText("Original temporarily unavailable")).toBeTruthy();
    expect(screen.queryByTitle("Preview of invoice.pdf")).toBeNull();
  });

  it("keeps dragging the split while the pointer is over the PDF preview", async () => {
    stubObjectUrls();
    const loadOriginal = vi.fn(async () => ({ blob: new Blob(["%PDF"], { type: "application/pdf" }) }));
    const { container } = render(<DocumentPage selectedDocument={retainedDocument} loadOriginal={loadOriginal} viewingLayout="side-by-side" />);
    const split = container.querySelector(".document-split");
    split.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 600, right: 1000, bottom: 600 });
    const divider = screen.getByRole("separator", { name: "Resize original and results" });

    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 500 });
    expect(split.classList.contains("is-dragging")).toBe(true);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 350 });
    expect(divider.getAttribute("aria-valuenow")).toBe("35");
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(split.classList.contains("is-dragging")).toBe(false);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 600 });
    expect(divider.getAttribute("aria-valuenow")).toBe("35");
  });
});

describe("Document request adapter originals", () => {
  it("fetches originals as blobs with their UTF-8 filenames", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    const request = vi.fn(async () => ({
      blob,
      headers: new Headers({ "content-disposition": `attachment; filename="Invoice M_rz.pdf"; filename*=UTF-8''${encodeURIComponent("Invoice März.pdf")}` }),
    }));
    const signal = new AbortController().signal;
    const adapter = createDocumentRequestAdapter({ request });
    await expect(adapter.getOriginal("job 1", { signal })).resolves.toEqual({ blob, filename: "Invoice März.pdf" });
    expect(request).toHaveBeenCalledWith("/jobs/job%201/source", expect.objectContaining({ method: "GET", responseType: "blob", signal }));
  });
});

describe("Document viewing waits", () => {
  it("settles pending previews after the Document changes", async () => {
    stubObjectUrls();
    let resolve;
    const loadOriginal = vi.fn(() => new Promise((done) => { resolve = done; }));
    const { rerender } = render(<DocumentPage selectedDocument={retainedDocument} loadOriginal={loadOriginal} viewingLayout="side-by-side" />);
    const [, { signal }] = loadOriginal.mock.calls[0];
    rerender(<DocumentPage selectedDocument={{ ...retainedDocument, job_id: "job_2" }} loadOriginal={loadOriginal} viewingLayout="side-by-side" />);
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ blob: new Blob(["%PDF"], { type: "application/pdf" }) }));
    await waitFor(() => expect(loadOriginal).toHaveBeenCalledTimes(2));
  });
});
