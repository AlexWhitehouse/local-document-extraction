import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTemplateController } from "./useTemplateController.js";

const saved = {
  id: "one",
  name: "Invoice",
  description: "Saved description",
  current_version: 7,
  tags: ["invoice"],
  fields: [{ name: "Total", description: "Amount paid", data_type: "number" }],
};

const tag = { id: "tag_invoice", name: "invoice", template_count: 1 };

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

  const promise = new Promise((yes) => {
    resolve = yes;
  });

  return { resolve, promise };
};

const mutations = (request) =>
  request.mock.calls.filter(([, options]) => options.method === "PATCH" || options.method === "POST");

const server = () => {
  let tags = [tag];
  let current = structuredClone(saved);

  return vi.fn(async (path, options) => {
    if (path === "/template-tags") return { tags };

    if (path === "/templates")
      return options.method === "POST" ? { template_id: "new", version: 1 } : { templates: current ? [current] : [] };

    if (path === "/templates/one") {
      if (options.method === "PATCH") {
        current = { ...current, ...JSON.parse(options.body) };

        return { template_id: "one", version: 7 };
      }

      if (options.method === "DELETE") {
        current = null;
        tags = tags.map((item) => ({ ...item, template_count: 0 }));

        return;
      }

      return current;
    }

    if (path === "/template-tags/tag_invoice") {
      if (options.method === "DELETE") {
        tags = [];
        current.tags = [];

        return;
      }

      const name = JSON.parse(options.body).name;
      tags = [{ ...tag, name }];
      current.tags = [name];

      return tags[0];
    }

    if (path === "/templates/generate") return { ...saved, name: "Generated" };
    throw new Error(`Unexpected path: ${path}`);
  });
};

afterEach(() => vi.restoreAllMocks());

// Confirms or cancels the in-app dialog that delete flows open.
async function answerDialog(name) {
  const button = await screen.findByRole("button", { name });
  await act(async () => {
    fireEvent.click(button);
  });
}

