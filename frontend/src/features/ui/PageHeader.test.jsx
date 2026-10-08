import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { PageHeader } from "./PageHeader.jsx";
import { Tooltip } from "./Tooltip.jsx";

describe("PageHeader", () => {
  it("renders linked breadcrumbs, a page-specific label and an overflow menu", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <PageHeader
        breadcrumbs={[{ label: "Acme", href: "/workspaces/a" }, { label: "Templates" }]}
        title="Invoice"
        actions={<button type="button">Create template</button>}
        overflowActions={[{ key: "delete", label: "Delete template", danger: true, onSelect: onDelete }]}
      />,
    );

    expect(screen.getByRole("banner", { name: "Invoice page" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Acme" }).getAttribute("href")).toBe("/workspaces/a");
    expect(screen.getByText("Templates").getAttribute("aria-current")).toBe("page");

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete template" }));
    expect(onDelete).toHaveBeenCalled();
  });
});

describe("Tooltip", () => {
  it("shows on focus and describes the control", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Set up a Model gateway first">
        <button type="button">Upload</button>
      </Tooltip>,
    );

    await user.tab();
    const tip = screen.getByRole("tooltip");
    expect(tip.className).toContain("is-open");
    expect(screen.getByRole("button", { name: "Upload" }).getAttribute("aria-describedby")).toBe(tip.id);
  });
});

describe("PageHeader compact actions", () => {
  function mockCompactViewport(isCompact) {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: isCompact && query === "(max-width: 600px)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }

  const costs = { key: "costs", label: "Costs", onSelect: vi.fn() };
  const create = { key: "create", label: "Create workspace", onSelect: vi.fn(), "data-tour": "create-workspace" };

  it("shows compact actions as buttons above 600px", () => {
    mockCompactViewport(false);
    render(<PageHeader title="Workspace" compactActions={[costs, create]} />);

    expect(screen.getByRole("button", { name: "Costs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create workspace" }).getAttribute("data-tour")).toBe("create-workspace");
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  it("moves compact actions into the overflow menu at 600px and below", async () => {
    const user = userEvent.setup();
    const onCosts = vi.fn();
    mockCompactViewport(true);
    render(
      <PageHeader
        title="Workspace"
        compactActions={[{ ...costs, onSelect: onCosts }, null]}
        overflowActions={[{ key: "delete", label: "Delete workspace", danger: true, onSelect: vi.fn() }]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Costs" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Costs", "Delete workspace"]);
    await user.click(screen.getByRole("menuitem", { name: "Costs" }));
    expect(onCosts).toHaveBeenCalledTimes(1);
  });

  it("reacts when the viewport crosses 600px", () => {
    let listener;
    let matches = false;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_type, handler) => {
        listener = handler;
      },
      removeEventListener: () => {},
    }));
    render(<PageHeader title="Workspace" compactActions={[costs]} />);
    expect(screen.getByRole("button", { name: "Costs" })).toBeTruthy();

    matches = true;
    act(() => listener({ matches: true }));
    expect(screen.queryByRole("button", { name: "Costs" })).toBeNull();
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
  });
});
