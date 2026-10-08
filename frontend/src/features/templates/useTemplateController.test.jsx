import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTemplateController } from "./useTemplateController";

function deferred() {
  let resolve;

  const promise = new Promise((yes) => {
    resolve = yes;
  });

  return { promise, resolve };
}

// Confirms or cancels the in-app dialog that delete flows open.
async function answerDialog(name) {
  const button = await screen.findByRole("button", { name });
  await act(async () => {
    fireEvent.click(button);
  });
}

const template = (id) => ({ id, name: id, fields: [{ id: "total", name: "Total", data_type: "number" }] });

const propsFor = (request) => ({
  request,
  workspaceId: "workspace_a",
  sessionId: "session_1",
  hasApiAccess: true,
  activePage: "templates",
  showActionToast: vi.fn(),
  onActivePageChange: vi.fn(),
});

describe("template request scope", () => {
  it("starts and resets new drafts with valid invoice fields and line items", async () => {
    const request = vi.fn(async () => ({ templates: [] }));
    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(result.current.templatePage.templateName).toBe("Invoice Template");
    expect(result.current.templatePage.templateFields.map((field) => field.id)).toEqual([
      "invoice_number",
      "invoice_date",
      "vendor_name",
      "total_amount",
      "currency",
      "line_items",
    ]);
    act(() => result.current.toolbar.onOpenJsonModal());
    const payload = JSON.parse(result.current.jsonModal.draft);
    expect(payload.name).toBe("Invoice Template");
    expect(payload.fields.at(-1)).toMatchObject({
      name: "Line Items",
      data_type: "array<object>",
      object_schema: {
        columns: [
          expect.objectContaining({ heading: "Line Number", data_type: "number" }),
          expect.objectContaining({ heading: "Description", data_type: "string" }),
          expect.objectContaining({ heading: "Quantity", data_type: "number" }),
          expect.objectContaining({ heading: "Unit Price", data_type: "number" }),
          expect.objectContaining({ heading: "Line Total", data_type: "number" }),
        ],
      },
    });
    act(() => result.current.toolbar.onCreateTemplate({ empty: true }));
    expect(result.current.templatePage.templateName).toBe("");
    act(() => result.current.toolbar.onCreateTemplate());
    expect(result.current.templatePage.templateName).toBe("Invoice Template");
    expect(result.current.templatePage.templateFields.map((field) => field.name)).toEqual(
      payload.fields.map((field) => field.name),
    );
  });

  it.each(["workspaceId", "sessionId"])("discards lists from the previous %s", async (key) => {
    const pending = deferred();
    const props = propsFor(vi.fn(() => pending.promise));
    const { result, rerender } = renderHook(useTemplateController, { initialProps: props });
    rerender({ ...props, [key]: "new_context", request: vi.fn(async () => ({ templates: [template("new")] })) });
    await waitFor(() => expect(result.current.templates[0]?.id).toBe("new"));
    await act(async () => pending.resolve({ templates: [template("old")] }));
    expect(result.current.templates.map((item) => item.id)).toEqual(["new"]);
    expect(result.current.selectedUploadTemplateId).toBe("new");
  });

  it("clears the editor and discards pending details when workspace changes", async () => {
    const pending = deferred();
    const request = vi.fn(async (path) => (path === "/templates" ? { templates: [template("old")] } : pending.promise));
    const props = propsFor(request);
    const { result, rerender } = renderHook(useTemplateController, { initialProps: props });
    await waitFor(() => expect(result.current.templates).toHaveLength(1));
    act(() => result.current.contextList.onSelectTemplate("old"));
    act(() => result.current.templatePage.onTemplateNameChange("Old workspace draft"));
    act(() => result.current.toolbar.onOpenJsonModal());
    rerender({ ...props, workspaceId: "workspace_b", request: vi.fn(async () => ({ templates: [] })) });
    await act(async () => pending.resolve(template("old")));
    expect(result.current.templatePage.isEditingTemplate).toBe(false);
    expect(result.current.templatePage.templateName).toBe("Invoice Template");
    expect(result.current.selectedUploadTemplateId).toBe("");
    expect(result.current.jsonModal.isOpen).toBe(false);
  });

  it.each(["select", "draft"])("keeps the latest %s action when older details arrive", async (action) => {
    const pending = deferred();

    const request = vi.fn(async (path) => {
      if (path === "/templates") return { templates: [template("old"), template("new")] };

      if (path === "/templates/old") return pending.promise;

      return template("new");
    });

    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    await waitFor(() => expect(result.current.templates).toHaveLength(2));
    act(() => result.current.contextList.onSelectTemplate("old"));
    await act(async () => {
      if (action === "select") result.current.contextList.onSelectTemplate("new");
      else result.current.toolbar.onCreateTemplate({ empty: true });
    });
    await act(async () => pending.resolve(template("old")));
    expect(result.current.templatePage.templateName).toBe(action === "select" ? "new" : "");
  });

  it("does not restore a newly created template into another workspace", async () => {
    const pending = deferred();
    const request = vi.fn(async (_path, options) => (options.method === "POST" ? pending.promise : { templates: [] }));
    const props = propsFor(request);
    const { result, rerender } = renderHook(useTemplateController, { initialProps: props });
    let saving;
    act(() => {
      saving = result.current.templatePage.onSaveTemplate();
    });
    rerender({ ...props, workspaceId: "workspace_b", request: vi.fn(async () => ({ templates: [] })) });
    await act(async () => {
      pending.resolve({ template_id: "old" });
      await saving;
    });
    expect(result.current.templatePage.isEditingTemplate).toBe(false);
    expect(result.current.selectedUploadTemplateId).toBe("");
    expect(props.showActionToast).not.toHaveBeenCalled();
  });
});

