import React from "react";
import { PageHeader } from "../ui/PageHeader.jsx";
import { CreateTemplateSplitButton } from "../templates/CreateTemplateSplitButton.jsx";

// The header for the Workspace, Templates and Documents pages. Routine actions stay visible;
// destructive and rare actions go in the overflow menu.
export function WorkspacePageHeader({
  activePage,
  breadcrumbs,
  label,
  title,
  description,
  isWorkspaceInvitationSelected,
  hasApiAccess,
  workspaceId,
  workspacePrimaryAction,
  isDeletingWorkspace,
  isCreatingWorkspace = false,
  isDeletingTemplate,
  isDeletingDocument,
  isExportingDocuments = false,
  selectedDocumentId,
  selectedDocumentCount = 0,
  exportableDocumentCount = 0,
  updateTemplateId,
  onCreateTemplate,
  onAutoGenerateTemplate,
  onCreateWorkspace,
  onViewCosts,
  onExportDocuments,
  onWorkspacePrimaryAction,
  onDeleteTemplate,
  onOpenJsonModal,
  onDeleteDocument,
  canDownloadOriginal = false,
  isDownloadingOriginal = false,
  onDownloadOriginal,
}) {
  const exportHint =
    exportableDocumentCount === 0
      ? "Select a completed or failed document to export"
      : selectedDocumentCount > exportableDocumentCount
        ? `${exportableDocumentCount} of ${selectedDocumentCount} selected documents are ready to export. In-progress documents will be skipped.`
        : undefined;

  let actions;
  let compactActions = [];
  let overflowActions = [];

  // Simple buttons go in compactActions: they stay inline above 600px and join the overflow menu below it.
  if (activePage === "documents") {
    compactActions = [
      canDownloadOriginal
        ? {
            key: "download-original",
            label: isDownloadingOriginal ? "Downloading…" : "Download",
            disabled: !hasApiAccess || isDownloadingOriginal,
            onSelect: onDownloadOriginal,
          }
        : null,
      {
        key: "export-documents",
        label: isExportingDocuments ? "Exporting…" : selectedDocumentCount ? `Export ${selectedDocumentCount}` : "Export",
        disabled: !hasApiAccess || isDeletingDocument || isExportingDocuments || exportableDocumentCount === 0,
        title: exportHint,
        onSelect: onExportDocuments,
      },
    ];
    overflowActions = [
      {
        key: "delete-documents",
        label: isDeletingDocument
          ? "Deleting…"
          : selectedDocumentCount > 1
            ? `Delete ${selectedDocumentCount} documents`
            : "Delete document",
        danger: true,
        disabled:
          !hasApiAccess || isExportingDocuments || isDeletingDocument || (!selectedDocumentCount && !selectedDocumentId),
        onSelect: onDeleteDocument,
      },
    ];
  } else if (activePage === "templates") {
    actions = <CreateTemplateSplitButton disabled={!hasApiAccess} onCreate={onCreateTemplate} onAutoGenerate={onAutoGenerateTemplate} />;
    overflowActions = [
      {
        key: "view-json",
        label: "View JSON",
        disabled: isDeletingTemplate || !hasApiAccess,
        onSelect: onOpenJsonModal,
      },
      {
        key: "delete-template",
        label: isDeletingTemplate ? "Deleting…" : "Delete template",
        danger: true,
        disabled: isDeletingTemplate || !hasApiAccess || !updateTemplateId.trim(),
        onSelect: onDeleteTemplate,
      },
    ];
  } else {
    compactActions = [
      onViewCosts ? { key: "view-costs", label: "Costs", onSelect: onViewCosts } : null,
      {
        key: "create-workspace",
        label: isCreatingWorkspace ? "Creating…" : "Create workspace",
        disabled: isCreatingWorkspace,
        onSelect: onCreateWorkspace,
        "data-tour": "create-workspace",
      },
    ];

    if (!isWorkspaceInvitationSelected) {
      const isLeaving = workspacePrimaryAction.type === "leave";

      overflowActions = [
        {
          key: "workspace-primary",
          label: isDeletingWorkspace
            ? isLeaving
              ? "Leaving…"
              : "Deleting…"
            : workspacePrimaryAction.label || "Delete workspace",
          danger: true,
          disabled:
            isDeletingWorkspace || !hasApiAccess || !workspaceId.trim() || workspacePrimaryAction.type === "none",
          onSelect: onWorkspacePrimaryAction,
        },
      ];
    }
  }

  return (
    <PageHeader
      label={label}
      breadcrumbs={breadcrumbs}
      title={title}
      description={description}
      actions={actions}
      compactActions={compactActions}
      overflowActions={overflowActions}
    />
  );
}
