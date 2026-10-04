import React, { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemplateTags } from "./TemplateTags.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const invoice = { id: "tag_invoice", name: "invoice", template_count: 2 };

describe("Template tag dropdown", () => {
  it("supports keyboard selection, normalized creation, and detaching without shared deletion", async () => {
    const user = userEvent.setup(),
      onDelete = vi.fn();

    let selected;

    function Harness() {
      const [value, setValue] = useState([]);
      selected = value;

      return <TemplateTags tags={[invoice]} value={value} onChange={setValue} onDelete={onDelete} />;
    }

    render(<Harness />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByLabelText("Search or create tags"));
    await user.tab();
    await user.keyboard(" ");
    expect(selected).toEqual(["invoice"]);
    await user.type(screen.getByLabelText("Search or create tags"), "  FINANCE   Reports ");
    await user.click(screen.getByRole("button", { name: "Create “finance reports”" }));
    expect(selected).toEqual(["finance reports", "invoice"]);
    expect(screen.getByRole("checkbox", { name: "finance reports" }).checked).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "invoice", exact: true }));
    expect(selected).toEqual(["finance reports"]);
    expect(onDelete).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Template tags" }));
  });

  it("explains global changes, displays rename errors, and confirms affected template counts", async () => {
    const user = userEvent.setup();

    const onRename = vi
      .fn()
      .mockRejectedValueOnce(new Error("A tag with this name already exists"))
      .mockResolvedValue(true);

    const onDelete = vi.fn().mockResolvedValue(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(
      <TemplateTags tags={[invoice]} value={["invoice"]} onChange={vi.fn()} onRename={onRename} onDelete={onDelete} />,
    );
    await user.click(screen.getByRole("button", { name: "Template tags" }));
    await user.click(screen.getByRole("button", { name: "Manage tags" }));
    expect(screen.getByText(/updates all templates immediately/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Rename invoice" }));
    await user.clear(screen.getByLabelText("New tag name"));
    await user.type(screen.getByLabelText("New tag name"), "Finance");
    await user.click(screen.getByRole("button", { name: "Save tag name" }));
    expect(screen.getByRole("alert").textContent).toContain("already exists");
    await user.click(screen.getByRole("button", { name: "Save tag name" }));
    expect(onRename).toHaveBeenLastCalledWith(invoice, "Finance");
    expect(screen.queryByLabelText("New tag name")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Delete invoice" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("removes it from 2 templates across this Workspace"));
    await user.click(screen.getByRole("button", { name: "Delete invoice" }));
    expect(onDelete).toHaveBeenCalledWith(invoice);
  });

  it("rejects invalid names before creation and provides a list-loading retry", async () => {
    const user = userEvent.setup(),
      onChange = vi.fn(),
      onReload = vi.fn();

    render(<TemplateTags onChange={onChange} onReload={onReload} error="Unable to load template tags" />);
    await user.click(screen.getByRole("button", { name: "Template tags" }));
    await user.click(screen.getByRole("button", { name: "Retry tags" }));
    expect(onReload).toHaveBeenCalledOnce();
    await user.type(screen.getByLabelText("Search or create tags"), "x".repeat(65));
    expect(screen.queryByRole("button", { name: /^Create/ })).toBeNull();
    expect(screen.getByText(/at most 64 characters/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