describe("template deletion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the template and keeps the assistant open when the confirmation is cancelled", async () => {
    const internal = { ...template("t_internal"), name: "Invoice Pack" };
    const request = vi.fn(async (path) => (path === "/templates" ? { templates: [internal] } : internal));
    const props = propsFor(request);
    const { result } = renderHook(useTemplateController, { initialProps: props });
    await waitFor(() => expect(result.current.templates).toHaveLength(1));
    act(() => result.current.contextList.onSelectTemplate("t_internal"));
    await waitFor(() => expect(result.current.templatePage.isEditingTemplate).toBe(true));
    act(() => result.current.templatePage.onOpenAssistant());
    expect(result.current.templatePage.assistant.isOpen).toBe(true);
    const deleting = result.current.toolbar.onDeleteTemplate();
    const dialog = await screen.findByRole("alertdialog", { name: 'Delete "Invoice Pack"?' });
    expect(dialog.textContent).not.toContain("t_internal");
    await answerDialog("Cancel");
    await act(() => deleting);
    expect(result.current.templatePage.assistant.isOpen).toBe(true);
    expect(request.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(false);
  });

  it("cancels the assistant only after the deletion is confirmed", async () => {
    const request = vi.fn(async (path, options) => {
      if (options?.method === "DELETE") return {};

      return path === "/templates" ? { templates: [template("t_internal")] } : template("t_internal");
    });

    const props = propsFor(request);
    const { result } = renderHook(useTemplateController, { initialProps: props });
    await waitFor(() => expect(result.current.templates).toHaveLength(1));
    act(() => result.current.contextList.onSelectTemplate("t_internal"));
    await waitFor(() => expect(result.current.templatePage.isEditingTemplate).toBe(true));
    act(() => result.current.templatePage.onOpenAssistant());
    const deleting = result.current.toolbar.onDeleteTemplate();
    expect(result.current.templatePage.assistant.isOpen).toBe(true);
    await answerDialog("Delete template");
    await act(() => deleting);

    expect(request.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(true);
    expect(result.current.templatePage.assistant.isOpen).toBe(false);
  });
});
