import React from "react";

const SIDEBAR_ITEMS = [
  { id: "workspace", label: "Workspaces", icon: "WS" },
  { id: "templates", label: "Templates", icon: "TP" },
  { id: "documents", label: "Documents", icon: "DC" },
];

const ADMIN_SIDEBAR_ITEM = { id: "admin", label: "Admin", icon: "AD" };

export function MainLayout({
  activePage,
  contentClassName = "",
  counts,
  uploadAriaDisabled,
  isUploadDisabled,
  onNavigate,
  onUploadDocument,
  profileSlot,
  contextSidebar,
  showAdminNavigation = false,
  impersonationSlot = null,
  children,
  modalSlot,
}) {
  return (
    <div className="app-frame">
      <aside className="left-sidebar">
        <div className="sidebar-brand">
          <p className="eyebrow">Document Extraction</p>
          <h1>Studio</h1>
        </div>

        <SidebarNavigation
          activePage={activePage}
          counts={counts}
          showAdminNavigation={showAdminNavigation}
          onNavigate={onNavigate}
        />

        <button
          type="button"
          className="sidebar-upload-button"
          aria-disabled={uploadAriaDisabled}
          disabled={isUploadDisabled}
          onClick={onUploadDocument}
        >
          Upload Document
        </button>

        <div className="sidebar-spacer" aria-hidden="true" />

        <div className="sidebar-footer">{profileSlot}</div>
      </aside>

      {contextSidebar}

      <main className={`main-content ${contentClassName}`}>
        {impersonationSlot}
        {children}
      </main>

      {modalSlot}
    </div>
  );
}

function SidebarNavigation({
  activePage,
  counts,
  showAdminNavigation,
  onNavigate,
}) {
  const items = [
    ...SIDEBAR_ITEMS,
    ...(showAdminNavigation ? [ADMIN_SIDEBAR_ITEM] : []),
  ];

  return (
    <nav className="sidebar-nav" aria-label="Main navigation">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={
            item.id === activePage ? "sidebar-link active" : "sidebar-link"
          }
          onClick={() => onNavigate(item.id)}
        >
          <span className="sidebar-link-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span>{item.label}</span>
          {item.id === "admin" ? null : (
            <span className="sidebar-link-count">{counts[item.id] ?? ""}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

export function WorkspaceToolbar({
  activePage,
  workspaceLabel,
  pageTitle,
  pageDescription,
  isWorkspaceInvitationSelected,
  hasApiAccess,
  isUploadDisabled = false,
  workspaceId,
  workspacePrimaryAction,
  isDeletingWorkspace,
  isDeletingTemplate,
  isDeletingDocument,
  isExportingDocuments = false,
  selectedDocumentId,
  selectedDocumentCount = 0,
  exportableDocumentCount = 0,
  updateTemplateId,
  onCreateTemplate,
  onCreateWorkspace,
  onExportDocuments,
  onUploadDocument,
  onWorkspacePrimaryAction,
  onDeleteTemplate,
  onDeleteDocument,
}) {
  const exportHint =
    exportableDocumentCount === 0
      ? "Select a completed or failed document to export"
      : selectedDocumentCount > exportableDocumentCount
        ? `${exportableDocumentCount} of ${selectedDocumentCount} selected documents are ready to export. In-progress documents will be skipped.`
        : undefined;
  return (
    <header className="studio-page-heading" aria-label="Workspace toolbar">
      <p className="studio-eyebrow">
        {activePage === "workspace"
          ? "Workspaces / Overview"
          : `${workspaceLabel} / ${activePage === "templates" ? "Templates" : "Documents"}`}
      </p>
      <h1 title={pageTitle}>{pageTitle}</h1>
      <div className="studio-heading-actions">
        {activePage === "documents" ? (
          <>
            <button
              type="button"
              className="danger"
              disabled={
                !hasApiAccess ||
                isDeletingDocument ||
                isExportingDocuments ||
                (!selectedDocumentCount && !selectedDocumentId)
              }
              onClick={onDeleteDocument}
            >
              {isDeletingDocument
                ? "Deleting..."
                : selectedDocumentCount
                  ? `Delete ${selectedDocumentCount}`
                  : "Delete"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!hasApiAccess || isUploadDisabled}
              onClick={onUploadDocument}
            >
              Upload
            </button>
            <button
              type="button"
              disabled={
                !hasApiAccess ||
                isDeletingDocument ||
                isExportingDocuments ||
                exportableDocumentCount === 0
              }
              onClick={onExportDocuments}
              title={exportHint}
            >
              {isExportingDocuments
                ? "Exporting..."
                : selectedDocumentCount
                  ? `Export ${selectedDocumentCount}`
                  : "Export"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="secondary"
              disabled={activePage === "templates" && !hasApiAccess}
              onClick={
                activePage === "templates"
                  ? onCreateTemplate
                  : onCreateWorkspace
              }
            >
              {activePage === "templates"
                ? "Create Template"
                : "Create Workspace"}
            </button>
            {activePage === "workspace" && !isWorkspaceInvitationSelected ? (
              <button
                type="button"
                className="danger"
                disabled={
                  isDeletingWorkspace ||
                  !hasApiAccess ||
                  !workspaceId.trim() ||
                  workspacePrimaryAction.type === "none"
                }
                onClick={onWorkspacePrimaryAction}
              >
                {isDeletingWorkspace
                  ? workspacePrimaryAction.type === "leave"
                    ? "Leaving..."
                    : "Deleting..."
                  : workspacePrimaryAction.label || "Delete Workspace"}
              </button>
            ) : activePage === "templates" ? (
              <button
                type="button"
                className="danger"
                disabled={
                  isDeletingTemplate ||
                  !hasApiAccess ||
                  !updateTemplateId.trim()
                }
                onClick={onDeleteTemplate}
              >
                {isDeletingTemplate ? "Deleting..." : "Delete Template"}
              </button>
            ) : null}
          </>
        )}
      </div>
      <p className="studio-page-description">{pageDescription}</p>
    </header>
  );
}
