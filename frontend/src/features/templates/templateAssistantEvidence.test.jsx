import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTemplateController } from "./useTemplateController.js";
import { TemplateAssistant } from "./TemplateAssistant.jsx";
import { TemplateEditorModal } from "./TemplateEditorModal.jsx";

afterEach(cleanup);

const savedTemplate = {
  id: "invoice",
  name: "Invoice",
  description: "Invoices",
  current_version: 3,
  fields: [{ id: "total", name: "Total", description: "Total due", data_type: "number" }],
};

const job = {
  job_id: "job_a",
  original_filename: "march.pdf",
  template_id: "invoice",
  template_name: "Invoice",
  template_version: 2,
  fields: savedTemplate.fields,
  results: [{ field_id: "total", answer: null }],
  source_available: true,
};

const reply = (options, groups = []) => ({
  base: JSON.parse(options.body.get("payload")).base,
  evidence: JSON.parse(options.body.get("payload")).evaluation
    ? { job: null, source: options.body.get("document") ? "original_of_evaluation_document" : "no_binary_source_supplied", evaluation: { failures: 1 } }
    : undefined,
  explanation: "Total needs VAT guidance.",
  observations: [],
  groups,
});

const describeTotal = {
  id: "total-vat",
  title: "Describe the VAT-inclusive total",
  rationale: "The verified answer includes VAT.",
  dependsOn: [],
  operations: [
    {
      op: "update_field",
      fieldIndex: 0,
      expectName: "Total",
      set: { description: "Total due including VAT" },
    },
  ],
};

const controllerProps = (request, overrides = {}) => ({
  request,
  workspaceId: "workspace_a",
  sessionId: "session_a",
  hasApiAccess: true,
  activePage: "documents",
  routeTemplateId: undefined,
  showActionToast: vi.fn(),
  onActivePageChange: vi.fn(),
  ...overrides,
});

describe("assistant opened from a document", () => {
  it("opens on the job's Template with the job, its original and a prefilled edit request", async () => {
    const request = vi.fn(async (path) => {
      if (path === "/templates/invoice") return savedTemplate;

      if (path === "/templates/assist/evidence/job_a") return job;

      return { templates: [savedTemplate] };
    });

    const { result, rerender } = renderHook(useTemplateController, { initialProps: controllerProps(request) });
    act(() =>
      result.current.actions.prepareAssistant({
        templateId: "invoice",
        action: "edit",
        instructions: "Improve the instructions for “Total”.",
        jobId: "job_a",
        useOriginal: true,
      }),
    );
    rerender(controllerProps(request, { activePage: "templates", routeTemplateId: "invoice" }));
    await waitFor(() => expect(result.current.templatePage.assistant.isOpen).toBe(true));
    await waitFor(() => expect(result.current.templatePage.assistant.job?.job_id).toBe("job_a"));
    const panel = result.current.templatePage.assistant;
    expect(panel.action).toBe("edit");
    expect(panel.instructions).toBe("Improve the instructions for “Total”.");
    expect(panel.useRetainedSource).toBe(true);
    // The job came from v2; the open Template is v3, so the existing version warning applies.
    expect(panel.templateVersion).toBe(3);
  });

  it("drops the request when another Template opens instead", async () => {
    const request = vi.fn(async (path) => (path.startsWith("/templates/") ? { ...savedTemplate, id: "other" } : { templates: [] }));
    const { result, rerender } = renderHook(useTemplateController, { initialProps: controllerProps(request) });
    act(() => result.current.actions.prepareAssistant({ templateId: "invoice", jobId: "job_a" }));
    rerender(controllerProps(request, { activePage: "templates", routeTemplateId: "other" }));
    await waitFor(() => expect(result.current.templatePage.templateName).toBe("Invoice"));
    rerender(controllerProps(request, { activePage: "templates", routeTemplateId: "invoice" }));
    await waitFor(() => expect(request.mock.calls.some(([path]) => path === "/templates/invoice")).toBe(true));
    expect(result.current.templatePage.assistant.isOpen).toBe(false);
  });
});