describe("Template tag draft lifetime", () => {
  it("creates associations only on Save, resets abandoned drafts, and navigates to stored tags", async () => {
    const request = server();
    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    await waitFor(() => expect(result.current.templatePage.tagPicker.tags).toEqual([tag]));
    act(() => result.current.templatePage.onTemplateTagsChange(["  FINANCE  ", "finance"]));
    expect(result.current.templatePage.templateTags).toEqual(["finance"]);
    expect(mutations(request)).toEqual([]);
    act(() => result.current.toolbar.onCreateTemplate());
    expect(result.current.templatePage.templateTags).toEqual([]);
    await act(async () => result.current.contextList.onSelectTemplate("one"));
    expect(result.current.templatePage.templateTags).toEqual(["invoice"]);
    expect(result.current.templatePage.isEditedTemplateDirty).toBe(false);
    act(() => result.current.templatePage.onTemplateTagsChange(["invoice", "finance"]));
    expect(result.current.templatePage.isEditedTemplateDirty).toBe(true);
    await act(() => result.current.templatePage.onSaveTemplate());
    expect(JSON.parse(mutations(request)[0][1].body)).toEqual({ tags: ["finance", "invoice"] });
    expect(result.current.templatePage.isEditedTemplateDirty).toBe(false);
    act(() => result.current.templatePage.onTemplateDescriptionChange("New description"));
    await act(() => result.current.templatePage.onSaveTemplate());
    expect(JSON.parse(mutations(request)[1][1].body)).toEqual({ description: "New description" });
    act(() => result.current.templatePage.onTemplateFieldsChange([{ ...saved.fields[0], description: "Grand total" }]));
    await act(() => result.current.templatePage.onSaveTemplate());
    expect(JSON.parse(mutations(request)[2][1].body)).toEqual({
      fields: [{ ...saved.fields[0], description: "Grand total" }],
    });
  });

  it("round-trips JSON without a request, applies JSON reverting draft changes, and patches tag-only JSON without fields", async () => {
    const request = server();
    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    await act(async () => result.current.contextList.onSelectTemplate("one"));
    act(() => result.current.templatePage.onOpenJsonModal());
    const originalJson = result.current.jsonModal.draft;
    expect(JSON.parse(originalJson).tags).toEqual(["invoice"]);
    await act(() => result.current.jsonModal.onSave());
    expect(mutations(request)).toEqual([]);
    act(() => {
      result.current.templatePage.onTemplateTagsChange(["invoice", "finance"]);
      result.current.templatePage.onTemplateNameChange("Unsaved title");
    });
    act(() => result.current.templatePage.onOpenJsonModal());
    act(() => result.current.jsonModal.onDraftChange(originalJson));
    await act(() => result.current.jsonModal.onSave());
    expect(result.current.templatePage.templateTags).toEqual(["invoice"]);
    expect(result.current.templatePage.templateName).toBe("Invoice");
    expect(result.current.templatePage.isEditedTemplateDirty).toBe(false);
    expect(mutations(request)).toEqual([]);
    act(() => result.current.templatePage.onOpenJsonModal());
    act(() =>
      result.current.jsonModal.onDraftChange(JSON.stringify({ ...JSON.parse(originalJson), tags: ["FINANCE"] })),
    );
    await act(() => result.current.jsonModal.onSave());
    expect(JSON.parse(mutations(request)[0][1].body)).toEqual({ tags: ["finance"] });
    expect(result.current.templatePage.templateTags).toEqual(["finance"]);
    expect(result.current.templatePage.isEditedTemplateDirty).toBe(false);
  });

  it("preserves tags omitted from imported JSON and rejects null without clearing associations", async () => {
    const request = server();
    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    await act(async () => result.current.contextList.onSelectTemplate("one"));
    act(() => result.current.templatePage.onOpenJsonModal());
    const json = JSON.parse(result.current.jsonModal.draft);
    delete json.tags;
    act(() => result.current.jsonModal.onDraftChange(JSON.stringify({ ...json, description: "Imported description" })));
    await act(() => result.current.jsonModal.onSave());
    expect(JSON.parse(mutations(request)[0][1].body)).toEqual({ description: "Imported description" });
    expect(result.current.templatePage.templateTags).toEqual(["invoice"]);
    act(() => result.current.templatePage.onOpenJsonModal());
    act(() => result.current.jsonModal.onDraftChange(JSON.stringify({ ...json, tags: null })));
    await act(() => result.current.jsonModal.onSave());
    expect(result.current.jsonModal.error).toContain("array of strings");
    expect(result.current.templatePage.templateTags).toEqual(["invoice"]);
    expect(mutations(request)).toHaveLength(1);
  });

  it("updates shared names and saved baselines without losing unrelated unsaved changes", async () => {
    const request = server();
    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    await act(async () => result.current.contextList.onSelectTemplate("one"));
    act(() => result.current.templatePage.onTemplateDescriptionChange("Unsaved description"));
    await act(() => result.current.templatePage.tagPicker.onRename(tag, "  FINANCE  "));
    expect(result.current.templatePage.templateTags).toEqual(["finance"]);
    expect(result.current.templatePage.templateDescription).toBe("Unsaved description");
    expect(result.current.templatePage.isEditedTemplateDirty).toBe(true);
    act(() => result.current.templatePage.onTemplateDescriptionChange(saved.description));
    expect(result.current.templatePage.isEditedTemplateDirty).toBe(false);
    act(() => result.current.templatePage.onTemplateDescriptionChange("Later description"));
    await act(() => result.current.templatePage.tagPicker.onDelete({ ...tag, name: "finance" }));
    expect(result.current.templatePage.templateTags).toEqual([]);
    await act(() => result.current.templatePage.onSaveTemplate());
    expect(JSON.parse(mutations(request).at(-1)[1].body)).toEqual({ description: "Later description" });
    expect(result.current.templatePage.isEditedTemplateDirty).toBe(false);
  });

  it("refreshes shared tag counts after deleting a template", async () => {
    const request = server();
    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    await act(async () => result.current.contextList.onSelectTemplate("one"));
    expect(result.current.templatePage.tagPicker.tags[0].template_count).toBe(1);
    const deleting = result.current.toolbar.onDeleteTemplate();
    await answerDialog("Delete template");
    await act(() => deleting);
    expect(result.current.templatePage.tagPicker.tags[0].template_count).toBe(0);
    expect(result.current.templatePage.templateTags).toEqual([]);
  });

  it("preserves tags during replacement generation and clears them for a generated new template", async () => {
    const request = server();
    const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
    await act(async () => result.current.contextList.onSelectTemplate("one"));
    const sample = new File(["sample"], "sample.png", { type: "image/png" });
    act(() => result.current.templatePage.onAutoGenerate());
    act(() => result.current.generationModal.onFileChange(sample));
    await act(() => result.current.generationModal.onGenerate());
    expect(result.current.templatePage.templateTags).toEqual(["invoice"]);
    act(() => result.current.toolbar.onAutoGenerateTemplate());
    act(() => {
      result.current.generationModal.onFileChange(sample);
      result.current.generationModal.onConfirmedChange(true);
    });
    await act(() => result.current.generationModal.onGenerate());
    expect(result.current.templatePage.templateTags).toEqual([]);
    expect(result.current.templatePage.isEditingTemplate).toBe(false);
    act(() => result.current.templatePage.onTemplateTagsChange(["unsaved tag"]));
    act(() => result.current.templatePage.onAutoGenerate());
    act(() => {
      result.current.generationModal.onFileChange(sample);
      result.current.generationModal.onConfirmedChange(true);
    });
    await act(() => result.current.generationModal.onGenerate());
    expect(result.current.templatePage.templateTags).toEqual([]);
  });
});

