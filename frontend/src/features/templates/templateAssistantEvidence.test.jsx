import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTemplateController } from "./useTemplateController.js";
import { TemplateAssistant } from "./TemplateAssistant.jsx";

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
        instructions: "Improve the instructions for “Total”.",
        jobId: "job_a",
        useOriginal: true,
      }),
    );
    rerender(controllerProps(request, { activePage: "templates", routeTemplateId: "invoice" }));
    await waitFor(() => expect(result.current.templatePage.assistant.isOpen).toBe(true));
    await waitFor(() => expect(result.current.templatePage.assistant.job?.job_id).toBe("job_a"));
    const panel = result.current.templatePage.assistant;
    expect(panel.instructions).toBe("Improve the instructions for “Total”.");
    expect(panel.useRetainedSource).toBe(true);
    // The job came from v2; the open Template is v3, so the existing version warning applies.
    expect(panel.templateVersion).toBe(3);
    // Suggestions take the attached result into account.
    await waitFor(() =>
      expect(
        request.mock.calls.some(
          ([path, options]) => path === "/templates/assist/suggestions" && JSON.parse(options.body).jobId === "job_a",
        ),
      ).toBe(true),
    );
  });

  it("summarises the weak fields of the attached result", () => {
    const weakJob = { ...job, results: [{ field_id: "total", name: "Total", status: "not_found" }] };

    render(
      <TemplateAssistant
        assistant={{
          isOpen: true,
          instructions: "",
          file: null,
          job: weakJob,
          evaluation: null,
          templateId: "invoice",
          templateVersion: 3,
          suggestions: { status: "ready", source: "rules", items: [], notice: "" },
          pending: false,
          response: null,
          applied: false,
          picker: { isOpen: false },
          onClose: vi.fn(),
          onSubmit: vi.fn(),
        }}
        draft={{ name: "Invoice", fields: savedTemplate.fields }}
      />,
    );
    expect(screen.getByText(/1 field missing, unreadable or low confidence: “Total”/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review draft" })).toBeTruthy();
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
