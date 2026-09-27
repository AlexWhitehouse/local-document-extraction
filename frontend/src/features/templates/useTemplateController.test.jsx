import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTemplateController } from "./useTemplateController";

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}
const template = (id) => ({ id, name: id, fields: [{ id: "total", name: "Total", data_type: "number" }] });
const propsFor = (request) => ({
  request, workspaceId: "workspace_a", sessionId: "session_1", hasApiAccess: true,
  activePage: "templates", addLog: vi.fn(), showActionToast: vi.fn(), onActivePageChange: vi.fn(),
});

describe("template request scope", () => {
  it("starts and resets new drafts with valid invoice fields and line items", async () => {
    const request = vi.fn(async () => ({ templates: [] }));
    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(result.current.templatePage.templateName).toBe("Invoice Template");
    expect(result.current.templatePage.templateFields.map((field) => field.id)).toEqual([
      "invoice_number", "invoice_date", "vendor_name", "total_amount", "currency", "line_items",
    ]);
    act(() => result.current.templatePage.onOpenJsonModal());
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
    expect(result.current.templatePage.templateFields.map((field) => field.name)).toEqual(payload.fields.map((field) => field.name));
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
    const request = vi.fn(async (path) => path === "/templates" ? { templates: [template("old")] } : pending.promise);
    const props = propsFor(request);
    const { result, rerender } = renderHook(useTemplateController, { initialProps: props });
    await waitFor(() => expect(result.current.templates).toHaveLength(1));
    act(() => result.current.contextList.onSelectTemplate("old"));
    act(() => result.current.templatePage.onTemplateNameChange("Old workspace draft"));
    act(() => result.current.templatePage.onOpenJsonModal());
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
    const request = vi.fn(async (_path, options) => options.method === "POST" ? pending.promise : { templates: [] });
    const props = propsFor(request);
    const { result, rerender } = renderHook(useTemplateController, { initialProps: props });
    let saving;
    act(() => { saving = result.current.templatePage.onSaveTemplate(); });
    rerender({ ...props, workspaceId: "workspace_b", request: vi.fn(async () => ({ templates: [] })) });
    await act(async () => { pending.resolve({ template_id: "old" }); await saving; });
    expect(result.current.templatePage.isEditingTemplate).toBe(false);
    expect(result.current.selectedUploadTemplateId).toBe("");
    expect(props.showActionToast).not.toHaveBeenCalled();
  });
});
