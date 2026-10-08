import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspacePageHeader } from "./WorkspacePageHeader.jsx";

const workspacePrimaryAction = { type: "delete", label: "Delete workspace" };

function renderHeader(props = {}) {
  return render(
    <WorkspacePageHeader
      label="Document list"
      breadcrumbs={[{ label: "Acme", href: "/workspaces/a" }, { label: "Documents" }]}
      title="Documents"
      hasApiAccess
      workspaceId="ws-1"
      workspacePrimaryAction={workspacePrimaryAction}
      updateTemplateId=""
      {...props}
    />,
  );
}

describe("WorkspacePageHeader", () => {
  it("keeps Export visible and moves Delete for the selection into the overflow menu", async () => {
    const user = userEvent.setup();
    const onDeleteDocument = vi.fn();
    const onExportDocuments = vi.fn();
    renderHeader({
      activePage: "documents",
      selectedDocumentCount: 2,
      exportableDocumentCount: 2,
      selectedDocumentId: "job-1",
      onExportDocuments,
      onDeleteDocument,
    });

    expect(screen.getByRole("button", { name: "Export 2" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete 2 documents" }));
    expect(onDeleteDocument).toHaveBeenCalledTimes(1);
  });

  it("renders the breadcrumb as links to the workspace and the current page", () => {
    renderHeader({ activePage: "documents", onDeleteDocument: () => {} });

    expect(screen.getByRole("link", { name: "Acme" }).getAttribute("href")).toBe("/workspaces/a");
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText("Documents").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("banner", { name: "Document list" })).toBeTruthy();
  });

  it("puts View JSON and Delete template in the overflow menu on the Templates page", async () => {
    const user = userEvent.setup();
    const onOpenJsonModal = vi.fn();
    const onDeleteTemplate = vi.fn();
    renderHeader({
      activePage: "templates",
      title: "Invoice",
      updateTemplateId: "tpl-1",
      onOpenJsonModal,
      onDeleteTemplate,
      onCreateTemplate: () => {},
      onAutoGenerateTemplate: () => {},
    });

    expect(screen.queryByRole("button", { name: "View JSON" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "More actions" }));

    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "View JSON",
      "Delete template",
    ]);
    await user.click(within(menu).getByRole("menuitem", { name: "View JSON" }));
    expect(onOpenJsonModal).toHaveBeenCalledTimes(1);
  });

  it("keeps Costs visible and moves Delete workspace to the overflow menu", async () => {
    const user = userEvent.setup();
    const onWorkspacePrimaryAction = vi.fn();
    renderHeader({
      activePage: "workspace",
      title: "Acme",
      onViewCosts: () => {},
      onCreateWorkspace: () => {},
      onWorkspacePrimaryAction,
    });

    expect(screen.getByRole("button", { name: "Costs" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete workspace" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete workspace" }));
    expect(onWorkspacePrimaryAction).toHaveBeenCalledTimes(1);
  });
});
