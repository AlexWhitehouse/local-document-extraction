import React, { useCallback, useEffect, useRef, useState } from "react";
import { MagicIcon } from "../templates/MagicIcon.jsx";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "studio.sidebarCollapsed";

const SIDEBAR_ITEMS = [
  { id: "workspace", label: "Workspaces", icon: "WS" },
  { id: "templates", label: "Templates", icon: "TP" },
  { id: "documents", label: "Documents", icon: "DC" },
  { id: "evaluations", label: "Evaluations", icon: "EV" },
];

const ADMIN_SIDEBAR_ITEM = { id: "admin", label: "Admin", icon: "AD" };

export function MainLayout({
  activePage,
  contentClassName = "",
  contentSelection = "",
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
  const [isSidebarCollapsed, toggleSidebar] = useSidebarCollapsed();
  const collapseLabel = isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
  const mainRef = useRef(null);
  useContentFade(mainRef, activePage, contentSelection);

  return (
    <div className={isSidebarCollapsed ? "app-frame sidebar-collapsed" : "app-frame"}>
      <aside className="left-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-text">
            <p className="eyebrow">Document Extraction</p>
            <h1>Studio</h1>
          </div>
          <span className="sidebar-brand-mark" aria-hidden="true">DX</span>
          <button
            type="button"
            className="sidebar-collapse-toggle"
            aria-label={collapseLabel}
            aria-expanded={!isSidebarCollapsed}
            title={`${collapseLabel} ([)`}
            onClick={toggleSidebar}
          >
            <SidebarToggleIcon collapsed={isSidebarCollapsed} />
          </button>
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
          data-tour="upload-open"
          aria-disabled={uploadAriaDisabled}
          disabled={isUploadDisabled}
          onClick={onUploadDocument}
        >
          <span className="sidebar-upload-icon" aria-hidden="true">+</span>
          <span className="sidebar-upload-label">Upload Document</span>
        </button>

        <div className="sidebar-spacer" aria-hidden="true" />

        <div className="sidebar-footer">{profileSlot}</div>
      </aside>

      {contextSidebar}

      <main ref={mainRef} className={`main-content ${contentClassName}`}>
        {impersonationSlot}
        {children}
      </main>

      {modalSlot}
    </div>
  );
}

// Softens the content swap when moving between pages or picking a different
// item in the context list. Selecting from nothing (or saving a draft into a new
// id) is not a swap, so it does not fade.
function useContentFade(ref, page, selection) {
  const previous = useRef({ page, selection });
  useEffect(() => {
    const before = previous.current;
    previous.current = { page, selection };
    const isSwap = page !== before.page || (selection && before.selection && selection !== before.selection);
    if (!isSwap || typeof ref.current?.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    ref.current.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
  }, [ref, page, selection]);
}

// A per-browser preference: collapsing is a layout choice, not account state.
function useSidebarCollapsed() {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => setIsCollapsed((current) => !current), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isCollapsed));
    } catch {
      // Storage can be unavailable (private windows, blocked site data); the toggle still works.
    }
  }, [isCollapsed]);

  useEffect(() => {
    function toggleOnShortcut(event) {
      if (
        event.key !== "[" ||
        event.defaultPrevented ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.target.closest?.('input, textarea, select, [contenteditable], [role="dialog"]')
      ) {
        return;
      }
      event.preventDefault();
      toggle();
    }

    window.addEventListener("keydown", toggleOnShortcut);
    return () => window.removeEventListener("keydown", toggleOnShortcut);
  }, [toggle]);

  return [isCollapsed, toggle];
}

function SidebarToggleIcon({ collapsed }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M9 4v16" />
      <path d={collapsed ? "M13 10l2 2-2 2" : "M16 10l-2 2 2 2"} />
    </svg>
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
          data-tour={`nav-${item.id}`}
          type="button"
          className={
            item.id === activePage ? "sidebar-link active" : "sidebar-link"
          }
          onClick={() => onNavigate(item.id)}
        >
          <span className="sidebar-link-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="sidebar-link-label">{item.label}</span>
          {item.id === "admin" ? null : (
            <span className="sidebar-link-count">{counts[item.id] ?? ""}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

export function WorkspaceToolbar({
  actions,
  activePage,
  workspaceLabel,
  pageTitle,
  pageDescription,
  isWorkspaceInvitationSelected,
  hasApiAccess,
  workspaceId,
  workspacePrimaryAction,
  isDeletingWorkspace,
  isWorkspaceBusy = false,
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
  onExportDocuments,
  onWorkspacePrimaryAction,
  onDeleteTemplate,
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
  return (
    <header className="studio-page-heading" aria-label="Workspace toolbar">
      <p className="studio-eyebrow">
        {activePage === "workspace"
          ? "Workspaces / Overview"
          : `${workspaceLabel} / ${activePage === "templates" ? "Templates" : activePage === "evaluations" ? "Evaluations" : "Documents"}`}
      </p>
      <h1 title={pageTitle}>{pageTitle}</h1>
      <div className="studio-heading-actions">
        {actions ?? (activePage === "documents" ? (
          <>
            {canDownloadOriginal ? (
              <button
                type="button"
                className="secondary"
                disabled={!hasApiAccess || isDownloadingOriginal}
                onClick={onDownloadOriginal}
              >
                {isDownloadingOriginal ? "Downloading…" : "Download"}
              </button>
            ) : null}
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
                ? "Deleting…"
                : selectedDocumentCount
                  ? `Delete ${selectedDocumentCount}`
                  : "Delete"}
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
                ? "Exporting…"
                : selectedDocumentCount
                  ? `Export ${selectedDocumentCount}`
                  : "Export"}
            </button>
          </>
        ) : (
          <>
            {activePage === "templates" ? (
              <div className="studio-create-template-split" role="group" aria-label="Create template">
                <button type="button" className="secondary" data-tour="create-template"
                  disabled={!hasApiAccess} onClick={onCreateTemplate}>
                  Create Template
                </button>
                <button type="button" className="secondary studio-create-template-magic"
                  aria-label="Auto generate new template" title="Auto generate new template"
                  disabled={!hasApiAccess} onClick={onAutoGenerateTemplate}>
                  <MagicIcon />
                </button>
              </div>
            ) : (
              <button type="button" className="secondary" data-tour="create-workspace"
                disabled={isWorkspaceBusy} onClick={onCreateWorkspace}>
                Create Workspace
              </button>
            )}
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
                    ? "Leaving…"
                    : "Deleting…"
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
                {isDeletingTemplate ? "Deleting…" : "Delete Template"}
              </button>
            ) : null}
          </>
        ))}
      </div>
      <p className="studio-page-description">{pageDescription}</p>
    </header>
  );
}
