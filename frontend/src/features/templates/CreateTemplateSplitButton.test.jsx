import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
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

  it("auto-generates a template from the joined magic button", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onAutoGenerate = vi.fn();

    render(<CreateTemplateSplitButton onCreate={onCreate} onAutoGenerate={onAutoGenerate} />);

    await user.click(screen.getByRole("button", { name: "Auto-generate template" }));
    expect(onAutoGenerate).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("disables both parts without API access", () => {
    render(<CreateTemplateSplitButton disabled onCreate={vi.fn()} onAutoGenerate={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Create template" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Auto-generate template" }).disabled).toBe(true);
  });
});
