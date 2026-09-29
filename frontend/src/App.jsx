import React, { useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { createRuntimeAuthClient } from "./lib/authClient";
import { DEFAULT_RUNTIME_CONFIGURATION } from "./lib/runtimeConfiguration";
import { createAppRuntimeCore, createWorkspaceRequestLayer } from "./lib/appRuntime";
import { AuthScreen } from "./features/auth/AuthScreen.jsx";
import {
  ACCOUNT_PASSWORD_REQUIREMENTS,
  useAuthProfileController,
} from "./features/auth/useAuthProfileController.js";
import { ApplicationAdminPage } from "./features/admin/ApplicationAdminPage.jsx";
import { useApplicationAdminController } from "./features/admin/useApplicationAdminController.js";
import { ContextSidebar } from "./features/context/ContextSidebar.jsx";
import { DocumentContextList } from "./features/documents/DocumentContextList.jsx";
import { DocumentPage } from "./features/documents/DocumentPage.jsx";
import { DocumentUploadModal } from "./features/documents/DocumentUploadModal.jsx";
import { createDocumentRequestAdapter } from "./features/documents/documentRequestAdapter.js";
import { useDocumentController } from "./features/documents/useDocumentController.js";
import { useDocumentViewingPreference } from "./features/documents/documentViewing.js";
import { EvaluationsPage } from "./features/evaluations/EvaluationsPage.jsx";
import { useEvaluations } from "./features/evaluations/useEvaluations.js";
import { MainLayout, WorkspaceToolbar } from "./features/layout/MainLayout.jsx";
import { OnboardingTour } from "./features/onboarding/OnboardingTour.jsx";
import { ProfileMenu } from "./features/profile/ProfileMenu.jsx";
import { TemplateContextList } from "./features/templates/TemplateContextList.jsx";
import { TemplateGenerationModal } from "./features/templates/TemplateGenerationModal.jsx";
import { TemplateJsonModal } from "./features/templates/TemplateJsonModal.jsx";
import { TemplatePage } from "./features/templates/TemplatePage.jsx";
import { useTemplateController } from "./features/templates/useTemplateController.js";
import { WorkspaceContextList } from "./features/workspaces/WorkspaceContextList.jsx";
import {
  AcceptedWorkspacePage,
  WorkspaceInvitationPage,
  WorkspaceUserActionModal,
} from "./features/workspaces/WorkspacePages.jsx";
import { useWorkspaceController } from "./features/workspaces/useWorkspaceController.js";
import { useWorkspaceModelConfiguration } from "./features/workspaces/useWorkspaceModelConfiguration.js";
import { useWorkspaceSourceRetention } from "./features/workspaces/useWorkspaceSourceRetention.js";
import "./features/layout/StudioLayouts.css";

const API_BASE = "/v1";


const PAGE_DESCRIPTIONS = {
  workspace: "Your extraction environment, connections and people.",
  templates: "Define what Studio should look for in each document.",
};

const CONTEXT_SIDEBAR_TITLES = {
  documents: "Documents",
  templates: "Templates",
  admin: "Admin",
  workspace: "Workspaces",
};

export function App({ configuration = DEFAULT_RUNTIME_CONFIGURATION }) {
  const [resetPasswordRoute, setResetPasswordRoute] = useState(() =>
    getAccountPasswordResetRoute(window.location),
  );
  if (resetPasswordRoute) {
    return (
      <AccountPasswordResetRoute
        authOptions={configuration.auth}
        resetState={resetPasswordRoute}
        onResetComplete={() => setResetPasswordRoute(null)}
      />
    );
  }

  return <AuthenticatedApp configuration={configuration} />;
}

function AuthenticatedApp({ configuration }) {
  const authClient = useMemo(() => createRuntimeAuthClient(), []);
  const {
    data: session,
    isPending: isSessionPending,
    refetch: refetchSession,
  } = authClient.useSession();

  const [busy, setBusy] = useState(false);
  const [isTourActive, setIsTourActive] = useState(false);
  const [isStoppingImpersonation, setIsStoppingImpersonation] = useState(false);
  const [activePage, setActivePage] = useState("workspace");

  const sessionUserId = String(session?.user?.id || "").trim();
  const hasSession = Boolean(session?.user?.id);
  const impersonatedBy = String(session?.session?.impersonatedBy || "").trim();
  const sessionId = hasSession ? `${sessionUserId}:${session.session?.id || ""}:${impersonatedBy}` : "";
  const sessionUserName = String(session?.user?.name || "").trim();
  const sessionUserEmail = String(session?.user?.email || "").trim();
  const isImpersonating = Boolean(impersonatedBy);
  const isApplicationAdmin = String(session?.user?.role || "").trim() === "admin";
  const visiblePage = activePage === "admin" && !isApplicationAdmin ? "workspace" : activePage;
  const maxSourceFileBytes = configuration.limits.maxSourceFileBytes;
  const sourceStorageConfigured = configuration.sourceStorage?.configured === true;
  const [documentViewingLayout, setDocumentViewingLayout] = useDocumentViewingPreference({
    userId: sessionUserId,
    readOnly: isImpersonating,
  });

  const { request: coreRequest, showActionToast, showDocumentUploadToast } = useMemo(
    () => createAppRuntimeCore({ apiBase: API_BASE, toast }),
    [],
  );
  const workspaceController = useWorkspaceController({
    coreRequest,
    showActionToast,
    hasSession,
    sessionUserId,
    sessionId,
    isAppBusy: busy,
    setBusy,
    onActivePageChange: setActivePage,
    beforeWorkspaceSelection: () => evaluation.confirmDiscard(),
    onClearWorkspaceScopedData: (options) => {
      evaluation.clear();
      templateController.actions.clearWorkspaceScopedTemplates();
      documentController.actions.clearWorkspaceScopedDocuments(options);
    },
  });
  const workspaceContext = workspaceController.context;
  const { workspaceId, hasApiAccess, hasWorkspaceApiAccess, isWorkspaceInvitationSelected } =
    workspaceContext;
  const { recoverForbiddenWorkspaceAccess, refreshSelectedWorkspaceContext } =
    workspaceController.actions;
  const workspaceToolbar = workspaceController.toolbar;

  const documentRequests = useMemo(() => {
    const { request } = createWorkspaceRequestLayer({
      coreRequest,
      hasSession,
      workspaceId,
      onForbiddenWorkspaceAccess: recoverForbiddenWorkspaceAccess,
    });
    return { request, documents: createDocumentRequestAdapter({ request }) };
  }, [coreRequest, hasSession, recoverForbiddenWorkspaceAccess, workspaceId]);
  const workspaceModel = useWorkspaceModelConfiguration({
    coreRequest,
    workspaceId,
    sessionUserId,
    role: workspaceContext.selectedWorkspaceRole,
    enabled: hasApiAccess && !isWorkspaceInvitationSelected,
  });
  const workspaceSourceRetention = useWorkspaceSourceRetention({
    coreRequest,
    workspaceId,
    sessionUserId,
    role: workspaceContext.selectedWorkspaceRole,
    enabled: hasApiAccess && !isWorkspaceInvitationSelected,
  });
  const templateController = useTemplateController({
    maxSourceFileBytes,
    request: documentRequests.request,
    showActionToast,
    hasApiAccess,
    workspaceId,
    sessionId,
    activePage,
    onActivePageChange: setActivePage,
  });
  const templates = templateController.templates;
  const documentController = useDocumentController({
    maxSourceFileBytes,
    apiBase: API_BASE,
    templates,
    selectedUploadTemplateId: templateController.selectedUploadTemplateId,
    onSelectedUploadTemplateChange: templateController.setSelectedUploadTemplateId,
    documentRequests: documentRequests.documents,
    showActionToast,
    showDocumentUploadToast,
    hasApiAccess,
    hasWorkspaceApiAccess,
    isAppBusy: busy,
    isWorkspaceDeletionInProgress: workspaceContext.isDeletingWorkspace,
    workspaceId,
    sessionId,
    onActivePageChange: setActivePage,
    onWorkspaceCapacityRefresh: refreshSelectedWorkspaceContext,
    modelReady: workspaceModel.ready,
    onModelConfigurationInvalidation: workspaceModel.invalidate,
    onWorkspaceAccessRevalidation: recoverForbiddenWorkspaceAccess,
  });
  const evaluation = useEvaluations({
    workspaceId,
    sessionId,
    enabled: hasApiAccess && !isWorkspaceInvitationSelected,
    active: activePage === "evaluations",
    onForbidden: recoverForbiddenWorkspaceAccess,
  });
  const documentToolbar = documentController.toolbar;
  const documentStatusCounts = documentController.statusCounts;

  async function handleImpersonationStarted() {
    workspaceController.actions.clearSessionWorkspaceData();
    await refetchSession();
    setActivePage("workspace");
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
      setActivePage("admin");
      showActionToast("applicationUser.stopImpersonating", "success");
    } catch {
      showActionToast("applicationUser.stopImpersonating", "failure");
    } finally {
      setIsStoppingImpersonation(false);
    }
  }

  const adminController = useApplicationAdminController({
    authClient,
    isActive: visiblePage === "admin",
    sessionUserId,
    showActionToast,
    onImpersonationStarted: handleImpersonationStarted,
    onImpersonationStarting: documentController.actions.cancelPendingSubmissions,
  });
  const { authScreen, profileMenu } = useAuthProfileController({
    authOptions: configuration.auth,
    authClient,
    refetchSession,
    hasSession,
    sessionUserName,
    sessionUserEmail,
    busy,
    setBusy,
    onClearWorkspaceScopedTemplates: templateController.actions.clearWorkspaceScopedTemplates,
    onClearWorkspaceScopedDocuments: documentController.actions.clearWorkspaceScopedDocuments,
    onClearSessionWorkspaceData: workspaceController.actions.clearSessionWorkspaceData,
    onSessionChanging: () => {
      evaluation.clear();
      documentController.actions.cancelPendingSubmissions();
    },
  });

  function handleSidebarNavigation(pageId) {
    if (pageId === "admin" && !isApplicationAdmin) {
      setActivePage("workspace");
      return;
    }

    setActivePage(pageId);
    if (pageId === "templates") {
      templateController.actions.handleTemplateNavigation();
    }
  }

  if (isSessionPending) {
    return null;
  }

  if (!hasSession) {
    return <AuthScreen {...authScreen} />;
  }

  const selectedDocument = documentController.documentPage.selectedDocument;
  const pageTitle =
    visiblePage === "workspace"
      ? workspaceToolbar.workspaceLabel
      : visiblePage === "templates"
        ? templateController.templatePage.templateName || "Create Template"
        : selectedDocument?.source_name || "Documents";
  const pageDescription =
    PAGE_DESCRIPTIONS[visiblePage] ||
    documentController.documentPage.selectedDocumentTemplateName ||
    "Select a document to see its extraction results.";

  return (
    <>
      <Toaster richColors />
      <MainLayout
        contentClassName={visiblePage === "admin" ? "" : `studio-main studio-main-${visiblePage}`}
        activePage={visiblePage}
        counts={{
          workspace: workspaceContext.availableWorkspaces.length,
          templates: templates.length,
          documents: documentToolbar.documentCount,
        }}
        uploadAriaDisabled={busy || !hasWorkspaceApiAccess || !workspaceModel.ready}
        isUploadDisabled={!hasWorkspaceApiAccess || !workspaceModel.ready}
        showAdminNavigation={isApplicationAdmin}
        impersonationSlot={
          isImpersonating ? (
            <div role="status" aria-label="Impersonation mode" className="impersonation-banner">
              <strong>Impersonating {sessionUserEmail || sessionUserName || "this user"}</strong>
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
        onUploadDocument={documentToolbar.onUploadDocument}
        profileSlot={
          isImpersonating ? (
            <ProfileMenu ref={profileMenu.panelRef} {...profileMenu} />
          ) : (
            <OnboardingTour
              key={sessionUserId}
              userId={sessionUserId}
              ready={hasWorkspaceApiAccess}
              workspaceId={workspaceId}
              workspace={workspaceController.acceptedPage}
              template={templateController.templatePage}
              model={workspaceModel}
              upload={documentController.uploadModal}
              busy={busy}
              onActiveChange={setIsTourActive}
              returnFocusRef={profileMenu.panelRef}
              renderProfile={(tourAction) => (
                <ProfileMenu ref={profileMenu.panelRef} {...profileMenu} tourAction={tourAction} />
              )}
              onStart={() => {
                if (profileMenu.isOpen) profileMenu.onToggle();
                setActivePage("workspace");
                documentController.uploadModal.onClose();
              }}
            />
          )
        }
        contextSidebar={
          visiblePage === "evaluations" ? null : (
            <ContextSidebar
              title={CONTEXT_SIDEBAR_TITLES[visiblePage]}
              footer={
                visiblePage === "admin" ? null : visiblePage === "documents" ? (
                  <>
                    {documentToolbar.selectedDocumentCount ? (
                      <span className="status-chip good">
                        Selected {documentToolbar.selectedDocumentCount}
                      </span>
                    ) : null}
                    <span className="status-chip" title="All queued documents in this workspace">
                      Queued {documentStatusCounts.queued}
                    </span>
                    <span className="status-chip good" title="All completed documents in this workspace">
                      Completed {documentStatusCounts.completed}
                    </span>
                  </>
                ) : visiblePage === "templates" ? (
                  <>
                    <span className="status-chip">Templates {templates.length}</span>
                    <span className="status-chip good">
                      {templateController.templatePage.isEditingTemplate ? "Editing" : "Draft"}
                    </span>
                  </>
                ) : (
                  <WorkspaceSidebarFooter context={workspaceContext} />
                )
              }
            >
              {visiblePage === "admin" ? (
                <AdminContextList />
              ) : visiblePage === "documents" ? (
                <DocumentContextList {...documentController.contextList} />
              ) : visiblePage === "templates" ? (
                <TemplateContextList {...templateController.contextList} />
              ) : (
                <WorkspaceContextList {...workspaceController.sidebar} />
              )}
            </ContextSidebar>
          )
        }
        modalSlot={
          <>
            <WorkspaceUserActionModal {...workspaceController.userActionModal} />
            <TemplateGenerationModal {...templateController.generationModal} />
            <TemplateJsonModal {...templateController.jsonModal} />
            <DocumentUploadModal {...documentController.uploadModal} />
          </>
        }
      >
        {visiblePage !== "admin" && visiblePage !== "evaluations" ? (
          <WorkspaceToolbar
            activePage={visiblePage}
            pageTitle={pageTitle}
            pageDescription={pageDescription}
            workspaceLabel={workspaceToolbar.workspaceLabel}
            isWorkspaceInvitationSelected={isWorkspaceInvitationSelected}
            hasApiAccess={hasApiAccess}
            isUploadDisabled={!hasWorkspaceApiAccess}
            workspaceId={workspaceToolbar.workspaceId}
            workspacePrimaryAction={workspaceToolbar.workspacePrimaryAction}
            isDeletingWorkspace={workspaceToolbar.isDeletingWorkspace}
            isWorkspaceBusy={busy}
            isDeletingTemplate={templateController.toolbar.isDeletingTemplate}
            isDeletingDocument={documentToolbar.isDeletingDocument}
            isExportingDocuments={documentToolbar.isExportingDocuments}
            selectedDocumentId={documentToolbar.selectedDocumentId}
            selectedDocumentCount={documentToolbar.selectedDocumentCount}
            exportableDocumentCount={documentToolbar.exportableDocumentCount}
            updateTemplateId={templateController.toolbar.selectedTemplateId}
            onAutoGenerateTemplate={templateController.toolbar.onAutoGenerateTemplate}
            onCreateTemplate={() => templateController.toolbar.onCreateTemplate({ empty: isTourActive })}
            onCreateWorkspace={workspaceToolbar.onCreateWorkspace}
            onExportDocuments={documentToolbar.onExportDocuments}
            onUploadDocument={documentToolbar.onUploadDocument}
            onWorkspacePrimaryAction={workspaceToolbar.onWorkspacePrimaryAction}
            onDeleteTemplate={templateController.toolbar.onDeleteTemplate}
            onDeleteDocument={documentToolbar.onDeleteDocument}
            canDownloadOriginal={documentToolbar.canDownloadOriginal}
            isDownloadingOriginal={documentToolbar.isDownloadingOriginal}
            onDownloadOriginal={documentToolbar.onDownloadOriginal}
          />
        ) : null}

        {visiblePage === "admin" ? <ApplicationAdminPage admin={adminController} /> : null}

        {visiblePage === "workspace" ? (
          isWorkspaceInvitationSelected && workspaceContext.selectedWorkspaceInvitation ? (
            <WorkspaceInvitationPage {...workspaceController.invitationPage} />
          ) : (
            <AcceptedWorkspacePage
              {...workspaceController.acceptedPage}
              workspaceId={workspaceId}
              workspaceRole={workspaceContext.selectedWorkspaceRole}
              modelConfiguration={workspaceModel}
              sourceRetention={workspaceSourceRetention}
              modelConfigurationKey={`${sessionUserId}:${workspaceId}`}
            />
          )
        ) : null}

        {visiblePage === "templates" ? <TemplatePage {...templateController.templatePage} /> : null}
        {visiblePage === "evaluations" ? (
          <EvaluationsPage
            evaluation={evaluation}
            templates={templates}
            enabled={hasApiAccess}
            onTemplateSaved={templateController.actions.listTemplates}
            maxSourceFileBytes={maxSourceFileBytes}
            suggestedModels={documentController.contextList.availableModels}
            workspaceLabel={workspaceToolbar.workspaceLabel}
          />
        ) : null}
        {visiblePage === "documents" ? (
          <DocumentPage
            {...documentController.documentPage}
            viewingLayout={documentViewingLayout}
            onViewingLayoutChange={setDocumentViewingLayout}
            sourceStorageConfigured={sourceStorageConfigured}
          />
        ) : null}
      </MainLayout>
    </>
  );
}

function WorkspaceSidebarFooter({ context }) {
  const {
    availableWorkspaces,
    hasWorkspaceApiAccess,
    hasWorkspaceResolutionError,
    isWorkspaceContextLoading,
    isWorkspaceInvitationSelected,
  } = context;
  const status = isWorkspaceContextLoading
    ? "Loading"
    : hasWorkspaceResolutionError
      ? "Resolution Error"
      : isWorkspaceInvitationSelected
        ? "Invitation Pending"
        : `API ${hasWorkspaceApiAccess ? "Ready" : "Missing"}`;

  return (
    <>
      <span className="status-chip">
        Workspaces{" "}
        {isWorkspaceContextLoading || hasWorkspaceResolutionError ? 0 : availableWorkspaces.length}
      </span>
      <span className={`status-chip ${hasWorkspaceApiAccess ? "good" : "warn"}`}>{status}</span>
    </>
  );
}

function AccountPasswordResetRoute({ resetState, onResetComplete, authOptions }) {
  const [isRequestingNewLink, setIsRequestingNewLink] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const authClient = useMemo(() => createRuntimeAuthClient(), []);
  const authProfileController = useAuthProfileController({
    authOptions,
    authClient,
    refetchSession: async () => {},
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

  if (!authOptions.emailPasswordEnabled || isRequestingNewLink) {
    return <AuthScreen {...authProfileController.authScreen} />;
  }

  if (resetState.token) {
    const unmetPasswordRequirements = ACCOUNT_PASSWORD_REQUIREMENTS
      .filter((requirement) => !requirement.test(newPassword))
      .map((requirement) => requirement.label);
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
      } catch {
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
                    onChange={(event) => setConfirmNewPassword(event.target.value)}
                    placeholder="Repeat password"
                  />
                </label>
              </div>
              {hasPasswordMismatch ? (
                <p className="auth-password-mismatch">Passwords do not match.</p>
              ) : null}
              {shouldShowPasswordRequirements && unmetPasswordRequirements.length > 0 ? (
                <ul className="auth-password-requirements">
                  {unmetPasswordRequirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
              ) : null}
              <button type="submit" className="auth-primary-action" disabled={busy}>
                Set new password
              </button>
            </form>
          </section>
        </div>
      </>
    );
  }

  const isTokenError = resetState.error === "token";

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
            <h2>
              {isTokenError
                ? "Reset link has expired or is invalid"
                : "Reset link is missing or invalid"}
            </h2>
            <p>
              {isTokenError
                ? "This Account password reset link can no longer be used."
                : "Request a new Account password reset link to continue."}
            </p>
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
    return { error: "token" };
  }
  const token = params.get("token");
  return token ? { token } : { error: "missing-token" };
}

function AdminContextList() {
  return (
    <div className="context-list admin-context-list">
      <button type="button" className="context-item active">
        <strong>Account Management</strong>
        <span>Users, roles, bans, and impersonation</span>
        <span>Application-wide</span>
      </button>
    </div>
  );
}
