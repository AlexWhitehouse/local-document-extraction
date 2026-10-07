import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useTemplateController } from "./useTemplateController.js";
import { TemplateGenerationModal } from "./TemplateGenerationModal.jsx";

const proposal = {
  name: "Receipt",
  description: "Receipt details",
  fields: [{ name: "Total", description: "Amount paid", data_type: "number" }],
};

const file = new File(["sample"], "receipt.png", { type: "image/png" });

const propsFor = (request) => ({
  request,
  workspaceId: "workspace_a",
  sessionId: "session_a",
  hasApiAccess: true,
  activePage: "templates",
  showActionToast: vi.fn(),
  onActivePageChange: vi.fn(),
});

const deferred = () => {
  let resolve;
  let reject;

  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { resolve, reject, promise };
};

async function open(result) {
  act(() => result.current.templatePage.onAutoGenerate());
  act(() => result.current.generationModal.onFileChange(file));
}

describe("Template generation", () => {
  it("populates the complete new draft and saves only when explicitly requested", async () => {
    const request = vi.fn(async (path, options) =>
      path === "/templates/generate"
        ? proposal
        : options.method === "POST"
          ? { template_id: "new" }
          : { templates: [] },
    );

    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    await open(result);
    act(() => result.current.generationModal.onInstructionsChange("Totals only"));
    await act(() => result.current.generationModal.onGenerate());
    expect(result.current.templatePage.templateName).toBe("Receipt");
    expect(result.current.templatePage.templateDescription).toBe("Receipt details");
    expect(result.current.templatePage.templateFields).toHaveLength(1);
    expect(result.current.templatePage.isEditingTemplate).toBe(false);
    expect(result.current.generationModal.isOpen).toBe(false);
    const generation = request.mock.calls.find(([path]) => path === "/templates/generate")[1];
    expect(generation.body.get("instructions")).toBe("Totals only");
    expect(request.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
    await act(() => result.current.templatePage.onSaveTemplate());
    expect(request).toHaveBeenCalledWith("/templates", expect.objectContaining({ method: "POST" }));
  });

  it("replaces an existing template only as a draft and requires confirmation for unsaved changes", async () => {
    const old = { ...proposal, name: "Old", id: "old" };

    const request = vi.fn(async (path) =>
      path === "/templates/generate" ? proposal : path === "/templates/old" ? old : { templates: [old] },
    );

    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    await act(async () => result.current.contextList.onSelectTemplate("old"));
    act(() => result.current.templatePage.onTemplateNameChange("Unsaved"));
    await open(result);
    expect(result.current.generationModal.hasUnsavedChanges).toBe(true);
    await act(() => result.current.generationModal.onGenerate());
    expect(request.mock.calls.some(([path]) => path === "/templates/generate")).toBe(false);
    act(() => result.current.generationModal.onConfirmedChange(true));
    await act(() => result.current.generationModal.onGenerate());
    expect(result.current.templatePage.templateName).toBe("Receipt");
    expect(result.current.templatePage.isEditedTemplateDirty).toBe(true);
    expect(result.current.toolbar.selectedTemplateId).toBe("old");
    expect(request.mock.calls.some(([, options]) => options.method === "PATCH")).toBe(false);
    await act(() => result.current.templatePage.onSaveTemplate());
    expect(request).toHaveBeenCalledWith("/templates/old", expect.objectContaining({ method: "PATCH" }));
  });

  it("preserves edits on failure and keeps inputs available for manual retry", async () => {
    const request = vi.fn(async (path) => {
      if (path === "/templates/generate") throw new Error("Gateway timed out");

      return { templates: [] };
    });

    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    act(() => result.current.templatePage.onTemplateNameChange("My draft"));
    await open(result);
    act(() => result.current.generationModal.onConfirmedChange(true));
    await act(() => result.current.generationModal.onGenerate());
    expect(result.current.templatePage.templateName).toBe("My draft");
    expect(result.current.generationModal).toMatchObject({
      isOpen: true,
      isGenerating: false,
      error: "Gateway timed out",
      file,
    });
  });

  it.each(["cancel", "workspaceId", "sessionId", "activePage", "template", "draft"])(
    "cancels and discards late results on %s",
    async (change) => {
      const pending = deferred();

      const request = vi.fn(async (path) =>
        path === "/templates/generate"
          ? pending.promise
          : path === "/templates/other"
            ? { ...proposal, name: "Other" }
            : { templates: [] },
      );

      const props = propsFor(request);
      const { result, rerender } = renderHook(useTemplateController, { initialProps: props });
      await open(result);
      let completion;
      act(() => {
        completion = result.current.generationModal.onGenerate();
      });
      const signal = request.mock.calls.find(([path]) => path === "/templates/generate")[1].signal;
      await act(async () => {
        if (change === "cancel") result.current.generationModal.onClose();
        else if (change === "template") result.current.contextList.onSelectTemplate("other");
        else if (change === "draft") result.current.toolbar.onCreateTemplate({ empty: true });
        else rerender({ ...props, [change]: "different" });
      });
      expect(signal.aborted).toBe(true);
      await act(async () => {
        pending.resolve(proposal);
        await completion;
      });
      expect(result.current.templatePage.templateName).not.toBe("Receipt");
      expect(result.current.generationModal.isOpen).toBe(false);
    },
  );

  it("renders replacement confirmation, progress, errors, and accessible cancellation", async () => {
    function Harness() {
      const controller = useTemplateController(
        propsFor(async (path) => {
          if (path === "/templates/generate") throw new Error("Model is not configured");

          return { templates: [] };
        }),
      );

      return (
        <>
          <button onClick={() => controller.templatePage.onAutoGenerate()}>Open</button>
          <TemplateGenerationModal {...controller.generationModal} />
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    fireEvent.change(screen.getByLabelText("Sample file"), { target: { files: [file] } });
    fireEvent.click(screen.getByText("Generate template"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Model is not configured"));
    expect(screen.getByText("Try again")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    // The sample is a draft, so Escape asks before discarding it.
    await userEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("dialog", { name: "Auto generate template" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await userEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

it("rotates generation messages and clears the timer when generation stops", () => {
  vi.useFakeTimers();
  const props = { isOpen: true, file, instructions: "", isGenerating: true, hasApiAccess: true, onClose: vi.fn() };
  const view = render(<TemplateGenerationModal {...props} />);

  try {
    expect(screen.getByText("Combobulating response…")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2800));
    expect(screen.getByText("Consulting the schema sprites…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" }).disabled).toBe(false);
    view.rerender(<TemplateGenerationModal {...props} isGenerating={false} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    view.rerender(<TemplateGenerationModal {...props} />);
    expect(screen.getByText("Combobulating response…")).toBeTruthy();
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it("accepts a dropped sample, rejects multiple samples, and locks uploads during generation", () => {
  const onFileChange = vi.fn();
  const props = { isOpen: true, instructions: "", hasApiAccess: true, onFileChange, onClose: vi.fn() };
  const view = render(<TemplateGenerationModal {...props} />);
  const dropzone = screen.getByRole("button", { name: /Drag and drop a sample document/ });
  fireEvent.drop(dropzone, { dataTransfer: { files: [file, file] } });
  expect(screen.getByRole("alert").textContent).toContain("one sample");
  expect(onFileChange).not.toHaveBeenCalled();
  fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
  expect(onFileChange).toHaveBeenCalledWith(file);
  expect(screen.queryByRole("alert")).toBeNull();
  view.rerender(<TemplateGenerationModal {...props} file={file} isGenerating />);
  expect(screen.queryByRole("button", { name: /Drag and drop a sample document/ })).toBeNull();
  expect(onFileChange).toHaveBeenCalledTimes(1);
});

it("the toolbar magic action creates a new template and cancellation preserves the current editor", async () => {
  const old = { ...proposal, name: "Existing template", id: "old" };

  const request = vi.fn(async (path, options) => {
    if (path === "/templates/generate") return proposal;

    if (path === "/templates/old") return old;

    if (options.method === "POST") return { template_id: "new" };

    return { templates: [old] };
  });

  const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
  await act(async () => result.current.contextList.onSelectTemplate("old"));
  act(() => result.current.templatePage.onTemplateNameChange("Unsaved existing edit"));
  act(() => result.current.toolbar.onAutoGenerateTemplate());
  expect(result.current.generationModal.isOpen).toBe(true);
  act(() => result.current.generationModal.onClose());
  expect(result.current.templatePage.templateName).toBe("Unsaved existing edit");
  expect(result.current.toolbar.selectedTemplateId).toBe("old");
  act(() => result.current.toolbar.onAutoGenerateTemplate());
  act(() => {
    result.current.generationModal.onFileChange(file);
    result.current.generationModal.onConfirmedChange(true);
  });
  await act(() => result.current.generationModal.onGenerate());
  expect(result.current.templatePage.templateName).toBe("Receipt");
  expect(result.current.templatePage.isEditingTemplate).toBe(false);
  expect(result.current.toolbar.selectedTemplateId).toBe("");
  await act(() => result.current.templatePage.onSaveTemplate());
  expect(request).toHaveBeenCalledWith("/templates", expect.objectContaining({ method: "POST" }));
  expect(request.mock.calls.some(([, options]) => options.method === "PATCH")).toBe(false);
});
