import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MainLayout } from "./MainLayout.jsx";
import { PageHeader } from "../ui/PageHeader.jsx";
import { ContextSidebar } from "../context/ContextSidebar.jsx";

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
    expect(screen.getByRole("button", { name: "Upload documents" })).toBeTruthy();
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

describe("MainLayout upload and connectivity", () => {
  function renderWith(props = {}) {
    const onNavigate = vi.fn();
    const onUploadDocument = vi.fn();

    const utils = render(
      <MainLayout
        activePage="documents"
        counts={{}}
        onNavigate={onNavigate}
        onUploadDocument={onUploadDocument}
        profileSlot={null}
        contextSidebar={null}
        {...props}
      >
        <p>Page</p>
      </MainLayout>,
    );

    return { ...utils, onNavigate, onUploadDocument };
  }

  it("navigates to the Workspace page instead of opening the upload modal when no Model gateway is set up", () => {
    const { onNavigate, onUploadDocument } = renderWith({ isModelSetupRequired: true });
    const button = screen.getByRole("button", { name: "Upload documents" });

    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("title")).toBe("Set up a Model gateway on the Workspace page to upload");

    fireEvent.click(button);
    expect(onNavigate).toHaveBeenCalledWith("workspace");
    expect(onUploadDocument).not.toHaveBeenCalled();
  });

  it("opens the upload modal when the Model gateway is ready", () => {
    const { onNavigate, onUploadDocument } = renderWith();

    fireEvent.click(screen.getByRole("button", { name: "Upload documents" }));
    expect(onUploadDocument).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("shows the paused live-updates banner until the socket reconnects", () => {
    const { rerender } = renderWith({ liveUpdatesPaused: true });

    expect(screen.getByRole("status").textContent).toBe("Live updates paused, reconnecting…");

    rerender(
      <MainLayout activePage="documents" counts={{}} onNavigate={() => {}} onUploadDocument={() => {}} profileSlot={null} contextSidebar={null}>
        <p>Page</p>
      </MainLayout>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows an offline banner from the browser's network events and clears it when back online", () => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, "onLine");
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });

    try {
      renderWith();
      expect(screen.getByRole("status").textContent).toBe("You're offline");

      Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => true });
      fireEvent(window, new Event("online"));
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      if (original) Object.defineProperty(window.navigator, "onLine", original);
      else delete window.navigator.onLine;
    }
  });
});

describe("MainLayout icon navigation", () => {
  it("names each nav item with its label and icon", () => {
    const { container } = render(
      <MainLayout activePage="documents" counts={{}} onNavigate={() => {}} profileSlot={null} contextSidebar={null}>
        <p>Page</p>
      </MainLayout>,
    );

    for (const label of ["Workspaces", "Templates", "Documents", "Evaluations"]) {
      const link = screen.getByRole("button", { name: new RegExp(`^${label}`) });
      expect(link.querySelector(".sidebar-link-icon svg")).toBeTruthy();
      expect(link.getAttribute("title")).toBeNull();
    }

    expect(container.querySelector(".sidebar-link-icon")?.textContent).toBe("");
  });

  it("shows each nav label as a right-hand tooltip in the collapsed rail, and keeps the link named", () => {
    window.localStorage.setItem("studio.sidebarCollapsed", "true");

    render(
      <MainLayout activePage="documents" counts={{}} onNavigate={() => {}} profileSlot={null} contextSidebar={null}>
        <p>Page</p>
      </MainLayout>,
    );

    const link = screen.getByRole("button", { name: "Templates" });
    const tooltip = link.closest(".ui-tooltip-anchor").querySelector('[role="tooltip"]');

    expect(tooltip.textContent).toBe("Templates");
    expect(tooltip.className).toContain("ui-tooltip-right");
    expect(screen.getByRole("button", { name: "Upload documents" })).toBeTruthy();
  });

  it("marks only the active sidebar link with aria-current=page", () => {
    render(
      <MainLayout activePage="templates" counts={{}} onNavigate={() => {}} profileSlot={null} contextSidebar={null}>
        <p>Page</p>
      </MainLayout>,
    );

    expect(screen.getByRole("button", { name: /^Templates/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: /^Documents/ }).getAttribute("aria-current")).toBeNull();
  });

  it("gives the collapse toggle a shortcut tooltip and a plain accessible name", () => {
    render(
      <MainLayout activePage="documents" counts={{}} onNavigate={() => {}} profileSlot={null} contextSidebar={null}>
        <p>Page</p>
      </MainLayout>,
    );

    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle.getAttribute("title")).toBe("Collapse sidebar ([)");
  });
});

describe("context list drawer below 1120px", () => {
  function renderWithDrawer() {
    const onSelect = vi.fn();

    render(
      <MainLayout
        activePage="templates"
        counts={{}}
        onNavigate={() => {}}
        profileSlot={null}
        contextListLabel="Templates"
        contextSidebar={
          <ContextSidebar title="Templates">
            <input aria-label="Search templates" />
            <button type="button" data-context-select onClick={onSelect}>
              Invoice template
            </button>
          </ContextSidebar>
        }
      >
        <PageHeader title="Templates" />
      </MainLayout>,
    );

    return { onSelect, toggle: screen.getByRole("button", { name: "Show templates list" }) };
  }

  const drawer = () => document.querySelector(".context-sidebar");

  it("opens from the page header with focus in the list, and closes on Escape with focus back on the toggle", () => {
    const { toggle } = renderWithDrawer();
    expect(drawer().classList.contains("is-open")).toBe(false);

    toggle.focus();
    fireEvent.click(toggle);

    expect(drawer().classList.contains("is-open")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("Search templates"));

    fireEvent.keyDown(document.activeElement, { key: "Escape" });

    expect(drawer().classList.contains("is-open")).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });

  it("closes from the backdrop", () => {
    const { toggle } = renderWithDrawer();

    fireEvent.click(toggle);
    fireEvent.click(document.querySelector(".context-drawer-scrim"));

    expect(drawer().classList.contains("is-open")).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });

  it("closes after a row is picked", () => {
    const { onSelect, toggle } = renderWithDrawer();

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Invoice template" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(drawer().classList.contains("is-open")).toBe(false);
  });
});
