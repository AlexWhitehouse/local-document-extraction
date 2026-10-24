import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopyField } from "./CopyField.jsx";

const LONG_URL = `https://studio.example.com/invitations/${"a".repeat(120)}?email=grace%40example.com`;

describe("CopyField", () => {
  it("shows the whole value read-only, labelled and described", () => {
    render(<CopyField label="Invite link" value={LONG_URL} hint="Only Grace can accept it." onCopy={vi.fn()} />);

    const field = screen.getByRole("textbox", { name: "Invite link" });
    expect(field.value).toBe(LONG_URL);
    expect(field.readOnly).toBe(true);
    expect(field.getAttribute("title")).toBe(LONG_URL);
    expect(document.getElementById(field.getAttribute("aria-describedby")).textContent).toBe("Only Grace can accept it.");
  });

  it("selects the value on focus so it can be copied by hand", async () => {
    render(<CopyField label="Invite link" value={LONG_URL} onCopy={vi.fn()} />);
    const field = screen.getByRole("textbox", { name: "Invite link" });

    await userEvent.click(field);

    expect([field.selectionStart, field.selectionEnd]).toEqual([0, LONG_URL.length]);
  });

  it("flashes a tick after copying, then returns to its label", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      const onCopy = vi.fn().mockResolvedValue(true);
      render(<CopyField label="Invite link" value={LONG_URL} copyLabel="Copy link" onCopy={onCopy} />);

      await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

      expect(onCopy).toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
      await act(async () => vi.advanceTimersByTime(1600));
      expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps its label when the copy fails", async () => {
    render(<CopyField label="Invite link" value={LONG_URL} copyLabel="Copy link" onCopy={vi.fn().mockResolvedValue(false)} />);

    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("can hide its label visually while keeping the name", () => {
    render(<CopyField label="Invite link for grace@example.com" labelHidden value={LONG_URL} onCopy={vi.fn()} />);

    expect(screen.getByText("Invite link for grace@example.com").className).toBe("sr-only");
    expect(screen.getByRole("textbox", { name: "Invite link for grace@example.com" })).toBeTruthy();
  });
});
