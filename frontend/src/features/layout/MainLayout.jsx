import React, { useCallback, useEffect, useRef, useState } from "react";
import { CreateTemplateSplitButton } from "../templates/CreateTemplateSplitButton.jsx";
import { NavigationLink } from "../context/NavigationLink.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import {
  AdminIcon,
  DocumentIcon,
  EvaluationIcon,
  SidebarIcon,
  TemplateIcon,
  UploadIcon,
  WorkspaceIcon,
} from "./Icons.jsx";
import "./ConnectivityBanner.css";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "studio.sidebarCollapsed";

const MODEL_SETUP_MESSAGE = "Set up a Model gateway on the Workspace page to upload";

const SIDEBAR_ITEMS = [
  { id: "workspace", label: "Workspaces", icon: WorkspaceIcon },
  { id: "templates", label: "Templates", icon: TemplateIcon },
  { id: "documents", label: "Documents", icon: DocumentIcon },
  { id: "evaluations", label: "Evaluations", icon: EvaluationIcon },
];

const ADMIN_SIDEBAR_ITEM = { id: "admin", label: "Admin", icon: AdminIcon };

export function MainLayout({
  activePage,
  contentClassName = "",
  contentSelection = "",
  counts,
  isUploadDisabled,
  isModelSetupRequired = false,
  liveUpdatesPaused = false,
  onNavigate,
  navigationHref,
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
  const isOnline = useOnlineStatus();

  const connectivityMessage = !isOnline
    ? "You're offline"
    : liveUpdatesPaused
      ? "Live updates paused, reconnecting…"
      : "";

  return (
    <div className={isSidebarCollapsed ? "app-frame sidebar-collapsed" : "app-frame"}>
      <aside className="left-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-text">
            <p className="eyebrow">Document Extraction</p>
            <h1>Studio</h1>
          </div>
          <span className="sidebar-brand-mark" aria-hidden="true">
            DX
          </span>
          <IconButton
            label={collapseLabel}
            title={`${collapseLabel} ([)`}
            icon={SidebarIcon}
            size="sm"
            className="sidebar-collapse-toggle"
            aria-expanded={!isSidebarCollapsed}
            onClick={toggleSidebar}
          />
        </div>

        <SidebarNavigation
          activePage={activePage}
          counts={counts}
          showAdminNavigation={showAdminNavigation}
          onNavigate={onNavigate}
          navigationHref={navigationHref}
        />

        <button
          type="button"
          className="sidebar-upload-button"
          data-tour="upload-open"
          aria-disabled={isModelSetupRequired ? "true" : undefined}
          title={isModelSetupRequired ? MODEL_SETUP_MESSAGE : undefined}
          disabled={isUploadDisabled}
          onClick={isModelSetupRequired ? () => onNavigate("workspace") : onUploadDocument}
        >
          <span className="sidebar-upload-icon" aria-hidden="true">
            <UploadIcon />
          </span>
          <span className="sidebar-upload-label">Upload documents</span>
        </button>

        <div className="sidebar-spacer" aria-hidden="true" />

        <div className="sidebar-footer">{profileSlot}</div>
      </aside>

      {contextSidebar}

      <main ref={mainRef} className={`main-content ${contentClassName}`}>
        {connectivityMessage ? (
          <div role="status" className="connectivity-banner">
            {connectivityMessage}
          </div>
        ) : null}
        {impersonationSlot}
        {children}
      </main>

      {modalSlot}
    </div>
  );
}

// Tracks the browser's network state; the banner clears as soon as the browser reports it back.
function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine !== false);

    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return isOnline;
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

    if (!isSwap || !ref.current?.animate) return;

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

