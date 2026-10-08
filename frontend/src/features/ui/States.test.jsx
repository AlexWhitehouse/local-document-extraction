import { render, renderHook, act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, ErrorState, ListStatus } from "./States.jsx";
import { useAsyncAction } from "./useAsyncAction.js";

describe("state primitives", () => {
  it("shows a mapped error with Try again, never the raw message", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState error={Object.assign(new Error("<html>"), { status: 403 })} onRetry={onRetry} />);

    expect(screen.getByRole("alert").textContent).toContain("You don't have permission to do that.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows an empty state with its action", () => {
    render(<EmptyState message="No documents yet" action={<button type="button">Upload documents</button>} />);

    expect(screen.getByText("No documents yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload documents" })).toBeTruthy();
  });

  it("never shows the empty state for a failed load", () => {
    render(
      <ListStatus status="error" error={new Error("x")} isEmpty emptyMessage="No documents yet">
        <p>rows</p>
      </ListStatus>,
    );

    expect(screen.queryByText("No documents yet")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

describe("useAsyncAction", () => {
  it("tracks pending and ignores repeat calls", async () => {
    let finish;
    const action = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useAsyncAction(action));

    let first;
    act(() => {
      first = result.current[1]("a");
    });
    expect(result.current[0]).toBe(true);
    await act(async () => {
      await result.current[1]("b");
    });
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish("done");
      await first;
    });
    expect(result.current[0]).toBe(false);
  });
});
