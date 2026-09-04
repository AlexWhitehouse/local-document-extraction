import React, { useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { createRuntimeAuthClient } from "./lib/authClient";
import {
  createAppRuntimeCore,
  createWorkspaceRequestLayer,
} from "./lib/appRuntime";
import { AuthScreen } from "./features/auth/AuthScreen.jsx";
import { useAuthProfileController } from "./features/auth/useAuthProfileController.js";
import { ApplicationAdminPage } from "./features/admin/ApplicationAdminPage.jsx";
import { useApplicationAdminController } from "./features/admin/useApplicationAdminController.js";
import { ProfileMenu } from "./features/profile/ProfileMenu.jsx";
import { useWorkspaceModelConfiguration } from "./features/workspaces/useWorkspaceModelConfiguration.js";
import {
  DocumentPage,
} from "./features/documents/DocumentPage.jsx";
import { ContextSidebar } from "./features/context/ContextSidebar.jsx";
import { DocumentContextList } from "./features/documents/DocumentContextList.jsx";
import { DocumentUploadModal } from "./features/documents/DocumentUploadModal.jsx";
import { createDocumentRequestAdapter } from "./features/documents/documentRequestAdapter.js";
import { useDocumentController } from "./features/documents/useDocumentController.js";
import {
  MainLayout,
  WorkspaceToolbar,
} from "./features/layout/MainLayout.jsx";
import { TemplateContextList } from "./features/templates/TemplateContextList.jsx";
import { TemplatePage } from "./features/templates/TemplatePage.jsx";
import { TemplateJsonModal } from "./features/templates/TemplateJsonModal.jsx";
import { useTemplateController } from "./features/templates/useTemplateController.js";
import { WorkspaceContextList } from "./features/workspaces/WorkspaceContextList.jsx";
import {
  AcceptedWorkspacePage,
  WorkspaceInvitationPage,
} from "./features/workspaces/WorkspacePages.jsx";
import {
  useWorkspaceController,
  workspaceUserActionLabel,
} from "./features/workspaces/useWorkspaceController.js";
import "./features/layout/StudioLayouts.css";

export function App() {
  const [resetPasswordRoute, setResetPasswordRoute] = useState(() =>
    getAccountPasswordResetRoute(window.location),
  );
  if (resetPasswordRoute) {
    return (
      <AccountPasswordResetRoute
        resetState={resetPasswordRoute}
        onResetComplete={() => setResetPasswordRoute(null)}
      />
    );
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const initialWorkspace = {};

  const [apiBase] = useState("/v1");
  const authClient = useMemo(() => createRuntimeAuthClient(apiBase), [apiBase]);
  const {
    data: session,
    isPending: isSessionPending,
    refetch: refetchSession,
  } = authClient.useSession();

  const [busy, setBusy] = useState(false);
  const [isStoppingImpersonation, setIsStoppingImpersonation] = useState(false);
  const [, setLogLines] = useState([]);
  const [, setLatestResponse] = useState(null);

  const [activePage, setActivePage] = useState(() => getInitialActivePage());

  const hasSession = Boolean(session?.user?.id);
  const sessionUserId = String(session?.user?.id || "").trim();
  const sessionUserName = String(session?.user?.name || "").trim();
  const sessionUserEmail = String(session?.user?.email || "").trim();
  const isImpersonating = Boolean(String(session?.session?.impersonatedBy || "").trim());
  const impersonatedUserLabel = sessionUserEmail || sessionUserName || "this user";
  const isApplicationAdmin = String(session?.user?.role || "").trim() === "admin";
  const adminVisiblePage = activePage === "admin" && !isApplicationAdmin ? "workspace" : activePage;
  const runtimeCore = useMemo(() => createAppRuntimeCore({
    apiBase,
    setLatestResponse,
    setLogLines,
    toast,
  }), [apiBase]);
  const {
    addLog,
    request: coreRequest,
    showActionToast,
    showDocumentUploadToast,
  } = runtimeCore;
  const workspaceController = useWorkspaceController({
    apiBase,
    coreRequest,
    addLog,
    showActionToast,
    hasSession,
    sessionUserId,
    isAppBusy: busy,
    setBusy,
    onActivePageChange: setActivePage,
    onClearWorkspaceScopedData: (options) => {
      templateController.actions.clearWorkspaceScopedTemplates();
      documentController.actions.clearWorkspaceScopedDocuments(options);
      setLatestResponse(null);
    },
  });
  const { workspaceId, hasApiAccess, isDeletingWorkspace, workspaceSelectionView } =
    workspaceController.context;
  const { request } = useMemo(() => createWorkspaceRequestLayer({
    coreRequest,
    hasSession,
    workspaceId,
    onForbiddenWorkspaceAccess:
      workspaceController.actions.recoverForbiddenWorkspaceAccess,
  }), [
    coreRequest,
    hasSession,
    workspaceController.actions.recoverForbiddenWorkspaceAccess,
    workspaceId,
  ]);
  const workspaceModel = useWorkspaceModelConfiguration({
    coreRequest, workspaceId, sessionUserId,
    role: workspaceController.context.selectedWorkspaceRole,
    enabled: hasApiAccess && !workspaceController.context.isWorkspaceInvitationSelected,
  });
  const documentRequests = useMemo(
    () => createDocumentRequestAdapter({ request }),
    [request],
  );
  const templateController = useTemplateController({
    initialWorkspace,
    request,
    addLog,
    showActionToast,
    hasApiAccess,
    workspaceId,
    activePage,
    onActivePageChange: setActivePage,
  });
  const templates = templateController.templates;
  const isEditingTemplate = templateController.templatePage.isEditingTemplate;
  const workspaceContext = workspaceController.context;
  const activeVisiblePage = adminVisiblePage;

  const documentController = useDocumentController({
    apiBase,
    initialWorkspace,
    templates,
    selectedUploadTemplateId: templateController.selectedUploadTemplateId,
    onSelectedUploadTemplateChange: templateController.setSelectedUploadTemplateId,
    documentRequests,
    addLog,
    showActionToast,
    showDocumentUploadToast,
    hasApiAccess,
    hasWorkspaceApiAccess: workspaceSelectionView.hasWorkspaceApiAccess,
    isAppBusy: busy,
    isWorkspaceDeletionInProgress: isDeletingWorkspace,
    workspaceId,
    sessionId: hasSession ? `${sessionUserId}:${session?.session?.id || ""}:${session?.session?.impersonatedBy || ""}` : "",
    setLatestResponse,
    onActivePageChange: setActivePage,
    onWorkspaceCapacityRefresh:
      workspaceController.actions.refreshSelectedWorkspaceContext,
    modelReady: workspaceModel.ready,
    onModelConfigurationInvalidation: workspaceModel.invalidate,
    onWorkspaceAccessRevalidation:
      workspaceController.actions.recoverForbiddenWorkspaceAccess,
  });
  const documentCount = documentController.toolbar.documentCount;
  const selectedDocument = documentController.documentPage.selectedDocument;
  const { documentStatusMetrics } = documentController.metrics;
  async function handleImpersonationStarted() {
    workspaceController.actions.clearSessionWorkspaceData();
    await refetchSession();
    setActivePage("workspace");
    await workspaceController.actions.listWorkspaces().catch(() => {});
  }

  async function handleStopImpersonating() {
    setIsStoppingImpersonation(true);
    try {
      documentController.actions.cancelPendingSubmissions();
      const result = await authClient.admin.stopImpersonating();
      if (result?.error) {
        throw new Error(result.error.message || "Unable to stop impersonating.");
      }
      workspaceController.actions.clearSessionWorkspaceData();
      await refetchSession();
      await workspaceController.actions.listWorkspaces().catch(() => {});
      setActivePage("admin");
      showActionToast?.("applicationUser.stopImpersonating", "success");
    } catch (error) {
      showActionToast?.("applicationUser.stopImpersonating", "failure");
    } finally {
      setIsStoppingImpersonation(false);
    }
  }

  const adminController = useApplicationAdminController({
    authClient,
    isActive: activeVisiblePage === "admin",
    sessionUserId,
    showActionToast,
    onImpersonationStarted: handleImpersonationStarted,
    onImpersonationStarting: documentController.actions.cancelPendingSubmissions,
  });
  const workspaceSidebar = workspaceController.sidebar;
  const workspaceToolbar = workspaceController.toolbar;
  const pageTitle = activeVisiblePage === "workspace"
    ? workspaceToolbar.workspaceLabel
    : activeVisiblePage === "templates"
      ? templateController.templatePage.templateName || "Create Template"
      : selectedDocument?.source_name || "Documents";
  const pageDescription = activeVisiblePage === "workspace"
    ? "Your extraction environment, connections and people."
    : activeVisiblePage === "templates"
      ? "Define what Studio should look for in each document."
      : documentController.documentPage.selectedDocumentTemplateName || "Select a document to see its extraction results.";
  const workspaceUserActionModal = workspaceController.userActionModal;
  const authProfileController = useAuthProfileController({
    authClient,
    refetchSession,
    addLog,
    hasSession,
    sessionUserName,
    sessionUserEmail,
    busy,
    setBusy,
    onClearWorkspaceScopedTemplates:
      templateController.actions.clearWorkspaceScopedTemplates,
    onClearWorkspaceScopedDocuments:
      documentController.actions.clearWorkspaceScopedDocuments,
    onClearSessionWorkspaceData: workspaceController.actions.clearSessionWorkspaceData,
    onSessionChanging: documentController.actions.cancelPendingSubmissions,
  });
  const { authScreen, profileMenu } = authProfileController;


  function handleSidebarNavigation(pageId) {
    if (pageId === "admin" && !isApplicationAdmin) {
      setActivePage("workspace");
      return;
    }

    setActivePage(pageId);
    if (pageId !== "templates") {
      return;
    }

    templateController.actions.handleTemplateNavigation();
  }

  if (isSessionPending) {
    return null;
  }

  if (!hasSession) {
    return (
      <AuthScreen {...authScreen} />
    );
  }

  return (
    <>
      <Toaster richColors />
      <MainLayout
        contentClassName={activeVisiblePage === "admin" ? "" : `studio-main studio-main-${activeVisiblePage}`}
        activePage={activeVisiblePage}
        counts={{
          workspace: workspaceContext.availableWorkspaces.length,
          templates: templates.length,
          documents: documentCount,
        }}
        uploadAriaDisabled={busy || !workspaceContext.hasWorkspaceApiAccess || !workspaceModel.ready}
        isUploadDisabled={!workspaceContext.hasWorkspaceApiAccess || !workspaceModel.ready}
        showAdminNavigation={isApplicationAdmin}
        impersonationSlot={
          isImpersonating ? (
            <div
              role="status"
              aria-label="Impersonation mode"
              className="impersonation-banner"
            >
              <strong>Impersonating {impersonatedUserLabel}</strong>
              <button
                type="button"
                className="secondary"
                disabled={isStoppingImpersonation}
                onClick={handleStopImpersonating}
              >
                {isStoppingImpersonation ? "Stopping..." : "Stop impersonating"}
              </button>
            </div>
          ) : null
        }
        onNavigate={handleSidebarNavigation}
        onUploadDocument={documentController.toolbar.onUploadDocument}
        profileSlot={
          <ProfileMenu
            ref={profileMenu.panelRef}
            {...profileMenu}
          />
        }
        contextSidebar={
          <ContextSidebar
            title={
              activePage === "documents"
                ? "Documents"
                : activePage === "templates"
                  ? "Templates"
                  : activeVisiblePage === "admin"
                    ? "Admin"
                    : "Workspaces"
            }
            footer={
              activeVisiblePage === "admin" ? null : activePage === "documents" ? (
                <>
                  {documentController.toolbar.selectedDocumentCount ? (
                    <span className="status-chip good">
                      Selected {documentController.toolbar.selectedDocumentCount}
                    </span>
                  ) : null}
                  <span className="status-chip">
                    Queued {documentStatusMetrics.queued}
                  </span>
                  <span className="status-chip good">
                    Completed {documentStatusMetrics.completed}
                  </span>
                </>
              ) : activePage === "templates" ? (
                <>
                  <span className="status-chip">Templates {templates.length}</span>
                  <span className="status-chip good">
                    {isEditingTemplate ? "Editing" : "Draft"}
                  </span>
                </>
              ) : (
                <>
                  <span className="status-chip">
                    Workspaces {workspaceContext.isWorkspaceContextLoading || workspaceContext.hasWorkspaceResolutionError ? 0 : workspaceContext.availableWorkspaces.length}
                  </span>
                  <span
                    className={`status-chip ${
                      workspaceContext.hasWorkspaceApiAccess ? "good" : "warn"
                    }`}
                  >
                    {workspaceContext.isWorkspaceContextLoading
                      ? "Loading"
                      : workspaceContext.hasWorkspaceResolutionError
                        ? "Resolution Error"
                        : workspaceContext.isWorkspaceInvitationSelected
                          ? "Invitation Pending"
                          : `API ${
                              workspaceContext.hasWorkspaceApiAccess
                                ? "Ready"
                                : "Missing"
                            }`}
                  </span>
                </>
              )
            }
          >
            {activeVisiblePage === "admin" ? (
              <AdminContextList />
            ) : activePage === "documents" ? (
              <DocumentContextList documentLabels {...documentController.contextList} />
            ) : activePage === "templates" ? (
              <TemplateContextList {...templateController.contextList} />
            ) : (
              <WorkspaceContextList {...workspaceSidebar} />
            )}
          </ContextSidebar>
        }
        modalSlot={
          <>
            {workspaceUserActionModal.target ? (
              <div
                className="modal-backdrop"
                onClick={workspaceUserActionModal.onClose}
              >
                <div
                  className="modal-card workspace-user-action-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Manage workspace user"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="workspace-head">
                    <h2>Manage User</h2>
                    <p>
                      {String(workspaceUserActionModal.target.name || "Unknown User")} -{" "}
                      {formatRoleLabel(workspaceUserActionModal.target.role)}
                    </p>
                  </div>
                  {workspaceUserActionModal.options.length ? (
                    <div className="workspace-user-action-list">
                      {workspaceUserActionModal.options.map((action) => (
                        <button
                          key={action}
                          type="button"
                          className={action === "remove_user" ? "danger" : "ghost"}
                          disabled={busy}
                          onClick={() => workspaceUserActionModal.onApplyAction(action)}
                        >
                          {workspaceUserActionLabel(action)}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No actions available for this user.</p>
                  )}
                  <div className="actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={workspaceUserActionModal.onClose}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <TemplateJsonModal
              {...templateController.jsonModal}
            />

            <DocumentUploadModal {...documentController.uploadModal} />
          </>
        }
      >
        {activeVisiblePage !== "admin" ? (
          <>
            <WorkspaceToolbar
              activePage={activeVisiblePage}
              pageTitle={pageTitle}
              pageDescription={pageDescription}
              workspaceLabel={
                workspaceToolbar.workspaceLabel
              }
              isWorkspaceInvitationSelected={workspaceContext.isWorkspaceInvitationSelected}
              hasApiAccess={hasApiAccess}
              isUploadDisabled={!workspaceContext.hasWorkspaceApiAccess}
              workspaceId={workspaceToolbar.workspaceId}
              workspacePrimaryAction={workspaceToolbar.workspacePrimaryAction}
              isDeletingWorkspace={workspaceToolbar.isDeletingWorkspace}
              isDeletingTemplate={templateController.toolbar.isDeletingTemplate}
              isDeletingDocument={documentController.toolbar.isDeletingDocument}
              isExportingDocuments={documentController.toolbar.isExportingDocuments}
              selectedDocumentId={documentController.toolbar.selectedDocumentId}
              selectedDocumentCount={
                documentController.toolbar.selectedDocumentCount
              }
              exportableDocumentCount={
                documentController.toolbar.exportableDocumentCount
              }
              updateTemplateId={templateController.toolbar.selectedTemplateId}
              onCreateTemplate={templateController.toolbar.onCreateTemplate}
              onCreateWorkspace={workspaceToolbar.onCreateWorkspace}
              onExportDocuments={documentController.toolbar.onExportDocuments}
              onUploadDocument={documentController.toolbar.onUploadDocument}
              onWorkspacePrimaryAction={workspaceToolbar.onWorkspacePrimaryAction}
              onDeleteTemplate={templateController.toolbar.onDeleteTemplate}
              onDeleteDocument={documentController.toolbar.onDeleteDocument}
            />
          </>
        ) : null}

          {activeVisiblePage === "admin" ? (
            <ApplicationAdminPage admin={adminController} />
          ) : null}

        {activeVisiblePage === "workspace" ? (
            workspaceContext.isWorkspaceInvitationSelected && workspaceContext.selectedWorkspaceInvitation ? (
              <WorkspaceInvitationPage
                {...workspaceController.invitationPage}
              />
            ) : (
              <AcceptedWorkspacePage
                {...workspaceController.acceptedPage}
                workspaceId={workspaceId}
                workspaceRole={workspaceContext.selectedWorkspaceRole}
                modelConfiguration={workspaceModel}
                modelConfigurationKey={`${sessionUserId}:${workspaceId}`}
              />
            )
          ) : null}

          {activeVisiblePage === "templates" ? (
            <TemplatePage {...templateController.templatePage} />
          ) : null}
          {activeVisiblePage === "documents" ? (
            <DocumentPage {...documentController.documentPage} />
          ) : null}
      </MainLayout>
    </>
  );
}

function AccountPasswordResetRoute({ resetState, onResetComplete }) {
  const [isRequestingNewLink, setIsRequestingNewLink] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const authClient = useMemo(() => createRuntimeAuthClient("/v1"), []);
  const authProfileController = useAuthProfileController({
    authClient,
    refetchSession: async () => {},
    request: async () => {},
    addLog: () => {},
    initialAuthMode: "reset-request",
    hasSession: false,
    sessionUserName: "",
    sessionUserEmail: "",
    busy,
    setBusy,
    onClearWorkspaceScopedTemplates: () => {},
    onClearWorkspaceScopedDocuments: () => {},
    onClearSessionWorkspaceData: () => {},
  });

  if (isRequestingNewLink) {
    return <AuthScreen {...authProfileController.authScreen} />;
  }

  if (resetState?.token) {
    const unmetPasswordRequirements = getUnmetAccountPasswordRequirements(newPassword);
    const shouldShowPasswordRequirements = passwordTouched || submitAttempted;
    const hasPasswordMismatch =
      confirmNewPassword.length > 0 && newPassword !== confirmNewPassword;

    async function submitNewPassword(event) {
      event.preventDefault();
      setSubmitAttempted(true);

      if (unmetPasswordRequirements.length > 0) {
        toast.error("Password must meet all complexity requirements.");
        return;
      }
      if (!confirmNewPassword.trim()) {
        toast.error("Confirm password is required.");
        return;
      }
      if (hasPasswordMismatch) {
        toast.error("Passwords do not match.");
        return;
      }

      setBusy(true);
      try {
        const result = await authClient.resetPassword({
          newPassword,
          token: resetState.token,
        });
        if (result?.error) {
          throw new Error(result.error.message || "Account password reset failed");
        }
        setNewPassword("");
        setConfirmNewPassword("");
        setPasswordTouched(false);
        setSubmitAttempted(false);
        window.history.replaceState(null, "", "/");
        onResetComplete();
      } catch (error) {
        toast.error("Password reset failed. Please request a new reset link.");
      } finally {
        setBusy(false);
      }
    }

    return (
      <>
        <Toaster richColors />
        <div className="auth-shell">
          <section className="auth-card">
            <div className="auth-header">
              <p className="eyebrow">Document Extraction</p>
              <h1>Studio</h1>
              <p>Choose a new password for your account.</p>
            </div>
            <form className="panel auth-panel" onSubmit={submitNewPassword}>
              <h2>Set new password</h2>
              <p className="muted">
                Your new password must meet the Account password policy.
              </p>
              <div className="row auth-form-grid">
                <label>
                  New password
                  <input
                    type="password"
                    value={newPassword}
                    aria-invalid={hasPasswordMismatch}
                    className={hasPasswordMismatch ? "auth-input-error" : ""}
                    onChange={(event) => {
                      setNewPassword(event.target.value);
                      setPasswordTouched(true);
                    }}
                    placeholder="************"
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    type="password"
                    value={confirmNewPassword}
                    aria-invalid={hasPasswordMismatch}
                    className={hasPasswordMismatch ? "auth-input-error" : ""}
                    onChange={(event) =>
                      setConfirmNewPassword(event.target.value)
                    }
                    placeholder="Repeat password"
                  />
                </label>
              </div>
              {hasPasswordMismatch ? (
                <p className="auth-password-mismatch">
                  Passwords do not match.
                </p>
              ) : null}
              {shouldShowPasswordRequirements &&
              unmetPasswordRequirements.length > 0 ? (
                <ul className="auth-password-requirements">
                  {unmetPasswordRequirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
              ) : null}
              <button
                type="submit"
                className="auth-primary-action"
                disabled={busy}
              >
                Set new password
              </button>
            </form>
          </section>
        </div>
      </>
    );
  }

  const title =
    resetState === "token-error"
      ? "Reset link has expired or is invalid"
      : "Reset link is missing or invalid";
  const message =
    resetState === "token-error"
      ? "This Account password reset link can no longer be used."
      : "Request a new Account password reset link to continue.";

  return (
    <>
      <Toaster richColors />
      <div className="auth-shell">
        <section className="auth-card">
          <div className="auth-header">
            <p className="eyebrow">Document Extraction</p>
            <h1>Studio</h1>
            <p>Use Account password reset to recover access to your account.</p>
          </div>
          <div className="panel auth-verification-prompt" role="status">
            <h2>{title}</h2>
            <p>{message}</p>
            <button
              type="button"
              className="auth-primary-action"
              disabled={busy}
              onClick={() => setIsRequestingNewLink(true)}
            >
              Request a new reset link
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

function getAccountPasswordResetRoute(location) {
  if (location.pathname !== "/reset-password") {
    return null;
  }

  const params = new URLSearchParams(location.search);
  if (params.has("error")) {
    return "token-error";
  }
  if (!params.get("token")) {
    return "missing-token";
  }
  return { token: params.get("token") };
}

function AdminContextList() {
  const items = [
    {
      id: "accounts",
      title: "Account Management",
      summary: "Users, roles, bans, and impersonation",
      meta: "Application-wide",
    },
  ];

  return (
    <div className="context-list admin-context-list">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="context-item active"
        >
          <strong>{item.title}</strong>
          <span>{item.summary}</span>
          <span>{item.meta}</span>
        </button>
      ))}
    </div>
  );
}

function getInitialActivePage() {
  return "workspace";
}

function getUnmetAccountPasswordRequirements(password) {
  return [
    { label: "At least 8 characters", test: password.length >= 8 },
    { label: "One uppercase letter", test: /[A-Z]/.test(password) },
    { label: "One number", test: /[0-9]/.test(password) },
    { label: "One special character", test: /[^A-Za-z0-9]/.test(password) },
  ]
    .filter((requirement) => !requirement.test)
    .map((requirement) => requirement.label);
}

function formatRoleLabel(value) {
  const role = String(value || "")
    .trim()
    .toLowerCase();
  if (!role) {
    return "-";
  }
  return role.charAt(0).toUpperCase() + role.slice(1);
}
