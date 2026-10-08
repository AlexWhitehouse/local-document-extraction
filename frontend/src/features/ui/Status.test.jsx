import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CountBadge, StatusDot, Tag } from "./Status.jsx";

afterEach(cleanup);

describe("Tag", () => {
  it("is a plain chip unless it is selectable", () => {
    render(<Tag>invoice</Tag>);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("invoice").tagName).toBe("SPAN");
  });

  it("is a toggle button with aria-pressed when selectable", () => {
    const onToggle = vi.fn();

    const { rerender } = render(
      <Tag selectable selected={false} onToggle={onToggle}>
        finance
      </Tag>,
    );

    const tag = screen.getByRole("button", { name: "finance" });
    expect(tag.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(tag);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <Tag selectable selected onToggle={onToggle}>
        finance
      </Tag>,
    );
    expect(screen.getByRole("button", { name: "finance" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("CountBadge", () => {
  it("shows the count visibly and names it for screen readers", () => {
    render(<CountBadge count={3} label="3 issues" tone="danger" />);

    expect(screen.getByText("3").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("3 issues").className).toBe("sr-only");
  });
});

describe("StatusDot", () => {
  it("keeps text beside the colour, or in a screen-reader-only label", () => {
    render(
      <>
        <StatusDot tone="success" label="Saved" />
        <StatusDot tone="warning" label="Needs review" srOnlyLabel />
      </>,
    );

    expect(screen.getByText("Saved").className).not.toContain("sr-only");
    expect(screen.getByText("Needs review").className).toContain("sr-only");
  });
});
