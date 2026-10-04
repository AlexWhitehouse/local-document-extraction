import React, { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRowMotion } from "./useRowMotion";

function Harness({ rows }) {
  const rowMotion = useRowMotion(
    rows,
    (row) => row.id,
    (row) => row.status,
  );

  return rows.map((row) => (
    <span key={row.id} data-testid={row.id}>
      {rowMotion(row.id).trim()}
    </span>
  ));
}

describe("useRowMotion", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps rows from the first load still, then flags arrivals and settled tones once", () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <StrictMode>
        <Harness rows={[]} />
      </StrictMode>,
    );

    rerender(
      <StrictMode>
        <Harness rows={[{ id: "a", status: "progress" }]} />
      </StrictMode>,
    );
    expect(screen.getByTestId("a").textContent).toBe("");

    rerender(
      <StrictMode>
        <Harness
          rows={[
            { id: "b", status: "progress" },
            { id: "a", status: "progress" },
          ]}
        />
      </StrictMode>,
    );
    expect(screen.getByTestId("b").textContent).toBe("row-arrived");
    expect(screen.getByTestId("a").textContent).toBe("");

    rerender(
      <StrictMode>
        <Harness
          rows={[
            { id: "b", status: "progress" },
            { id: "a", status: "completed" },
          ]}
        />
      </StrictMode>,
    );
    expect(screen.getByTestId("a").textContent).toBe("row-changed");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId("a").textContent).toBe("");
    expect(screen.getByTestId("b").textContent).toBe("");
  });

  it("does not re-flag rows that return after being filtered out", () => {
    const rows = [
      { id: "a", status: "" },
      { id: "b", status: "" },
    ];

    const { rerender } = render(<Harness rows={rows} />);
    rerender(<Harness rows={[rows[0]]} />);
    rerender(<Harness rows={rows} />);
    expect(screen.getByTestId("b").textContent).toBe("");
  });
});
