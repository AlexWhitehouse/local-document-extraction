import React from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { DocumentContextList } from "../documents/DocumentContextList.jsx";
import { TemplateContextList } from "../templates/TemplateContextList.jsx";
import { WorkspaceContextList } from "../workspaces/WorkspaceContextList.jsx";

const styles = readFileSync("src/styles.css", "utf8");

describe("context card layouts", () => {
  it("adds a selection column to Extraction jobs without narrowing Workspace cards", () => {
    const style = document.createElement("style");
    style.textContent = styles;
    document.head.append(style);

    try {
      const { container } = render(
        <>
          <WorkspaceContextList
            search=""
            workspaces={[
              {
                id: "workspace_1",
                name: "Research Workspace",
                type: "accepted",
              },
            ]}
            selectedWorkspaceId="workspace_1"
            selectedWorkspaceInvitationId=""
            isLoading={false}
            hasResolutionError={false}
            onSearchChange={vi.fn()}
            onSelectAcceptedWorkspace={vi.fn()}
            onSelectInvitedWorkspace={vi.fn()}
            onRetryResolution={vi.fn()}
          />
          <TemplateContextList
            search=""
            templates={[
              {
                id: "template_1",
                name: "Invoice Template",
                is_draft: false,
              },
            ]}
            selectedTemplateId="template_1"
            isEditingTemplate={false}
            onSearchChange={vi.fn()}
            onSelectDraftTemplate={vi.fn()}
            onSelectTemplate={vi.fn()}
          />
          <DocumentContextList
            search=""
            documents={[
              {
                job_id: "job_1",
                source_name: "invoice.pdf",
                source_mime_type: "application/pdf",
              },
            ]}
            selectedDocumentId="job_1"
            selectedDocumentIds={[]}
            debouncedSearch=""
            hasMoreDocuments={false}
            isLoadingMoreDocuments={false}
            onSearchChange={vi.fn()}
            onSelectDocument={vi.fn()}
            onToggleDocumentSelection={vi.fn()}
            onLoadMoreDocuments={vi.fn()}
          />
        </>,
      );

      const workspaceCard = container.querySelector(".context-item-workspace");
      const templateCard = container.querySelector(
        ".context-item-card:not(.context-item-workspace):not(.context-item-document)",
      );
      const documentSearchRow = container.querySelector(".context-search-row");
      const workspaceSearchInput = container.querySelector(
        'input[placeholder="Workspace name or ID"]',
      );
      const documentSearchInput = container.querySelector("#document-job-search");
      const selectAllControl = container.querySelector(
        ".context-select-all-control",
      );
      const documentCard = container.querySelector(".context-item-document");

      expect(getComputedStyle(workspaceCard).gridTemplateColumns).toBe(
        "minmax(0, 1fr) 36px",
      );
      expect(getComputedStyle(templateCard).gridTemplateColumns).toBe(
        "minmax(0, 1fr) 36px",
      );
      expect(getComputedStyle(documentSearchRow).gridTemplateColumns).toBe(
        "36px minmax(0, 1fr)",
      );
      expect(getComputedStyle(documentSearchInput).height).toBe("34px");
      expect(getComputedStyle(selectAllControl).height).toBe("34px");
      for (const property of [
        "fontFamily",
        "fontSize",
        "fontStyle",
        "fontWeight",
        "letterSpacing",
      ]) {
        expect(getComputedStyle(documentSearchInput)[property]).toBe(
          getComputedStyle(workspaceSearchInput)[property],
        );
      }
      expect(getComputedStyle(documentCard).gridTemplateColumns).toBe(
        "36px minmax(0, 1fr) 36px",
      );
    } finally {
      style.remove();
    }
  });
});