describe("Template tag request scope", () => {
  it.each(["rename first", "navigation first"])(
    "preserves navigation and shared tag edits when %s finishes",
    async (order) => {
      const pendingRename = deferred(),
        pendingTemplate = deferred();

      const base = server();

      const request = vi.fn((path, options) =>
        path === "/template-tags/tag_invoice"
          ? pendingRename.promise
          : path === "/templates/two"
            ? pendingTemplate.promise
            : base(path, options),
      );

      const { result } = renderHook(useTemplateController, { initialProps: propsFor(request) });
      await act(async () => result.current.contextList.onSelectTemplate("one"));
      let renaming;
      act(() => {
        renaming = result.current.templatePage.tagPicker.onRename(tag, "finance");
      });
      act(() => result.current.contextList.onSelectTemplate("two"));

      const finishNavigation = () =>
        act(async () => pendingTemplate.resolve({ ...saved, id: "two", name: "Second template" }));

      const finishRename = () =>
        act(async () => {
          pendingRename.resolve({ ...tag, name: "finance" });
          await renaming;
        });

      if (order === "rename first") {
        await finishRename();
        await finishNavigation();
      } else {
        await finishNavigation();
        await finishRename();
      }

      expect(result.current.templatePage.templateName).toBe("Second template");
      expect(result.current.templatePage.templateTags).toEqual(["finance"]);
      expect(result.current.templatePage.isEditedTemplateDirty).toBe(false);
    },
  );

  it.each(["workspaceId", "sessionId"])("aborts tag lists and ignores late results after a %s change", async (key) => {
    const pending = deferred();
    const request = vi.fn(async (path) => (path === "/template-tags" ? pending.promise : { templates: [] }));
    const props = propsFor(request);
    const { result, rerender } = renderHook(useTemplateController, { initialProps: props });
    const signal = request.mock.calls.find(([path]) => path === "/template-tags")[1].signal;
    rerender({
      ...props,
      [key]: "other",
      request: vi.fn(async (path) => (path === "/template-tags" ? { tags: [] } : { templates: [] })),
    });
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ tags: [tag] }));
    expect(result.current.templatePage.tagPicker.tags).toEqual([]);
  });

  it("aborts a rename when Workspace changes without affecting the new draft", async () => {
    const pending = deferred();
    const base = server();

    const request = vi.fn((path, options) =>
      path === "/template-tags/tag_invoice" ? pending.promise : base(path, options),
    );

    const props = propsFor(request);
    const { result, rerender } = renderHook(useTemplateController, { initialProps: props });
    await act(async () => result.current.contextList.onSelectTemplate("one"));
    let completion;
    act(() => {
      completion = result.current.templatePage.tagPicker.onRename(tag, "finance");
    });
    const signal = request.mock.calls.find(([path]) => path === "/template-tags/tag_invoice")[1].signal;
    rerender({
      ...props,
      workspaceId: "other",
      request: vi.fn(async (path) => (path === "/template-tags" ? { tags: [] } : { templates: [] })),
    });
    expect(signal.aborted).toBe(true);
    act(() => result.current.templatePage.onTemplateTagsChange(["new draft"]));
    await act(async () => {
      pending.resolve({ ...tag, name: "finance" });
      await completion;
    });
    expect(result.current.templatePage.templateTags).toEqual(["new draft"]);
    expect(result.current.templatePage.tagPicker.tags).toEqual([]);
    expect(result.current.templatePage.isManagingTags).toBe(false);
  });
});