function SidebarNavigation({ activePage, counts, showAdminNavigation, onNavigate, navigationHref }) {
  const items = [...SIDEBAR_ITEMS, ...(showAdminNavigation ? [ADMIN_SIDEBAR_ITEM] : [])];

  return (
    <nav className="sidebar-nav" aria-label="Main navigation">
      {items.map((item) => {
        const ItemIcon = item.icon;

        // The label doubles as the tooltip when the rail is collapsed, and it names the link.
        return (
          <NavigationLink
            key={item.id}
            data-tour={`nav-${item.id}`}
            href={navigationHref?.(item.id)}
            className={item.id === activePage ? "sidebar-link active" : "sidebar-link"}
            title={item.label}
            onClick={() => onNavigate(item.id)}
          >
            <span className="sidebar-link-icon" aria-hidden="true">
              <ItemIcon />
            </span>
          <span className="sidebar-link-label">{item.label}</span>
            {item.id === "admin" ? null : <span className="sidebar-link-count">{counts[item.id] ?? ""}</span>}
          </NavigationLink>
        );
      })}
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

  return (
    <header className="studio-page-heading" aria-label="Workspace toolbar">
      <p className="studio-eyebrow">
        {activePage === "workspace"
          ? "Workspaces / Overview"
          : `${workspaceLabel} / ${activePage === "templates" ? "Templates" : activePage === "evaluations" ? "Evaluations" : "Documents"}`}
      </p>
      <h1 title={pageTitle}>{pageTitle}</h1>
      <div className="studio-heading-actions">
        {actions ??
          (activePage === "documents" ? (
            <>
              {canDownloadOriginal ? (
                <Button
                  variant="secondary"
                  disabled={!hasApiAccess}
                  pending={isDownloadingOriginal}
                  pendingLabel="Downloading…"
                  onClick={onDownloadOriginal}
                >
                  Download
                </Button>
              ) : null}
              <Button
                variant="secondary"
                disabled={!hasApiAccess || isDeletingDocument || exportableDocumentCount === 0}
                pending={isExportingDocuments}
                pendingLabel="Exporting…"
                title={exportHint}
                onClick={onExportDocuments}
              >
                {selectedDocumentCount ? `Export ${selectedDocumentCount}` : "Export"}
              </Button>
              <Button
                variant="danger"
                disabled={!hasApiAccess || isExportingDocuments || (!selectedDocumentCount && !selectedDocumentId)}
                pending={isDeletingDocument}
                pendingLabel="Deleting…"
                onClick={onDeleteDocument}
              >
                {selectedDocumentCount ? `Delete ${selectedDocumentCount}` : "Delete"}
              </Button>
            </>
          ) : (
            <>
              {activePage === "workspace" && onViewCosts ? (
                <Button variant="secondary" onClick={onViewCosts}>
                  Costs
                </Button>
              ) : null}
              {activePage === "templates" ? (
                <CreateTemplateSplitButton
                  disabled={!hasApiAccess}
                  onCreate={onCreateTemplate}
                  onAutoGenerate={onAutoGenerateTemplate}
                />
              ) : (
                <Button
                  variant="secondary"
                  data-tour="create-workspace"
                  pending={isCreatingWorkspace}
                  pendingLabel="Creating…"
                  onClick={onCreateWorkspace}
                >
                  Create workspace
                </Button>
              )}
              {activePage === "workspace" && !isWorkspaceInvitationSelected ? (
                <Button
                  variant="danger"
                  className="toolbar-destructive-action"
                  disabled={
                    isDeletingWorkspace ||
                    !hasApiAccess ||
                    !workspaceId.trim() ||
                    workspacePrimaryAction.type === "none"
                  }
                  pending={isDeletingWorkspace}
                  pendingLabel={workspacePrimaryAction.type === "leave" ? "Leaving…" : "Deleting…"}
                  onClick={onWorkspacePrimaryAction}
                >
                  {workspacePrimaryAction.label || "Delete workspace"}
                </Button>
              ) : activePage === "templates" ? (
                <>
                  <Button variant="ghost" disabled={isDeletingTemplate || !hasApiAccess} onClick={onOpenJsonModal}>
                    View JSON
                  </Button>
                  <Button
                    variant="danger"
                    className="toolbar-destructive-action"
                    disabled={isDeletingTemplate || !hasApiAccess || !updateTemplateId.trim()}
                    pending={isDeletingTemplate}
                    pendingLabel="Deleting…"
                    onClick={onDeleteTemplate}
                  >
                    Delete template
                  </Button>
                </>
              ) : null}
            </>
          ))}
      </div>
      <p className="studio-page-description">{pageDescription}</p>
    </header>
  );
}
