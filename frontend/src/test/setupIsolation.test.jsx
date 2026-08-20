import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const isolationMock = vi.fn();

test("deliberately leaves browser and Vitest state for the shared boundary", () => {
  render(<div>isolation leak marker</div>);
  window.localStorage.setItem("isolation-local", "leaked");
  window.sessionStorage.setItem("isolation-session", "leaked");
  vi.useFakeTimers();
  window.setTimeout(() => {}, 60_000);
  vi.stubGlobal("__frontendIsolationProbe", "leaked");
  vi.spyOn(console, "info").mockImplementation(() => {});
  isolationMock();

  expect(screen.getByText("isolation leak marker")).toBeTruthy();
});

test("observes a clean browser and Vitest boundary", () => {
  expect(screen.queryByText("isolation leak marker")).toBeNull();
  expect(window.localStorage.getItem("isolation-local")).toBeNull();
  expect(window.sessionStorage.getItem("isolation-session")).toBeNull();
  expect(vi.isFakeTimers()).toBe(false);
  expect("__frontendIsolationProbe" in globalThis).toBe(false);
  expect(vi.isMockFunction(console.info)).toBe(false);
  expect(isolationMock).not.toHaveBeenCalled();
});
