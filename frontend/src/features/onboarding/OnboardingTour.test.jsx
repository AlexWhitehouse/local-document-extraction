import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingTour } from "./OnboardingTour.jsx";
import { TourSpotlight } from "./TourSpotlight.jsx";
import { canContinueTour } from "./tourSteps.js";

function props(overrides = {}) {
  return {
    userId: "first-user", ready: true, workspaceId: "original", busy: false,
    workspace: { workspaceName: "Workspace", isWorkspaceNameDirty: false },
    template: { templateFields: [] }, model: { ready: false },
    upload: { sourceFiles: [], onClose: vi.fn() },
    onStart: vi.fn(), onActiveChange: vi.fn(), ...overrides,
  };
}

describe("first-use tour", () => {
  it("waits for workspace resolution and remembers dismissal separately for each account", () => {
    const { rerender } = render(<OnboardingTour {...props({ ready: false })} />);
    expect(screen.queryByText("New to Studio?")).toBeNull();
    rerender(<OnboardingTour {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    rerender(<OnboardingTour key="remount" {...props()} />);
    expect(screen.queryByText("New to Studio?")).toBeNull();
    rerender(<OnboardingTour key="second-user" {...props({ userId: "second-user" })} />);
    expect(screen.getByText("New to Studio?")).toBeTruthy();
  });

  it("supports unavailable local storage and restores interaction on Escape", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const options = props();
    render(<OnboardingTour {...options} />);
    fireEvent.click(screen.getByRole("button", { name: /Take a tour/ }));
    expect(screen.getByRole("dialog").textContent).toContain("A space for your documents");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(options.onActiveChange).toHaveBeenLastCalledWith(false);
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("does not advance on a failed or pending workspace creation", async () => {
    const options = props();
    const { rerender } = render(<OnboardingTour {...options} />);
    fireEvent.click(screen.getByRole("button", { name: /Take a tour/ }));
    rerender(<OnboardingTour {...options} busy />);
    expect(screen.getByRole("dialog").textContent).toContain("A space for your documents");
    rerender(<OnboardingTour {...options} />);
    expect(screen.getByRole("dialog").textContent).toContain("A space for your documents");
    rerender(<OnboardingTour {...options} workspaceId="created" busy />);
    expect(screen.getByRole("dialog").textContent).toContain("A space for your documents");
    rerender(<OnboardingTour {...options} workspaceId="created" />);
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("Make it yours"));
  });

  it("blocks unrelated clicks and focus, including controls in other portals", () => {
    const intended = vi.fn();
    const unrelated = vi.fn();
    const step = { id: "test-target", title: "Try this", text: "Only this button." };
    const { unmount } = render(<>
      <button data-tour="test-target" onClick={intended}>Target</button>
      <button onClick={unrelated}>Unrelated</button>
      <TourSpotlight step={step} index={0} total={1} onExit={vi.fn()} />
    </>);
    fireEvent.click(screen.getByText("Unrelated"));
    expect(unrelated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Target"));
    expect(intended).toHaveBeenCalledOnce();
    fireEvent.focusIn(screen.getByText("Unrelated"));
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    const portal = document.createElement("button");
    document.body.append(portal);
    portal.addEventListener("click", unrelated);
    fireEvent.click(portal);
    expect(unrelated).not.toHaveBeenCalled();
    unmount();
    expect(document.querySelector("[inert]")).toBeNull();
    portal.remove();
  });

  it("requires a valid object schema, ready model and selected files", () => {
    const state = props({ template: {
      templateName: "Invoice", templateDescription: "", templateFields: [
        { name: "Invoice Number", data_type: "string", description: "The identifier" },
        { name: "Line Items", data_type: "array<object>", description: "Every item", object_schema: { columns: [] } },
      ],
    } });
    expect(canContinueTour("schema", state)).toBe(false);
    state.template.templateFields[1].object_schema.columns.push({ heading: "Item", data_type: "string", description: "Item name" });
    expect(canContinueTour("schema", state)).toBe(true);
    state.template.templateFields[1].object_schema.columns.push({ heading: "Item", data_type: "string", description: "Duplicate" });
    expect(canContinueTour("schema", state)).toBe(false);
    expect(canContinueTour("model", state)).toBe(false);
    expect(canContinueTour("files", state)).toBe(false);
    state.model.ready = true;
    state.upload.sourceFiles = [{ queueStatus: "pending" }];
    expect(canContinueTour("model", state)).toBe(true);
    expect(canContinueTour("files", state)).toBe(true);
  });
});
