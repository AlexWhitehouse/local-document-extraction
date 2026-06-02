import React from "react";

const SIDEBAR_ITEMS = [
  { id: "workspace", label: "Workspaces", icon: "WS" },
  { id: "templates", label: "Templates", icon: "TP" },
  { id: "documents", label: "Documents", icon: "DC" },
];

const ADMIN_SIDEBAR_ITEM = { id: "admin", label: "Admin", icon: "AD" };

export function MainLayout({
  activePage,
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

      <main className="main-content">
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
  isWorkspaceInvitationSelected,
  hasWorkspaceApiAccess,
  billingOperationalStatus,
  documentCount,
  hasApiAccess,
  isUploadDisabled = false,
  workspaceId,
  workspacePrimaryAction,
  hasWorkspaceBillingAuthority = false,
  isWorkspaceBillingView = false,
  isDeletingWorkspace,
  isDeletingTemplate,
  isDeletingDocument,
  selectedDocumentId,
  updateTemplateId,
  onCreateTemplate,
  onCreateWorkspace,
  onUploadDocument,
  onToggleWorkspaceBillingView,
  onWorkspacePrimaryAction,
  onDeleteTemplate,
  onDeleteDocument,
}) {
  const billingBlockingReasons = Array.isArray(
    billingOperationalStatus?.blocking_reasons,
  )
    ? billingOperationalStatus.blocking_reasons
        .map((reason) => String(reason || "").trim())
        .filter(Boolean)
    : [];

  return (
    <section className="workspace-toolbar" aria-label="Workspace toolbar">
      <div className="workspace-toolbar-meta">
        <span className="status-chip">Workspace {workspaceLabel}</span>
        {isWorkspaceInvitationSelected ? (
          <>
            <span className="status-chip warn">Invitation Pending</span>
            <span className="status-chip warn">API Locked</span>
          </>
        ) : (
          <>
            <span
              className={`status-chip ${hasWorkspaceApiAccess ? "good" : "warn"}`}
            >
              API {hasWorkspaceApiAccess ? "Ready" : "Missing Access"}
            </span>
            <span className="status-chip">Jobs {documentCount}</span>
            {billingBlockingReasons.map((reason) => (
              <span key={reason} className="status-chip warn">
                {reason}
              </span>
            ))}
          </>
        )}
      </div>
      <div className="actions compact">
        {activePage === "workspace" &&
        !isWorkspaceInvitationSelected &&
        hasWorkspaceBillingAuthority ? (
          <button
            type="button"
            className="secondary"
            disabled={!String(workspaceId || "").trim()}
            onClick={onToggleWorkspaceBillingView}
          >
            {isWorkspaceBillingView ? "View Dashboard" : "View Billing"}
          </button>
        ) : null}
        <button
          type="button"
          className="secondary"
          disabled={
            activePage === "documents" && (!hasApiAccess || isUploadDisabled)
          }
          onClick={
            activePage === "templates"
              ? onCreateTemplate
              : activePage === "workspace"
                ? onCreateWorkspace
                : onUploadDocument
          }
        >
          {activePage === "templates"
            ? "Create Template"
            : activePage === "workspace"
              ? "Create Workspace"
              : "Upload Document"}
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
              : workspacePrimaryAction.label || "Workspace Action"}
          </button>
        ) : activePage === "templates" ? (
          <button
            type="button"
            className="danger"
            disabled={
              isDeletingTemplate || !hasApiAccess || !updateTemplateId.trim()
            }
            onClick={onDeleteTemplate}
          >
            {isDeletingTemplate ? "Deleting..." : "Delete Template"}
          </button>
        ) : activePage === "documents" ? (
          <button
            type="button"
            className="danger"
            disabled={isDeletingDocument || !selectedDocumentId}
            onClick={onDeleteDocument}
          >
            {isDeletingDocument ? "Deleting..." : "Delete Document"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function OperationalMetrics({
  remainingCredits,
  documentCount,
  completionRate,
  remainingPages,
}) {
  return (
    <section className="kpi-grid" aria-label="Operational metrics">
      <article className="kpi-card">
        <p className="kpi-label">Remaining Credits</p>
        <p className="kpi-value">{formatMetricValue(remainingCredits)}</p>
        <p className="kpi-meta">Available submission credits</p>
      </article>
      <article className="kpi-card">
        <p className="kpi-label">Documents</p>
        <p className="kpi-value">{documentCount}</p>
        <p className="kpi-meta">Queued and completed jobs</p>
      </article>
      <article className="kpi-card">
        <p className="kpi-label">Completion</p>
        <p className="kpi-value">{completionRate}%</p>
        <p className="kpi-meta">Completed jobs ratio</p>
        <div
          className="kpi-progress"
          role="img"
          aria-label={`Completion rate ${completionRate}%`}
        >
          <span style={{ width: `${completionRate}%` }} />
        </div>
      </article>
      <article className="kpi-card">
        <p className="kpi-label">Remaining Pages</p>
        <p className="kpi-value">{formatMetricValue(remainingPages)}</p>
        <p className="kpi-meta">Page quota left this period</p>
      </article>
    </section>
  );
}

function formatMetricValue(value) {
  if (value === null) {
    return "Unlimited";
  }
  if (value === undefined) {
    return "...";
  }
  return Number(value).toLocaleString("en-GB");
}
