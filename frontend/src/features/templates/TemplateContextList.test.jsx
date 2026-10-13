import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TemplateContextList } from "./TemplateContextList.jsx";

const templates = Array.from({ length: 30 }, (_, index) => ({ id: `template_${index}`, name: `Template ${index}` }));

function listProps(overrides = {}) {
  return {
    workspaceId: "",
    templates,
    selectedTemplateId: "",
    isEditingTemplate: false,
    onSelectDraftTemplate: vi.fn(),
    onSelectTemplate: vi.fn(),
    onCreateTemplate: vi.fn(),
    onAutoGenerateTemplate: vi.fn(),
    ...overrides,
  };
}

function renderList(overrides = {}) {
  const props = {
    workspaceId: "",
    templates,
    selectedTemplateId: "",
    isEditingTemplate: false,
    onSelectDraftTemplate: vi.fn(),
    onSelectTemplate: vi.fn(),
    ...overrides,
  };

  render(<TemplateContextList {...props} />);

  return props;
}

function listedTemplates() {
  return within(screen.getByRole("region", { name: "Template list" })).queryAllByText(/^Template \d+$/);
}

describe("TemplateContextList", () => {
  it("loads the next page of Templates on demand", async () => {
    const user = userEvent.setup();
    renderList();

    expect(listedTemplates()).toHaveLength(12);
    await user.click(screen.getByRole("button", { name: /Load more templates/ }));
    expect(listedTemplates()).toHaveLength(24);
    await user.click(screen.getByRole("button", { name: /Load more templates/ }));
    expect(listedTemplates()).toHaveLength(30);
    expect(screen.queryByRole("button", { name: /Load more templates/ })).toBeNull();
  });

  it("shows loading as a skeleton and errors with Try again in place of the rows", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(<TemplateContextList {...listProps({ status: "loading", templates: [] })} />);

    expect(screen.getByRole("status", { name: "Loading…" })).toBeTruthy();
    expect(screen.queryByText("No templates yet.")).toBeNull();

    rerender(<TemplateContextList {...listProps({ status: "error", templates: [], error: new Error("x"), onRetry })} />);
    expect(screen.getByRole("alert").textContent).toContain("This couldn't be loaded.");
    expect(screen.queryByText("No templates yet.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers create and generate actions when there are no templates", async () => {
    const user = userEvent.setup();
    const onCreateTemplate = vi.fn();
    const onAutoGenerateTemplate = vi.fn();
    render(
      <TemplateContextList
        {...listProps({ templates: [], onCreateTemplate, onAutoGenerateTemplate })}
      />,
    );

    expect(screen.getByText("No templates yet.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create template" }));
    await user.click(screen.getByRole("button", { name: "Generate from a sample" }));
    expect(onCreateTemplate).toHaveBeenCalledTimes(1);
    expect(onAutoGenerateTemplate).toHaveBeenCalledTimes(1);
  });

  it("has no search field; search lives in the command palette", () => {
    renderList();

    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
