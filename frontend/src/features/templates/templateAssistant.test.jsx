import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTemplateController } from "./useTemplateController.js";
import { TemplatePage } from "./TemplatePage.jsx";
import { TemplateEditorModal } from "./TemplateEditorModal.jsx";

const propsFor = (request) => ({
  request,
  workspaceId: "workspace_a",
  sessionId: "session_a",
  hasApiAccess: true,
  activePage: "templates",
  showActionToast: vi.fn(),
  onActivePageChange: vi.fn(),
});

const addVat = {
  id: "vat",
  title: "Add VAT rate",
  rationale: "Include tax percentage for each line.",
  dependsOn: [],
  operations: [
    {
      op: "add_column",
      fieldIndex: 5,
      expectName: "Line Items",
      after: 4,
      column: { heading: "VAT Rate", description: "Tax percentage charged on each item", data_type: "number" },
    },
  ],
};

const answer = (options, groups = [addVat]) => ({
  base: JSON.parse(options.body.get("payload")).base,
  explanation: "The draft can include VAT per line.",
  observations: [],
  groups,
});

const deferred = () => {
  let resolve;

  const promise = new Promise((yes) => {
    resolve = yes;
  });

  return { resolve, promise };
};

const open = (result) => {
  act(() => result.current.templatePage.onOpenAssistant());
  act(() => result.current.templatePage.assistant.onInstructionsChange("Add VAT rate to each line item"));
};

const submit = (result) => act(() => result.current.templatePage.assistant.onSubmit());

const noAssist = async () => ({ templates: [] });

afterEach(cleanup);

