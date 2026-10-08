import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentLifecycleAnnouncer } from "./DocumentLifecycleAnnouncer.jsx";

const job = (status, overrides = {}) => ({ job_id: "job_1", source_name: "invoice.pdf", status, ...overrides });

describe("DocumentLifecycleAnnouncer", () => {
  it("stays silent for the first snapshot and announces each lifecycle change once", () => {
    const { rerender } = render(<DocumentLifecycleAnnouncer documents={[job("processing")]} />);
    const region = screen.getByRole("status");

    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");

    rerender(<DocumentLifecycleAnnouncer documents={[job("completed")]} />);
    expect(region.textContent).toBe("invoice.pdf completed");

    rerender(<DocumentLifecycleAnnouncer documents={[job("processing")]} />);
    rerender(<DocumentLifecycleAnnouncer documents={[job("completed")]} />);
    expect(region.textContent).toBe("invoice.pdf completed");
  });

  it("announces failures and documents that need a template, and ignores other statuses", () => {
    const { rerender } = render(
      <DocumentLifecycleAnnouncer documents={[job("processing", { job_id: "a", source_name: "a.pdf" }), job("queued", { job_id: "b", source_name: "b.pdf" })]} />,
    );

    const region = screen.getByRole("status");

    rerender(
      <DocumentLifecycleAnnouncer
        documents={[job("failed", { job_id: "a", source_name: "a.pdf" }), job("awaiting_template", { job_id: "b", source_name: "b.pdf" })]}
      />,
    );
    expect(region.textContent).toBe("a.pdf failed. b.pdf needs a template");

    rerender(<DocumentLifecycleAnnouncer documents={[job("processing", { job_id: "c", source_name: "c.pdf" })]} />);
    expect(region.textContent).toBe("a.pdf failed. b.pdf needs a template");
  });
});
