import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TemplateContextList } from "./TemplateContextList.jsx";

const templates = Array.from({ length: 30 }, (_, index) => ({ id: `template_${index}`, name: `Template ${index}` }));

function renderList(overrides = {}) {
  const props = {
    workspaceId: "",
    search: "",
    templates,
    selectedTemplateId: "",
    isEditingTemplate: false,
    onSearchChange: vi.fn(),
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

  it("returns to the first page when the search changes", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole("button", { name: /Load more templates/ }));
    expect(listedTemplates()).toHaveLength(24);
    await user.type(screen.getByLabelText("Search Templates"), "2");
    expect(listedTemplates()).toHaveLength(12);
  });
});