describe("Template assistance", () => {
  it("opens and edits without model calls, applies only focused raw changes once, and saves explicitly", async () => {
    const request = vi.fn(async (path, options) =>
      path === "/templates/assist"
        ? answer(options)
        : options.method === "POST"
          ? { template_id: "new" }
          : { templates: [] },
    );

    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    const before = structuredClone(result.current.templatePage.templateFields);
    open(result);
    expect(request.mock.calls.some(([path]) => path === "/templates/assist")).toBe(false);
    await submit(result);
    expect(result.current.templatePage.templateFields).toEqual(before);
    expect(result.current.templatePage.assistant.selection.canApply).toBe(true);
    const apply = result.current.templatePage.assistant.onApply;
    act(() => {
      apply();
      apply();
    });
    const after = result.current.templatePage.templateFields;
    expect(after.slice(0, 5)).toEqual(before.slice(0, 5));
    expect(after[5].object_schema.columns.slice(0, 5)).toEqual(before[5].object_schema.columns);
    expect(after[5].object_schema.columns).toHaveLength(6);
    expect(after[5].object_schema.columns.at(-1)).toMatchObject({ key: "vat_rate", heading: "VAT Rate" });
    expect(result.current.templatePage.assistant.applied).toBe(true);
    expect(request.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
    await act(() => result.current.templatePage.onSaveTemplate());
    expect(request.mock.calls.some(([path, options]) => path === "/templates" && options.method === "POST")).toBe(true);
  });

  it("reviews an invalid draft from an empty request without edits and rejects malformed output", async () => {
    let malformed = false;

    const request = vi.fn(async (path, options) => {
      if (path !== "/templates/assist") return { templates: [] };
      const response = answer(options, []);

      if (malformed) response.groups = [{ ...addVat, unsupported: true }];

      return response;
    });

    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    act(() => result.current.toolbar.onCreateTemplate({ empty: true }));
    const before = result.current.templatePage.templateFields;
    act(() => result.current.templatePage.onOpenAssistant());
    expect(result.current.templatePage.assistant.instructions).toBe("");
    await submit(result);
    const sent = JSON.parse(request.mock.calls.find(([path]) => path === "/templates/assist")[1].body.get("payload"));
    expect(sent).toMatchObject({ action: "edit", instructions: "" });
    expect(result.current.templatePage.assistant.response.groups).toEqual([]);
    expect(result.current.templatePage.templateFields).toEqual(before);
    malformed = true;
    await submit(result);
    expect(result.current.templatePage.assistant.error).not.toBe("");
    expect(result.current.templatePage.templateFields).toEqual(before);
  });

  it.each(["edit", "restore", "JSON", "save", "new draft"])(
    "rejects an already rendered Apply after %s",
    async (change) => {
      const request = vi.fn(async (path, options) =>
        path === "/templates/assist"
          ? answer(options)
          : options.method === "POST"
            ? { template_id: "new" }
            : { templates: [] },
      );

      const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
      open(result);
      await submit(result);
      const oldApply = result.current.templatePage.assistant.onApply;
      const name = result.current.templatePage.templateName;
      await act(async () => {
        if (change === "edit" || change === "restore") {
          result.current.templatePage.onTemplateNameChange("Changed");

          if (change === "restore") result.current.templatePage.onTemplateNameChange(name);
        }

        if (change === "JSON") result.current.toolbar.onOpenJsonModal();

        if (change === "save") await result.current.templatePage.onSaveTemplate();

        if (change === "new draft") result.current.toolbar.onCreateTemplate();
      });
      act(() => oldApply());
      expect(result.current.templatePage.templateFields.at(-1).object_schema.columns).toHaveLength(5);
    },
  );

  it.each(["workspaceId", "sessionId", "activePage", "edit", "cancel", "close", "new draft"])(
    "discards a late response after %s, including returning to the old scope",
    async (change) => {
      const pending = deferred();
      let response;

      const request = vi.fn(async (path, options) => {
        if (path === "/templates/assist") {
          response = answer(options);

          return pending.promise;
        }

        return { templates: [] };
      });

      const props = propsFor(request);
      const { result, rerender } = renderHook(useTemplateController, { initialProps: props });
      open(result);
      let completion;
      act(() => {
        completion = result.current.templatePage.assistant.onSubmit();
      });
      const signal = request.mock.calls.find(([path]) => path === "/templates/assist")[1].signal;

      if (["workspaceId", "sessionId", "activePage"].includes(change)) {
        rerender({ ...props, [change]: "elsewhere" });
        rerender(props);
      } else
        act(() => {
          if (change === "edit") {
            result.current.templatePage.onTemplateNameChange("Changed");
            result.current.templatePage.onTemplateNameChange("Invoice Template");
          }

          if (change === "cancel") result.current.templatePage.assistant.onCancelRequest();

          if (change === "close") result.current.templatePage.assistant.onClose();

          if (change === "new draft") result.current.toolbar.onCreateTemplate();
        });
      expect(signal.aborted).toBe(true);
      await act(async () => {
        pending.resolve(response);
        await completion;
      });
      expect(result.current.templatePage.assistant.response).toBeNull();
      expect(result.current.templatePage.templateFields.at(-1).object_schema.columns).toHaveLength(5);
    },
  );

  it("loads server pages and historical evidence, explicitly chooses exactly one binary", async () => {
    const job = {
      job_id: "job_old",
      original_filename: "old.pdf",
      template_id: "deleted",
      template_version: 2,
      fields: [{ id: "historical", name: "Historical" }],
      results: [],
      source_available: true,
    };

    const request = vi.fn(async (path, options) => {
      if (path === "/templates/assist/evidence/job_old") return job;

      if (path.startsWith("/templates/assist/evidence?"))
        return { jobs: [job], next_cursor: path.includes("cursor") ? null : "next-page" };

      if (path === "/templates/assist") return answer(options);

      return { templates: [] };
    });

    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    open(result);
    await act(() => result.current.templatePage.assistant.picker.onOpen());
    await act(() => result.current.templatePage.assistant.picker.onNext());
    expect(request.mock.calls.some(([path]) => path.includes("cursor=next-page"))).toBe(true);
    await act(() => result.current.templatePage.assistant.picker.onChoose("job_old"));
    expect(result.current.templatePage.assistant.job).toEqual(job);
    expect(result.current.templatePage.assistant.useRetainedSource).toBe(false);
    act(() => result.current.templatePage.assistant.onRetainedSourceChange(true));
    const sample = new File(["sample"], "different.png", { type: "image/png" });
    act(() => result.current.templatePage.assistant.onFileChange(sample));
    expect(result.current.templatePage.assistant.useRetainedSource).toBe(false);
    await submit(result);
    const sent = request.mock.calls.find(([path]) => path === "/templates/assist")[1].body;
    expect(JSON.parse(sent.get("payload"))).toMatchObject({ jobId: "job_old", useRetainedSource: false });
    expect(sent.get("document").name).toBe("different.png");
  });

  it("accepts result references from the server evidence envelope and exposes version differences", async () => {
    const job = {
      job_id: "old_job",
      template_id: "invoice",
      template_version: 2,
      fields: [{ id: "total", name: "Total", data_type: "number", description: "Amount" }],
      results: [{ field_id: "total", answer: 42 }],
      source_available: false,
    };

    const request = vi.fn(async (path, options) => {
      if (path === "/templates/invoice") return { name: "Invoice", current_version: 4, fields: job.fields };

      if (path === "/templates/assist/evidence/old_job") return job;

      if (path === "/templates/assist")
        return {
          ...answer(options, []),
          evidence: { job, source: "no_binary_source_supplied", limitation: "No source supplied" },
          observations: [
            {
              kind: "observation",
              text: "The stored total is 42.",
              references: [{ scope: "result", fieldId: "total" }],
            },
          ],
        };

      return { templates: [] };
    });

    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    await act(() => result.current.contextList.onSelectTemplate("invoice"));
    act(() => result.current.templatePage.onOpenAssistant());
    await act(() => result.current.templatePage.assistant.picker.onChoose("old_job"));
    await submit(result);
    expect(result.current.templatePage.assistant.error).toBe("");
    expect(result.current.templatePage.assistant.response.observations[0].references).toEqual([
      { scope: "result", fieldId: "total" },
    ]);
    expect(result.current.templatePage.assistant.templateVersion).toBe(4);
    render(<TemplatePage {...result.current.templatePage} />);
    expect(screen.getByText(/Result: old_job \(v2; this draft started from v4\)/)).toBeTruthy();
  });

  it("requires a selection that fixes the invalid base and applies only the selected groups", async () => {
    const fixName = {
      id: "name",
      title: "Name the Template",
      rationale: "The requested name identifies this Template.",
      dependsOn: [],
      operations: [{ op: "set_template", set: { name: "Tax Invoice" } }],
    };

    const request = vi.fn(async (path, options) =>
      path === "/templates/assist" ? answer(options, [fixName, addVat]) : { templates: [] },
    );

    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    act(() => result.current.templatePage.onTemplateNameChange(""));
    open(result);
    await submit(result);
    expect(result.current.templatePage.assistant.selection.canApply).toBe(true);
    act(() => result.current.templatePage.assistant.onToggleGroup("name"));
    expect(result.current.templatePage.assistant.selection.canApply).toBe(false);
    act(() => result.current.templatePage.assistant.onApply());
    expect(result.current.templatePage.templateName).toBe("");
    act(() => result.current.templatePage.assistant.onToggleGroup("name"));
    act(() => result.current.templatePage.assistant.onToggleGroup("vat"));
    expect(result.current.templatePage.assistant.selection.canApply).toBe(true);
    act(() => result.current.templatePage.assistant.onApply());
    expect(result.current.templatePage.templateName).toBe("Tax Invoice");
    expect(result.current.templatePage.templateFields.at(-1).object_schema.columns).toHaveLength(5);
  });

  it("keeps evidence failures visible without submitting reduced evidence automatically", async () => {
    const request = vi.fn(async (path) => {
      if (path.includes("/assist/evidence/"))
        throw Object.assign(new Error("This job no longer exists"), { status: 404 });

      return { templates: [] };
    });

    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    open(result);
    await act(() => result.current.templatePage.assistant.picker.onChoose("missing"));
    expect(result.current.templatePage.assistant.picker.error).toContain("no longer exists");
    expect(request.mock.calls.some(([path]) => path === "/templates/assist")).toBe(false);
  });
});

describe("suggested requests", () => {
  const modelSuggestion = {
    id: "model-0",
    label: "Add VAT rate to each line item",
    request: "Add VAT rate to each line item.",
    reason: "Line Items has no VAT column",
  };

  it("asks the model for suggestions about the open draft while composing, without sending a request", async () => {
    const request = vi.fn(async (path) =>
      path === "/templates/assist/suggestions"
        ? { source: "model", suggestions: [modelSuggestion] }
        : { templates: [] },
    );

    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    act(() => result.current.templatePage.onOpenAssistant());
    expect(result.current.templatePage.assistant.suggestions.status).toBe("loading");
    await waitFor(() => expect(result.current.templatePage.assistant.suggestions.status).toBe("ready"));
    expect(result.current.templatePage.assistant.suggestions).toMatchObject({
      source: "model",
      items: [{ label: modelSuggestion.label }],
    });
    const body = JSON.parse(request.mock.calls.find(([path]) => path === "/templates/assist/suggestions")[1].body);
    expect(body).toEqual({
      draft: {
        name: result.current.templatePage.templateName,
        description: result.current.templatePage.templateDescription,
        fields: result.current.templatePage.templateFields,
      },
    });
    expect(request.mock.calls.some(([path]) => path === "/templates/assist")).toBe(false);
  });

  it("falls back to the app's checks when no model is configured", async () => {
    const request = vi.fn(async (path) => {
      if (path === "/templates/assist/suggestions")
        throw Object.assign(new Error("Configure the Model gateway"), {
          status: 409,
          code: "workspace_model_not_configured",
        });

      return { templates: [] };
    });

    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    act(() => result.current.templatePage.onOpenAssistant());
    await waitFor(() => expect(result.current.templatePage.assistant.suggestions.status).toBe("ready"));
    expect(result.current.templatePage.assistant.suggestions.source).toBe("rules");
    expect(result.current.templatePage.assistant.suggestions.notice).toContain("No model is set up for this workspace");
    expect(result.current.templatePage.assistant.suggestions.items.map((item) => item.label)).toContain(
      "Add a Unit of Measure column to Line Items",
    );
  });

  it.each(["Template", "field", "column"])(
    "refreshes after debounced %s instructions change, but not assistant request typing",
    async (target) => {
      vi.useFakeTimers();

      try {
        const request = vi.fn(async (path) =>
          path === "/templates/assist/suggestions" ? { source: "model", suggestions: [] } : { templates: [] },
        );

        const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
        const calls = () => request.mock.calls.filter(([path]) => path === "/templates/assist/suggestions");
        act(() => result.current.templatePage.onOpenAssistant());
        await act(() => vi.advanceTimersByTimeAsync(400));
        expect(calls()).toHaveLength(1);
        expect(result.current.templatePage.assistant.suggestions).toMatchObject({
          status: "ready",
          source: "model",
          items: [],
        });
        act(() => result.current.templatePage.assistant.onInstructionsChange("My own request"));
        await act(() => vi.advanceTimersByTimeAsync(800));
        expect(calls()).toHaveLength(1);

        const change = (description) => {
          const page = result.current.templatePage;

          if (target === "Template") page.onTemplateDescriptionChange(description);
          else {
            const fields = structuredClone(page.templateFields);

            if (target === "field") fields[0].description = description;
            else fields[5].object_schema.columns[0].description = description;
            page.onTemplateFieldsChange(fields);
          }
        };

        act(() => change("First revision of extraction guidance"));
        await act(() => vi.advanceTimersByTimeAsync(200));
        act(() => change("Final revision of extraction guidance"));
        await act(() => vi.advanceTimersByTimeAsync(399));
        expect(calls()).toHaveLength(1);
        await act(() => vi.advanceTimersByTimeAsync(1));
        expect(calls()).toHaveLength(2);
        const sent = JSON.parse(calls()[1][1].body).draft;

        const description =
          target === "Template"
            ? sent.description
            : target === "field"
              ? sent.fields[0].description
              : sent.fields[5].object_schema.columns[0].description;

        expect(description).toBe("Final revision of extraction guidance");
        expect(result.current.templatePage.assistant.instructions).toBe("My own request");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("discards late suggestions after changing evidence or guidance", async () => {
    vi.useFakeTimers();

    try {
      const pending = [];

      const request = vi.fn(async (path) => {
        if (path !== "/templates/assist/suggestions") return { templates: [] };
        const response = deferred();
        pending.push(response);

        return response.promise;
      });

      const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
      act(() => result.current.templatePage.onOpenAssistant());
      await act(() => vi.advanceTimersByTimeAsync(400));
      act(() => result.current.templatePage.assistant.onFileChange(new File(["%PDF"], "sample.pdf", { type: "application/pdf" })));
      await act(() => vi.advanceTimersByTimeAsync(400));
      act(() => result.current.templatePage.onTemplateDescriptionChange("Updated extraction scope"));
      await act(() => vi.advanceTimersByTimeAsync(400));
      const calls = request.mock.calls.filter(([path]) => path === "/templates/assist/suggestions");
      expect(calls).toHaveLength(3);
      expect(calls.slice(0, 2).every(([, options]) => options.signal.aborted)).toBe(true);
      await act(async () => pending[2].resolve({ source: "model", suggestions: [] }));
      await act(async () => {
        for (const response of pending.slice(0, 2))
          response.resolve({ source: "model", suggestions: [modelSuggestion] });
      });
      expect(result.current.templatePage.assistant.suggestions).toMatchObject({
        status: "ready",
        source: "model",
        items: [],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("addressable diagnostics", () => {
  it("focuses the first invalid input on Save without a model call", async () => {
    const request = vi.fn(noAssist);

    function Harness() {
      const controller = useTemplateController(propsFor(request));

      return (
        <>
          <button onClick={() => controller.toolbar.onCreateTemplate({ empty: true })}>Empty</button>
          <TemplatePage {...controller.templatePage} />
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByText("Empty"));
    fireEvent.click(screen.getByRole("button", { name: "Save new template" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Template name"));
    expect(screen.getByLabelText("Template problems").textContent).toContain("Fix these to save");
    expect(
      request.mock.calls.every(
        ([path, options]) => options.method === "GET" && ["/templates", "/template-tags"].includes(path),
      ),
    ).toBe(true);
  });

  it("shares column diagnostics and Save focus with Evaluation editing", async () => {
    const initial = {
      name: "Invoice",
      fields: [
        {
          id: "items",
          name: "Items",
          description: "Items",
          data_type: "array<object>",
          object_schema: {
            mode: "table",
            columns: [{ key: "quantity", heading: "Quantity", data_type: "number", description: "" }],
          },
        },
      ],
    };

    const onSubmit = vi.fn();
    render(<TemplateEditorModal initial={initial} onSubmit={onSubmit} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Table columns" })).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Column description")));
    expect(screen.getByLabelText("Column description").getAttribute("aria-invalid")).toBe("true");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