describe("one-click suggestions", () => {
  const suggestion = { id: "s1", label: "Clarify Total", request: "Clarify how Total handles VAT.", reason: "Total is vague" };

  const panel = (overrides = {}) => ({
    isOpen: true,
    action: "edit",
    instructions: "",
    file: null,
    job: null,
    evaluation: null,
    suggestions: { status: "ready", source: "model", items: [suggestion], notice: "" },
    pending: false,
    response: null,
    applied: false,
    picker: { isOpen: false },
    onSuggestionSubmit: vi.fn(),
    onInstructionsChange: vi.fn(),
    onActionChange: vi.fn(),
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  });

  it("sends a card in one click and fills the request from its edit button", () => {
    const assistant = panel();
    render(<TemplateAssistant assistant={assistant} draft={{ name: "Invoice", fields: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: /^Clarify Total/ }));
    expect(assistant.onSuggestionSubmit).toHaveBeenCalledWith("Clarify how Total handles VAT.");
    expect(assistant.onInstructionsChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit “Clarify Total” before sending" }));
    expect(assistant.onInstructionsChange).toHaveBeenCalledWith("Clarify how Total handles VAT.");
  });

  it("submits the chosen suggestion as the request", async () => {
    const request = vi.fn(async (path, options) => (path === "/templates/assist" ? reply(options) : { templates: [] }));

    const { result } = renderHook(useTemplateController, {
      initialProps: controllerProps(request, { activePage: "templates" }),
    });

    act(() => result.current.templatePage.onOpenAssistant());
    await act(() => result.current.templatePage.assistant.onSuggestionSubmit(suggestion.request));
    await waitFor(() => expect(result.current.templatePage.assistant.response).not.toBeNull());
    const sent = request.mock.calls.find(([path]) => path === "/templates/assist")[1].body;
    expect(JSON.parse(sent.get("payload")).instructions).toBe(suggestion.request);
    expect(result.current.templatePage.assistant.instructions).toBe(suggestion.request);
  });
});

const evaluationEvidence = {
  candidate: { label: "Candidate 1: Invoice", model: "m", template_name: "Invoice", template_id: null, template_version: null, modified: false },
  accuracy: { matched: 0, total: 1 },
  documents: [
    {
      name: "march.pdf",
      accuracy: { matched: 0, total: 1 },
      failures: [
        {
          field_id: "total",
          field_name: "Total",
          data_type: "number",
          verdict: "Mismatch",
          expected_verified: true,
          extracted_status: "ok",
          extracted: 100,
          expected: 120,
          expected_absent: false,
          cells: null,
        },
      ],
    },
  ],
  omitted: { documents: 0, failures: 0 },
  sample_document: null,
};

describe("assistant in the Evaluation template editor", () => {
  const original = new File(["%PDF"], "march.pdf", { type: "application/pdf" });

  const renderEditor = (request, props = {}) =>
    render(
      <TemplateEditorModal
        initial={savedTemplate}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
        assistant={{
          request,
          scope: "evaluation:a",
          hasApiAccess: true,
          intent: {
            action: "edit",
            instructions: "Improve the instructions for “Total”.",
            evaluation: { evidence: evaluationEvidence, sample: { name: "march.pdf", load: async () => original } },
          },
        }}
        {...props}
      />,
    );

  it("sends evaluation evidence, applies edits to the draft and offers Test changes", async () => {
    const request = vi.fn(async (path, options) =>
      path === "/templates/assist" ? reply(options, [describeTotal]) : { source: "model", suggestions: [] },
    );

    const onTestChanges = vi.fn(async () => {});
    renderEditor(request, { onTestChanges });
    const assistant = screen.getByRole("complementary", { name: "Template assistant" });
    // The evidence card and the "What will be sent" summary.
    expect(within(assistant).getAllByText("Evaluation results")).toHaveLength(2);
    expect(within(assistant).getByText("Only verified expected answers are sent.")).toBeTruthy();
    expect(within(assistant).getByRole("textbox").value).toBe("Improve the instructions for “Total”.");
    expect(within(assistant).queryByRole("button", { name: "Choose a completed document…" })).toBeNull();

    fireEvent.click(within(assistant).getByRole("radio", { name: "Original" }));
    await waitFor(() => expect(within(assistant).getByText(/march\.pdf \(the original\)/)).toBeTruthy());
    fireEvent.click(within(assistant).getByRole("button", { name: "Propose edits" }));
    await waitFor(() => expect(within(assistant).getByText("Describe the VAT-inclusive total")).toBeTruthy());

    const sent = request.mock.calls.find(([path]) => path === "/templates/assist")[1].body;
    const payload = JSON.parse(sent.get("payload"));
    expect(payload.evaluation).toMatchObject({ ...evaluationEvidence, sample_document: "march.pdf" });
    expect(payload.jobId).toBeUndefined();
    expect(sent.get("document").name).toBe("march.pdf");

    fireEvent.click(within(assistant).getByRole("button", { name: "Apply 1 change to draft" }));
    fireEvent.click(await within(assistant).findByRole("button", { name: "Test changes" }));
    await waitFor(() => expect(onTestChanges).toHaveBeenCalled());
    expect(onTestChanges.mock.calls[0][0].fields[0].description).toBe("Total due including VAT");
  }, 15_000);

  it("explains the candidate limit instead of making a copy", async () => {
    const request = vi.fn(async (path, options) =>
      path === "/templates/assist" ? reply(options, [describeTotal]) : { source: "model", suggestions: [] },
    );

    const onTestChanges = vi.fn();
    renderEditor(request, { onTestChanges, testLimit: "You can compare up to 8 candidates. Remove one to test these changes on a copy." });
    const assistant = screen.getByRole("complementary", { name: "Template assistant" });
    fireEvent.click(within(assistant).getByRole("button", { name: "Propose edits" }));
    fireEvent.click(await within(assistant).findByRole("button", { name: "Apply 1 change to draft" }));
    expect(await within(assistant).findByText(/You can compare up to 8 candidates/)).toBeTruthy();
    expect(within(assistant).getByRole("button", { name: "Test changes" }).disabled).toBe(true);
  });
});
