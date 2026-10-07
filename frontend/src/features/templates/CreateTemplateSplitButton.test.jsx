import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateTemplateSplitButton } from "./CreateTemplateSplitButton.jsx";

describe("Create template split button", () => {
  afterEach(() => {
    cleanup();
  });

  it("creates a blank template from the primary action", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onAutoGenerate = vi.fn();

    render(<CreateTemplateSplitButton onCreate={onCreate} onAutoGenerate={onAutoGenerate} />);

    await user.click(screen.getByRole("button", { name: "Create template" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onAutoGenerate).not.toHaveBeenCalled();
  });

  it("offers blank and auto-generated creation from the chevron menu", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onAutoGenerate = vi.fn();

    render(<CreateTemplateSplitButton onCreate={onCreate} onAutoGenerate={onAutoGenerate} />);

    const toggle = screen.getByRole("button", { name: "More ways to create a template" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "Blank template" })).toBeTruthy();

    await user.click(screen.getByRole("menuitem", { name: "Auto-generate from sample" }));
    expect(onAutoGenerate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it("closes the menu on an outside click", async () => {
    const user = userEvent.setup();

    render(
      <>
        <CreateTemplateSplitButton onCreate={vi.fn()} onAutoGenerate={vi.fn()} />
        <p>Elsewhere</p>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "More ways to create a template" }));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.pointerDown(screen.getByText("Elsewhere"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
