import React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MainLayout } from "./MainLayout.jsx";

function renderLayout() {
  return render(
    <MainLayout
      activePage="documents"
      counts={{ workspace: 2, templates: 3, documents: 4 }}
      onNavigate={() => {}}
      onUploadDocument={() => {}}
      profileSlot={null}
      contextSidebar={null}
    >
      <input aria-label="Page field" />
    </MainLayout>,
  );
}

describe("MainLayout sidebar collapse", () => {
  it("collapses to the icon rail, keeps labelled controls, and remembers the choice", () => {
    const { container, unmount } = renderLayout();
    const frame = container.querySelector(".app-frame");
    expect(frame.classList.contains("sidebar-collapsed")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(frame.classList.contains("sidebar-collapsed")).toBe(true);
    expect(screen.getByRole("button", { name: "Expand sidebar" }).getAttribute("aria-expanded")).toBe("false");
    // Labels become hover tips in the rail but still name each control.
    expect(screen.getByRole("button", { name: /Documents/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload Document" })).toBeTruthy();
    expect(window.localStorage.getItem("studio.sidebarCollapsed")).toBe("true");

    unmount();
    const { container: remounted } = renderLayout();
    expect(remounted.querySelector(".app-frame").classList.contains("sidebar-collapsed")).toBe(true);
  });

  it("toggles with the [ shortcut, except while typing", () => {
    const { container } = renderLayout();
    const frame = container.querySelector(".app-frame");

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Page field" }), { key: "[" });
    expect(frame.classList.contains("sidebar-collapsed")).toBe(false);

    fireEvent.keyDown(document.body, { key: "[" });
    expect(frame.classList.contains("sidebar-collapsed")).toBe(true);
    fireEvent.keyDown(document.body, { key: "[" });
    expect(frame.classList.contains("sidebar-collapsed")).toBe(false);
  });
});
