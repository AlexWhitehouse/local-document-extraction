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
import {
  ExtractionJobStatusDisplay,
  ExtractionResultDisplay,
} from "./features/documents/ExtractionResultDisplay.jsx";
import { ContextSidebar } from "./features/context/ContextSidebar.jsx";
import { DocumentContextList } from "./features/documents/DocumentContextList.jsx";
import { DocumentUploadModal } from "./features/documents/DocumentUploadModal.jsx";
import { useDocumentController } from "./features/documents/useDocumentController.js";
import {
  MainLayout,
  OperationalMetrics,
  WorkspaceToolbar,
} from "./features/layout/MainLayout.jsx";
import { TemplateContextList } from "./features/templates/TemplateContextList.jsx";
import { TemplateFieldEditor } from "./features/templates/TemplateFieldEditor.jsx";
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
export function App() {
  const resetPasswordRoute = getAccountPasswordResetRoute(window.location);
  if (resetPasswordRoute) {
    return <AccountPasswordResetRoute resetState={resetPasswordRoute} />;
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
  const [latestResponse, setLatestResponse] = useState(null);

  const [activePage, setActivePage] = useState(() => getInitialActivePage());

  const hasSession = Boolean(session?.user?.id);
  const sessionUserId = String(session?.user?.id || "").trim();
  const sessionUserName = String(session?.user?.name || "").trim();
  const sessionUserEmail = String(session?.user?.email || "").trim();
  const isImpersonating = Boolean(String(session?.session?.impersonatedBy || "").trim());
  const impersonatedUserLabel = sessionUserEmail || sessionUserName || "this user";
  const isApplicationAdmin = String(session?.user?.role || "").trim() === "admin";
  const adminVisiblePage = activePage === "admin" && !isApplicationAdmin ? "workspace" : activePage;
  const runtimeCore = createAppRuntimeCore({
    apiBase,
    setLatestResponse,
    setLogLines,
    toast,
  });
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
    onClearWorkspaceScopedData: () => {
      templateController.actions.clearWorkspaceScopedTemplates();
      documentController.actions.clearWorkspaceScopedDocuments();
      setLatestResponse(null);
    },
    onClearCompletedDocumentCache: () => {
      documentController.actions.clearCompletedDocumentCache();
    },
  });
  const { workspaceId, hasApiAccess, workspaceSelectionView } =
    workspaceController.context;
  const { request } = createWorkspaceRequestLayer({
    coreRequest,
    hasSession,
    workspaceId,
    onForbiddenWorkspaceAccess:
      workspaceController.actions.recoverForbiddenWorkspaceAccess,
  });
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
    request,
    addLog,
    showActionToast,
    showDocumentUploadToast,
    hasApiAccess,
    hasWorkspaceApiAccess: workspaceSelectionView.hasWorkspaceApiAccess,
    isAppBusy: busy,
    workspaceId,
    latestResponse,
    setLatestResponse,
    onActivePageChange: setActivePage,
  });
  const documents = documentController.contextList.documents;
  const selectedDocument = documentController.documentPage.selectedDocument;
  const { documentStatusMetrics, completionRate } = documentController.metrics;
  async function handleImpersonationStarted() {
    workspaceController.actions.clearSessionWorkspaceData();
    await refetchSession();
    setActivePage("workspace");
    await workspaceController.actions.listWorkspaces().catch(() => {});
  }

  async function handleStopImpersonating() {
    setIsStoppingImpersonation(true);
    try {
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
  });
  const workspaceSidebar = workspaceController.sidebar;
  const workspaceToolbar = workspaceController.toolbar;
  const workspaceUserActionModal = workspaceController.userActionModal;
  const authProfileController = useAuthProfileController({
    authClient,
    refetchSession,
    request,
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
        activePage={activeVisiblePage}
        counts={{
          workspace: workspaceContext.availableWorkspaces.length,
          templates: templates.length,
          documents: documents.length,
        }}
        uploadAriaDisabled={busy || !workspaceContext.hasWorkspaceApiAccess}
        isUploadDisabled={!workspaceContext.hasWorkspaceApiAccess}
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
                ? "Jobs"
                : activePage === "templates"
                  ? "Templates"
                  : activeVisiblePage === "admin"
                    ? "Admin"
                    : "Workspaces"
            }
            footer={
              activeVisiblePage === "admin" ? null : activePage === "documents" ? (
                <>
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
              <DocumentContextList {...documentController.contextList} />
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
              workspaceLabel={
                workspaceToolbar.workspaceLabel
              }
              isWorkspaceInvitationSelected={workspaceContext.isWorkspaceInvitationSelected}
              hasWorkspaceApiAccess={workspaceContext.hasWorkspaceApiAccess}
              documentCount={documents.length}
              hasApiAccess={hasApiAccess}
              isUploadDisabled={!workspaceContext.hasWorkspaceApiAccess}
              workspaceId={workspaceToolbar.workspaceId}
              workspacePrimaryAction={workspaceToolbar.workspacePrimaryAction}
              isDeletingWorkspace={workspaceToolbar.isDeletingWorkspace}
              isDeletingTemplate={templateController.toolbar.isDeletingTemplate}
              isDeletingDocument={documentController.toolbar.isDeletingDocument}
              selectedDocumentId={documentController.toolbar.selectedDocumentId}
              updateTemplateId={templateController.toolbar.selectedTemplateId}
              onCreateTemplate={templateController.toolbar.onCreateTemplate}
              onCreateWorkspace={workspaceToolbar.onCreateWorkspace}
              onUploadDocument={documentController.toolbar.onUploadDocument}
              onWorkspacePrimaryAction={workspaceToolbar.onWorkspacePrimaryAction}
              onDeleteTemplate={templateController.toolbar.onDeleteTemplate}
              onDeleteDocument={documentController.toolbar.onDeleteDocument}
            />

            {!workspaceContext.isWorkspaceInvitationSelected ? (
              <OperationalMetrics
                documentCount={documents.length}
                completionRate={completionRate}
              />
            ) : null}
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
              <AcceptedWorkspacePage {...workspaceController.acceptedPage} />
            )
          ) : null}

          {activeVisiblePage === "templates" ? (
            <>
              <header className="page-header">
                <p className="eyebrow">Templates</p>
                <h2>Template Builder</h2>
                <p>
                  Build reusable extraction schemas and update existing
                  templates.
                </p>
              </header>

              <section className="content-grid templates-grid">
                <article className="workspace-card create-template-panel">
                  <div className="workspace-head">
                    <h2>
                      {templateController.templatePage.isEditingTemplate
                        ? "Edit Template"
                        : "Create Template"}
                    </h2>
                  </div>
                  <div className="row two-up">
                    <label>
                      Name
                      <input
                        value={templateController.templatePage.templateName}
                        onChange={(event) =>
                          templateController.templatePage.onTemplateNameChange(
                            event.target.value,
                          )
                        }
                      />
                    </label>
                    <label>
                      Description
                      <input
                        value={templateController.templatePage.templateDescription}
                        onChange={(event) =>
                          templateController.templatePage.onTemplateDescriptionChange(
                            event.target.value,
                          )
                        }
                      />
                    </label>
                  </div>
                  <TemplateFieldEditor
                    fields={templateController.templatePage.templateFields}
                    onChange={templateController.templatePage.onTemplateFieldsChange}
                    title="Field Designer"
                    subtitle="Move through fields quickly on the left and edit details on the right."
                  />
                  <div className="actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={
                        templateController.templatePage.isSavingTemplate ||
                        !templateController.templatePage.hasApiAccess
                      }
                      onClick={templateController.templatePage.onOpenJsonModal}
                    >
                      Export / Import
                    </button>
                    <button
                      type="button"
                      disabled={
                        templateController.templatePage.isSavingTemplate ||
                        !templateController.templatePage.hasApiAccess ||
                        (templateController.templatePage.isEditingTemplate &&
                          !templateController.templatePage.isEditedTemplateDirty)
                      }
                      onClick={templateController.templatePage.onSaveTemplate}
                    >
                      {templateController.templatePage.isSavingTemplate
                        ? "Saving..."
                        : templateController.templatePage.isEditingTemplate
                          ? "Save Changes"
                          : "Save New Template"}
                    </button>
                  </div>
                </article>
              </section>
            </>
          ) : null}

          {activeVisiblePage === "documents" ? (
            <>
              <header className="page-header">
                <p className="eyebrow">Documents</p>
                <h2>Upload and Review</h2>
                <p>
                  Inspect extraction jobs and review results from previously
                  uploaded files.
                </p>
              </header>

              <section className="content-grid documents-grid">
                <article className="workspace-card job-status-panel">
                  <div className="workspace-head">
                    <h2>Job Status</h2>
                    <p>Track the selected extraction stage in real time.</p>
                  </div>
                  <ExtractionJobStatusDisplay job={selectedDocument} />
                </article>

                <article className="workspace-card result-view">
                  <div className="workspace-head result-view-head">
                    <div>
                      <h2>Document Details</h2>
                      <p>Review extraction output for the selected upload.</p>
                    </div>
                    {selectedDocument ? (
                      <span className="status-chip good template-name-badge">
                        {documentController.documentPage.selectedDocumentTemplateName}
                      </span>
                    ) : null}
                  </div>
                  {selectedDocument ? (
                    <ExtractionResultDisplay
                      job={selectedDocument}
                      isLoading={
                        documentController.documentPage.loadingDocumentDetailsId ===
                        String(selectedDocument.job_id || "")
                      }
                    />
                  ) : (
                    <p className="muted">Select an uploaded document.</p>
                  )}
                </article>
              </section>
            </>
          ) : null}
      </MainLayout>
    </>
  );
}

function AccountPasswordResetRoute({ resetState }) {
  const [isRequestingNewLink, setIsRequestingNewLink] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
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

  if (isComplete) {
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
        authProfileController.authScreen.onSwitchMode("signin");
        setIsComplete(true);
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
