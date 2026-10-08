import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "sonner";
import { defaultToast } from "./lib/notify";
import { createRuntimeAuthClient } from "./lib/authClient";
import { DEFAULT_RUNTIME_CONFIGURATION } from "./lib/runtimeConfiguration";
import { appPath } from "./lib/appRoutes";
import { useAppNavigation } from "./lib/useAppNavigation";
import { createAppRuntimeCore, createWorkspaceRequestLayer } from "./lib/appRuntime";
import { AuthScreen } from "./features/auth/AuthScreen.jsx";
import { ACCOUNT_PASSWORD_REQUIREMENTS, useAuthProfileController } from "./features/auth/useAuthProfileController.js";
import { ApplicationAdminPage } from "./features/admin/ApplicationAdminPage.jsx";
import { AdminContextFooter, AdminContextList } from "./features/admin/AdminContextList.jsx";
import { useApplicationAdminController } from "./features/admin/useApplicationAdminController.js";
import { ContextSidebar } from "./features/context/ContextSidebar.jsx";
import { DocumentContextList } from "./features/documents/DocumentContextList.jsx";
import { DocumentLifecycleAnnouncer } from "./features/documents/DocumentLifecycleAnnouncer.jsx";
import { DocumentPage } from "./features/documents/DocumentPage.jsx";
import { DocumentUploadModal } from "./features/documents/DocumentUploadModal.jsx";
import { createDocumentRequestAdapter } from "./features/documents/documentRequestAdapter.js";
import { useDocumentController } from "./features/documents/useDocumentController.js";
import { useDocumentViewingPreference } from "./features/documents/documentViewing.js";
import { EvaluationsPage } from "./features/evaluations/EvaluationsPage.jsx";
import { useEvaluations } from "./features/evaluations/useEvaluations.js";
import { MainLayout } from "./features/layout/MainLayout.jsx";
import { WorkspacePageHeader } from "./features/layout/WorkspacePageHeader.jsx";
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
import { useWorkspaceDocumentProcessingSettings } from "./features/workspaces/useWorkspaceDocumentProcessingSettings.js";
import { useWorkspaceModelConfiguration } from "./features/workspaces/useWorkspaceModelConfiguration.js";
import { useWorkspaceSourceRetention } from "./features/workspaces/useWorkspaceSourceRetention.js";
import { WorkspaceCosts } from "./features/workspaces/costs/WorkspaceCosts.jsx";
import { hasUnsavedEdits, runDiscardChecks } from "./lib/unsavedChanges.js";
import { DISCARD_CHANGES, confirmDialog } from "./features/ui/confirm.jsx";
import { Field, TextInput } from "./features/ui/Field.jsx";
import { Callout } from "./features/ui/Callout.jsx";
import { LoadingState } from "./features/ui/States.jsx";
import { PageHeader } from "./features/ui/PageHeader.jsx";
import { Button } from "./features/ui/Button.jsx";
import { useDocumentTitle } from "./lib/documentTitle.js";
import "./features/layout/StudioLayouts.css";

const API_BASE = "/v1";

const PAGE_TITLES = {
  workspace: "Workspace",
  templates: "Templates",
  documents: "Documents",
  evaluations: "Evaluations",
  costs: "Costs",
  admin: "Admin",
};

const PAGE_LABELS = {
  workspace: "Workspace overview",
  templates: "Template editor",
  documents: "Documents",
};

const CONTEXT_SIDEBAR_TITLES = {
  documents: "Documents",
  templates: "Templates",
  admin: "Accounts",
  workspace: "Workspaces",
};

export function App({
  configuration = DEFAULT_RUNTIME_CONFIGURATION,
  createAuthClient = createRuntimeAuthClient,
  notifications = defaultToast,
}) {
  const navigation = useAppNavigation();

  const resetPasswordRoute =
    navigation.route.page === "reset-password" ? getAccountPasswordResetRoute(window.location) : null;

  return (
    <>
      <Toaster richColors closeButton theme="dark" />
      {resetPasswordRoute ? (
        <AccountPasswordResetRoute
          authOptions={configuration.auth}
          createAuthClient={createAuthClient}
          toast={notifications}
          resetState={resetPasswordRoute}
          onResetComplete={() => navigation.navigate("/", { replace: true, force: true })}
        />
      ) : (
        <AuthenticatedApp
          configuration={configuration}
          navigation={navigation}
          createAuthClient={createAuthClient}
          toast={notifications}
        />
      )}
    </>
  );
}

function AuthenticatedApp({ configuration, navigation, createAuthClient, toast }) {
  const { route, navigate } = navigation;
  const authClient = useMemo(() => createAuthClient(), [createAuthClient]);

  const { data: session, isPending: isSessionPending, refetch: refetchSession } = authClient.useSession();

  const [isTourActive, setIsTourActive] = useState(false);
  const [isStoppingImpersonation, setIsStoppingImpersonation] = useState(false);
  const activePage = route.page;
  // Live Workspace events reach the Evaluation controller, which is created after the socket owner.
  const evaluationRef = useRef(null);

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

  const {
    request: coreRequest,
    showActionToast,
    showDocumentUploadToast,
  } = useMemo(() => createAppRuntimeCore({ apiBase: API_BASE, toast }), [toast]);

  const workspaceController = useWorkspaceController({
    coreRequest,
    showActionToast,
    toast,
    hasSession,
    sessionUserId,
    sessionId,
    onActivePageChange: setActivePage,
    requestedWorkspaceId: route.workspaceId,
    requestedInvitationId: route.invitationId,
    onWorkspaceNavigation: (id, options = {}) =>
      navigate(appPath({ workspaceId: id, invitationId: options.invitationId }), options),
    beforeWorkspaceSelection: () => evaluation.confirmDiscard(),
    onClearWorkspaceScopedData: (options) => {
      evaluation.clear();
      templateController.actions.clearWorkspaceScopedTemplates();
      documentController.actions.clearWorkspaceScopedDocuments(options);
    },
  });

  const workspaceContext = workspaceController.context;

  const { workspaceId, hasWorkspaceApiAccess, isWorkspaceInvitationSelected } = workspaceContext;

  const hasApiAccess = workspaceContext.hasApiAccess;

  const { recoverForbiddenWorkspaceAccess, refreshSelectedWorkspaceContext } = workspaceController.actions;

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
    showActionToast,
    workspaceId,
    sessionUserId,
    role: workspaceContext.selectedWorkspaceRole,
    enabled: hasApiAccess && !isWorkspaceInvitationSelected,
  });

  const workspaceDocumentProcessing = useWorkspaceDocumentProcessingSettings({
    coreRequest,
    showActionToast,
    workspaceId,
    sessionUserId,
    role: workspaceContext.selectedWorkspaceRole,
    enabled: hasApiAccess && !isWorkspaceInvitationSelected,
  });

  const workspaceSourceRetention = useWorkspaceSourceRetention({
    coreRequest,
    showActionToast,
    workspaceId,
    sessionUserId,
    role: workspaceContext.selectedWorkspaceRole,
    enabled: hasApiAccess && !isWorkspaceInvitationSelected,
  });

  const templateController = useTemplateController({
    maxSourceFileBytes,
    request: documentRequests.request,
    showActionToast,
    toast,
    hasApiAccess,
    workspaceId,
    sessionId,
    activePage,
    onActivePageChange: setActivePage,
    routeTemplateId: activePage === "templates" ? route.templateId || "" : undefined,
    onTemplateNavigation: (templateId, options) =>
      options?.force && activePage !== "templates"
        ? true
        : navigate(appPath({ workspaceId, page: "templates", templateId }), options),
  });

  const templates = templateController.templates;

  const navigateDocument = useCallback(
    (selection, options) => navigate(appPath({ workspaceId, page: "documents", ...selection }), options),
    [navigate, workspaceId],
  );

  const documentController = useDocumentController({
    maxSourceFileBytes,
    apiBase: API_BASE,
    templates,
    workspaceTags: templateController.templatePage.tagPicker.tags,
    onTagsRefresh: templateController.templatePage.tagPicker.onReload,
    onProcessingPolicyRefresh: workspaceDocumentProcessing.reload,
    selectedUploadTemplateId: templateController.selectedUploadTemplateId,
    onSelectedUploadTemplateChange: templateController.setSelectedUploadTemplateId,
    documentRequests: documentRequests.documents,
    showActionToast,
    showDocumentUploadToast,
    hasApiAccess,
    hasWorkspaceApiAccess,
    isWorkspaceDeletionInProgress: workspaceContext.isDeletingWorkspace,
    workspaceId,
    sessionId,
    onActivePageChange: setActivePage,
    onWorkspaceCapacityRefresh: refreshSelectedWorkspaceContext,
    modelReady: workspaceModel.ready,
    onModelConfigurationInvalidation: workspaceModel.invalidate,
    onWorkspaceAccessRevalidation: recoverForbiddenWorkspaceAccess,
    onEvaluationDocumentChanged: (change) => evaluationRef.current?.documentChanged(change),
    routeDocumentId: activePage === "documents" ? route.documentId : "",
    routePacketId: activePage === "documents" ? route.packetId : "",
    onDocumentNavigation: navigateDocument,
  });

  const evaluation = useEvaluations({
    workspaceId,
    sessionId,
    enabled: hasApiAccess && !isWorkspaceInvitationSelected,
    active: activePage === "evaluations",
    onForbidden: recoverForbiddenWorkspaceAccess,
  });

  evaluationRef.current = evaluation;
  const documentToolbar = documentController.toolbar;

  function pagePath(page) {
    const target = { page, workspaceId: hasApiAccess ? workspaceId : route.workspaceId };

    if (page === "workspace" && route.invitationId) target.invitationId = route.invitationId;

    if (hasApiAccess && page === "templates") {
      target.templateId =
        templateController.toolbar.selectedTemplateId || (templateController.navigation.isDraft ? "new" : "");
    }

    if (hasApiAccess && page === "documents") {
      const documentPage = documentController.documentPage;

      if (documentPage.selectedPacketId) {
        target.packetId = documentPage.selectedPacketId;
        target.documentId = documentPage.isSingleDocument ? "" : documentPage.packetPage.activeDocumentId;
      } else {
        target.documentId = documentPage.selectedDocument?.job_id;
      }
    }

    return appPath(target);
  }

  function setActivePage(page) {
    return navigate(pagePath(page));
  }

  navigation.guard.current = (next) => {
    const changingWorkspace = Boolean(
      (next.workspaceId && next.workspaceId !== workspaceId) ||
      (next.invitationId !== route.invitationId && next.invitationId) ||
      next.root,
    );

    const changingTemplate =
      next.page === "templates" &&
      next.templateId !==
        (templateController.toolbar.selectedTemplateId || (templateController.navigation.isDraft ? "new" : ""));

    // Evaluation dialogs hold unapplied local form state, while accepted inputs
    // and results live in the controller and survive section navigation.
    const leavingEvaluationDialog =
      activePage === "evaluations" && (next.page !== "evaluations" || changingWorkspace) && hasUnsavedEdits();

    return runDiscardChecks(
      [
        () => !leavingEvaluationDialog || confirmDialog(DISCARD_CHANGES),
        () => !(changingWorkspace || changingTemplate) || templateController.navigation.confirmDiscard(),
        () => !changingWorkspace || evaluation.confirmDiscard(),
      ],
      () => templateController.navigation.invalidatePendingLoad(),
    );
  };

  navigation.hasUnsavedChanges.current =
    hasSession &&
    (templateController.navigation.hasUnsavedChanges ||
      hasUnsavedEdits() ||
      Boolean(evaluation.state.documents.length || evaluation.state.candidates.length));
  const navigationGuard = navigation.guard;
  const navigationUnsaved = navigation.hasUnsavedChanges;
  useEffect(
    () => () => {
      navigationGuard.current = null;
      navigationUnsaved.current = false;
    },
    [navigationGuard, navigationUnsaved],
  );

  useEffect(() => {
    if (!hasSession || !hasApiAccess || isWorkspaceInvitationSelected) return;

    if (route.root) {
      navigate(appPath({ workspaceId }), { replace: true, force: true });

      return;
    }

    if (activePage === "templates" && !route.templateId) {
      const templateId =
        templateController.toolbar.selectedTemplateId ||
        (templateController.navigation.hasUnsavedChanges || templateController.navigation.isDraft
          ? "new"
          : templates[0]?.id);

      if (templateId) navigate(appPath({ workspaceId, page: "templates", templateId }), { replace: true, force: true });
    }

    if (
      activePage === "documents" &&
      !route.documentId &&
      !route.packetId &&
      documentController.documentPage.selectedDocument?.job_id
    ) {
      navigateDocument(
        { documentId: documentController.documentPage.selectedDocument.job_id },
        { replace: true, force: true },
      );
    }
  }, [
    hasSession,
    hasApiAccess,
    isWorkspaceInvitationSelected,
    route.root,
    route.templateId,
    route.documentId,
    route.packetId,
    activePage,
    workspaceId,
    templates,
    templateController.toolbar.selectedTemplateId,
    templateController.navigation.hasUnsavedChanges,
    templateController.navigation.isDraft,
    documentController.documentPage.selectedDocument?.job_id,
    navigate,
    navigateDocument,
  ]);

  const dismissApiKey = workspaceController.actions.dismissApiKey;
  useEffect(() => {
    if (activePage !== "workspace") dismissApiKey();
  }, [activePage, dismissApiKey]);

  async function handleImpersonationStarted() {
    workspaceController.actions.clearSessionWorkspaceData();
    await refetchSession();
    navigate("/", { replace: true, force: true });
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
      navigate("/admin", { replace: true, force: true });
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
    toast,
    authOptions: configuration.auth,
    authClient,
    refetchSession,
    hasSession,
    sessionUserName,
    sessionUserEmail,
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
  }

  if (isSessionPending) {
    return <AppLoadingShell />;
  }

  if (!hasSession) {
    return (
      <>
        <DocumentTitle page="Sign in" />
        <AuthScreen {...authScreen} />
      </>
    );
  }

  const workspaceUnavailable = activePage !== "admin" && !route.root && workspaceContext.unavailableRoute;

  const workspaceResolutionFailed =
    activePage !== "admin" && !route.root && workspaceContext.hasWorkspaceResolutionError;

  const templateLoad = templateController.navigation.load;
  const requestedTemplate = activePage === "templates" && route.templateId && route.templateId !== "new";

  const templateUnavailable =
    requestedTemplate && templateLoad.id === route.templateId && ["missing", "error"].includes(templateLoad.status);

  const templateLoading =
    requestedTemplate && !templateUnavailable && templateController.toolbar.selectedTemplateId !== route.templateId;

  const documentUnavailable = activePage === "documents" && route.documentId && documentController.navigation.error;
  const packetUnavailable = activePage === "documents" && route.packetId && documentController.navigation.packetError;

  const documentLoading =
    activePage === "documents" &&
    route.documentId &&
    !documentUnavailable &&
    documentController.documentPage.selectedDocument?.job_id !== route.documentId;

  const adminUnavailable = activePage === "admin" && !isApplicationAdmin;

  const routeMessage =
    activePage === "not-found"
      ? "Page not found."
      : adminUnavailable
        ? "This page is not available to your account."
        : workspaceUnavailable
          ? "This Workspace or invitation is unavailable. It may have been removed, or you may no longer have access."
          : workspaceResolutionFailed
            ? "Workspace could not be loaded. Try again."
            : packetUnavailable
              ? packetUnavailable === "missing"
                ? "This Document packet is unavailable. It may have been deleted."
                : "Document packet could not be loaded. Try again."
              : templateUnavailable
                ? templateLoad.status === "missing"
                  ? "This Template is unavailable. It may have been deleted."
                  : "Template could not be loaded. Try again."
                : documentUnavailable
                  ? documentUnavailable === "missing"
                    ? "This Document is unavailable. It may have been deleted."
                    : "Document could not be loaded. Try again."
                  : "";

  const routeTitle = activePage === "not-found" ? "Page not found" : "Page unavailable";

  const packetLoading =
    activePage === "documents" &&
    route.packetId &&
    documentController.documentPage.packetPage.packet?.packet_id !== route.packetId;

  const routeLoading =
    !routeMessage &&
    !route.root &&
    activePage !== "admin" &&
    (workspaceContext.isWorkspaceContextLoading || templateLoading || documentLoading || packetLoading);

  const selectedDocument = documentController.documentPage.selectedDocument;

  const selectedDocumentName = documentController.documentPage.selectedPacketId
    ? documentController.documentPage.packetPage.packet?.source_name || "Document packet"
    : selectedDocument?.source_name || "";

  const workspaceName = workspaceToolbar.workspaceName;
  const templatePage = templateController.templatePage;
  const templateName = templatePage.templateName || "";

  // The open template or document, named in the title and the last breadcrumb.
  const pageItem = visiblePage === "templates" ? templateName : visiblePage === "documents" ? selectedDocumentName : "";

  const pageTitle =
    visiblePage === "workspace"
      ? workspaceName || PAGE_TITLES.workspace
      : visiblePage === "templates"
        ? templateName || "Create template"
        : selectedDocumentName || PAGE_TITLES.documents;

  // Descriptions only where they add information: a saved template's own description,
  // and what a selected document was extracted with.
  const pageDescription =
    visiblePage === "templates"
      ? (templatePage.isEditingTemplate && templatePage.templateDescription?.trim()) || ""
      : visiblePage === "documents"
        ? documentController.documentPage.selectedDocumentTemplateName ||
          (documentController.documentPage.selectedPacketId
            ? documentController.documentPage.isSingleDocument
              ? "Processing document"
              : "Smart splitting"
            : "")
        : "";

  const workspaceCrumb = workspaceName ? { label: workspaceName, href: pagePath("workspace"), onClick: () => setActivePage("workspace") } : null;
  const sectionCrumb = (page) => ({ label: PAGE_TITLES[page], href: pagePath(page), onClick: () => setActivePage(page) });
  const withWorkspace = (...crumbs) => [workspaceCrumb, ...crumbs].filter(Boolean);

  const headerBreadcrumbs =
    visiblePage === "admin"
      ? [sectionCrumb("admin"), { label: "Accounts" }]
      : visiblePage === "templates"
        ? withWorkspace(sectionCrumb("templates"), { label: pageTitle })
        : visiblePage === "documents" && selectedDocumentName
          ? withWorkspace(sectionCrumb("documents"), { label: selectedDocumentName })
          : withWorkspace({ label: visiblePage === "documents" ? PAGE_TITLES.documents : "Overview" });

  // The browser tab title: "{item} · {page} · {workspace} — Studio".
  const documentTitle = routeMessage
    ? { page: routeTitle }
    : {
        item: visiblePage === "workspace" ? workspaceName : pageItem,
        page: PAGE_TITLES[visiblePage],
        workspace: visiblePage === "workspace" || visiblePage === "admin" ? "" : workspaceName,
      };

  return (
    <>
      <DocumentTitle {...documentTitle} />
      <MainLayout
        contentClassName={`studio-main studio-main-${visiblePage}`}
        activePage={visiblePage === "costs" ? "workspace" : visiblePage}
        contentSelection={
          visiblePage === "documents"
            ? packetContentSelection(documentController.documentPage) || documentToolbar.selectedDocumentId
            : visiblePage === "templates"
              ? templateController.toolbar.selectedTemplateId
              : visiblePage === "workspace"
                ? workspaceToolbar.workspaceId
                : visiblePage === "admin"
                  ? String(adminController.selectedUser?.id || "")
                  : ""
        }
        counts={{
          workspace: workspaceContext.availableWorkspaces.length,
          templates: hasApiAccess ? templates.length : 0,
          documents: hasApiAccess ? documentToolbar.documentCount : 0,
        }}
        isUploadDisabled={!hasWorkspaceApiAccess}
        isModelSetupRequired={hasWorkspaceApiAccess && !workspaceModel.ready}
        liveUpdatesPaused={documentController.liveUpdatesPaused}
        showAdminNavigation={isApplicationAdmin}
        impersonationSlot={
          isImpersonating ? (
            <Callout
              tone="warning"
              role="status"
              aria-label="Impersonation mode"
              title={`Impersonating ${sessionUserEmail || sessionUserName || "this user"}`}
              action={
                <Button
                  variant="secondary"
                  pending={isStoppingImpersonation}
                  pendingLabel="Stopping…"
                  onClick={handleStopImpersonating}
                >
                  Stop impersonating
                </Button>
              }
            />
          ) : null
        }
        onNavigate={handleSidebarNavigation}
        navigationHref={pagePath}
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
              busy={workspaceToolbar.isCreatingWorkspace}
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
        contextListLabel={CONTEXT_SIDEBAR_TITLES[visiblePage === "costs" ? "workspace" : visiblePage] || ""}
        contextSidebar={
          visiblePage === "evaluations" ? null : (
            <ContextSidebar
              title={CONTEXT_SIDEBAR_TITLES[visiblePage === "costs" ? "workspace" : visiblePage]}
              footer={visiblePage === "admin" ? <AdminContextFooter admin={adminController} /> : null}
            >
              {visiblePage === "admin" ? (
                <AdminContextList admin={adminController} />
              ) : !hasApiAccess && ["documents", "templates"].includes(visiblePage) ? (
                <p className="muted">
                  {workspaceContext.isWorkspaceContextLoading
                    ? "Loading workspace context…"
                    : "Choose an accessible Workspace."}
                </p>
              ) : visiblePage === "documents" ? (
                <DocumentContextList {...documentController.contextList} workspaceId={workspaceId} />
              ) : visiblePage === "templates" ? (
                <TemplateContextList {...templateController.contextList} workspaceId={workspaceId} />
              ) : (
                <WorkspaceContextList {...workspaceController.sidebar} routed />
              )}
            </ContextSidebar>
          )
        }
        modalSlot={
          <>
            <WorkspaceUserActionModal {...workspaceController.userActionModal} />
            {activePage === "templates" ? <TemplateGenerationModal {...templateController.generationModal} /> : null}
            {activePage === "templates" ? <TemplateJsonModal {...templateController.jsonModal} /> : null}
            <DocumentUploadModal {...documentController.uploadModal} />
          </>
        }
      >
        {routeMessage ? (
          <section className="panel" role="alert">
            <PageHeader
              label={routeTitle}
              title={routeTitle}
              description={activePage === "not-found" ? "" : routeMessage}
            />
            <Button
              onClick={() =>
                navigate(
                  appPath({
                    workspaceId: workspaceUnavailable ? "" : workspaceId,
                    page: templateUnavailable
                      ? "templates"
                      : documentUnavailable || packetUnavailable
                        ? "documents"
                        : "workspace",
                  }),
                )
              }
            >
              {templateUnavailable
                ? "Back to Templates"
                : documentUnavailable || packetUnavailable
                  ? "Back to Documents"
                  : "Back to Workspaces"}
            </Button>
            {templateLoad.status === "error" && templateUnavailable ? (
              <Button onClick={templateController.navigation.retry}>Try again</Button>
            ) : null}
            {documentUnavailable === "error" ? (
              <Button onClick={documentController.navigation.retry}>Try again</Button>
            ) : null}
            {packetUnavailable === "error" ? (
              <Button onClick={documentController.navigation.retryPacket}>Try again</Button>
            ) : null}
            {workspaceResolutionFailed ? (
              <Button onClick={workspaceController.sidebar.onRetryResolution}>Try again</Button>
            ) : null}
          </section>
        ) : null}
        {!routeMessage ? (
          <>
            {visiblePage !== "admin" && visiblePage !== "evaluations" && visiblePage !== "costs" ? (
              <WorkspacePageHeader
                activePage={visiblePage}
                label={PAGE_LABELS[visiblePage]}
                breadcrumbs={headerBreadcrumbs}
                title={pageTitle}
                description={pageDescription}
                isWorkspaceInvitationSelected={isWorkspaceInvitationSelected}
                hasApiAccess={hasApiAccess}
                workspaceId={workspaceToolbar.workspaceId}
                workspacePrimaryAction={workspaceToolbar.workspacePrimaryAction}
                isDeletingWorkspace={workspaceToolbar.isDeletingWorkspace}
                isCreatingWorkspace={workspaceToolbar.isCreatingWorkspace}
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
                onViewCosts={
                  hasApiAccess &&
                  !isWorkspaceInvitationSelected &&
                  ["owner", "admin"].includes(workspaceContext.selectedWorkspaceRole)
                    ? () => navigate(appPath({ workspaceId, page: "costs" }))
                    : undefined
                }
                onExportDocuments={documentToolbar.onExportDocuments}
                onWorkspacePrimaryAction={workspaceToolbar.onWorkspacePrimaryAction}
                onDeleteTemplate={templateController.toolbar.onDeleteTemplate}
                onOpenJsonModal={templateController.toolbar.onOpenJsonModal}
                onDeleteDocument={documentToolbar.onDeleteDocument}
                canDownloadOriginal={documentToolbar.canDownloadOriginal}
                isDownloadingOriginal={documentToolbar.isDownloadingOriginal}
                onDownloadOriginal={documentToolbar.onDownloadOriginal}
              />
            ) : null}

            {routeLoading ? <LoadingState variant="panel" label="Loading…" /> : null}
            {!routeLoading && visiblePage === "admin" ? (
              <ApplicationAdminPage admin={adminController} breadcrumbs={headerBreadcrumbs} />
            ) : null}

            {!routeLoading && visiblePage === "costs" ? (
              <WorkspaceCosts
                key={`${sessionUserId}:${workspaceId}`}
                workspaceId={workspaceId}
                workspaceCrumb={workspaceCrumb}
                role={hasApiAccess ? workspaceContext.selectedWorkspaceRole : null}
                request={coreRequest}
                tab={route.costTab}
                onTab={(costTab) => navigate(appPath({ workspaceId, page: "costs", costTab }))}
              />
            ) : null}

            {!routeLoading && visiblePage === "workspace" ? (
              isWorkspaceInvitationSelected && workspaceContext.selectedWorkspaceInvitation ? (
                <WorkspaceInvitationPage {...workspaceController.invitationPage} />
              ) : (
                <AcceptedWorkspacePage
                  {...workspaceController.acceptedPage}
                  workspaceId={workspaceId}
                  workspaceRole={workspaceContext.selectedWorkspaceRole}
                  modelConfiguration={workspaceModel}
                  sourceRetention={workspaceSourceRetention}
                  processingSettings={workspaceDocumentProcessing}
                  modelConfigurationKey={`${sessionUserId}:${workspaceId}`}
                />
              )
            ) : null}

            {!routeLoading && visiblePage === "templates" ? <TemplatePage {...templateController.templatePage} /> : null}
            {!routeLoading && visiblePage === "evaluations" ? (
              <EvaluationsPage
                evaluation={evaluation}
                toast={toast}
                templates={templates}
                enabled={hasApiAccess}
                onTemplateSaved={templateController.actions.listTemplates}
                maxSourceFileBytes={maxSourceFileBytes}
                suggestedModels={documentController.contextList.availableModels}
                workspaceCrumb={workspaceCrumb}
                onOpenWorkspace={() => setActivePage("workspace")}
              />
            ) : null}
            {!routeLoading && visiblePage === "documents" ? (
              <>
                <DocumentLifecycleAnnouncer documents={documentController.contextList.documents} />
                <DocumentPage
                  {...documentController.documentPage}
                  viewingLayout={documentViewingLayout}
                  onViewingLayoutChange={setDocumentViewingLayout}
                  sourceStorageConfigured={sourceStorageConfigured}
                />
              </>
            ) : null}
          </>
        ) : null}
      </MainLayout>
    </>
  );
}

// Renders nothing; keeps document.title in step with the open page and selection.
function DocumentTitle(parts) {
  useDocumentTitle(parts);

  return null;
}

// Keeps the app frame while the session loads, so the sign-in screen never flashes in.
function AppLoadingShell() {
  return (
    <div className="app-frame">
      <aside className="left-sidebar" aria-hidden="true">
        <div className="sidebar-brand">
          <div className="sidebar-brand-text">
            <p className="eyebrow">Document Extraction</p>
          </div>
        </div>
        <div className="sidebar-spacer" />
      </aside>
      <main className="main-content">
        <LoadingState variant="panel" label="Loading…" />
      </main>
    </div>
  );
}

function AccountPasswordResetRoute({ resetState, onResetComplete, authOptions, createAuthClient, toast }) {
  const [isRequestingNewLink, setIsRequestingNewLink] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const authClient = useMemo(() => createAuthClient(), [createAuthClient]);
  useDocumentTitle({ page: "Reset password" });

  const authProfileController = useAuthProfileController({
    toast,
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
    const unmetPasswordRequirements = ACCOUNT_PASSWORD_REQUIREMENTS.flatMap((requirement) =>
      requirement.test(newPassword) ? [] : [requirement.label],
    );

    const shouldShowPasswordRequirements = passwordTouched || submitAttempted;

    const hasPasswordMismatch = confirmNewPassword.length > 0 && newPassword !== confirmNewPassword;

    async function submitNewPassword(event) {
      event.preventDefault();
      setSubmitAttempted(true);

      const errors = {
        password: !newPassword.trim()
          ? "Enter a new password."
          : unmetPasswordRequirements.length > 0
            ? "Password doesn't meet all the requirements below."
            : "",
        confirmPassword: !confirmNewPassword.trim()
          ? "Confirm your new password."
          : hasPasswordMismatch
            ? "Passwords do not match."
            : "",
      };

      if (errors.password || errors.confirmPassword) {
        setFieldErrors(errors);
        setFormError("");
        document.getElementById(errors.password ? "reset-new-password" : "reset-confirm-password")?.focus();

        return;
      }

      setFieldErrors({});
      setFormError("");
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
        onResetComplete();
      } catch {
        setFormError("Password reset failed. Request a new reset link.");
      } finally {
        setBusy(false);
      }
    }

    return (
      <>
          <div className="auth-shell">
          <section className="auth-card">
            <div className="auth-header">
              <p className="eyebrow">Document Extraction</p>
              <h1>Studio</h1>
              <p>Choose a new password for your account.</p>
            </div>
            <form className="panel auth-panel" onSubmit={submitNewPassword}>
              <h2>Set new password</h2>
              <p className="muted">Your new password must meet the Account password policy.</p>
              <div className="row auth-form-grid">
                <Field label="New password" error={fieldErrors.password} className="auth-field">
                  <TextInput
                    id="reset-new-password"
                    type="password"
                    value={newPassword}
                    autoComplete="new-password"
                    aria-describedby={
                      shouldShowPasswordRequirements && unmetPasswordRequirements.length > 0
                        ? "reset-password-requirements"
                        : undefined
                    }
                    onChange={(event) => {
                      setNewPassword(event.target.value);
                      setPasswordTouched(true);
                      setFieldErrors((previous) => ({ ...previous, password: "" }));
                    }}
                  />
                </Field>
                <Field label="Confirm new password" error={fieldErrors.confirmPassword} className="auth-field">
                  <TextInput
                    id="reset-confirm-password"
                    type="password"
                    value={confirmNewPassword}
                    autoComplete="new-password"
                    onChange={(event) => {
                      setConfirmNewPassword(event.target.value);
                      setFieldErrors((previous) => ({ ...previous, confirmPassword: "" }));
                    }}
                    onBlur={() => {
                      if (confirmNewPassword && hasPasswordMismatch) {
                        setFieldErrors((previous) => ({ ...previous, confirmPassword: "Passwords do not match." }));
                      }
                    }}
                  />
                </Field>
              </div>
              {shouldShowPasswordRequirements && unmetPasswordRequirements.length > 0 ? (
                <ul id="reset-password-requirements" className="auth-password-requirements">
                  {unmetPasswordRequirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
              ) : null}
              {formError ? (
                <p role="alert" className="auth-form-error">
                  {formError}
                </p>
              ) : null}
              <Button type="submit" className="auth-primary-action" pending={busy} pendingLabel="Setting password…">
                Set new password
              </Button>
            </form>
          </section>
        </div>
      </>
    );
  }

  const isTokenError = resetState.error === "token";

  return (
    <>
      <div className="auth-shell">
        <section className="auth-card">
          <div className="auth-header">
            <p className="eyebrow">Document Extraction</p>
            <h1>Studio</h1>
            <p>Use Account password reset to recover access to your account.</p>
          </div>
          <div className="panel auth-verification-prompt" role="status">
            <h2>{isTokenError ? "Reset link has expired or is invalid" : "Reset link is missing or invalid"}</h2>
            <p>
              {isTokenError
                ? "This Account password reset link can no longer be used."
                : "Request a new Account password reset link to continue."}
            </p>
            <Button className="auth-primary-action" disabled={busy} onClick={() => setIsRequestingNewLink(true)}>
              Request a new reset link
            </Button>
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

// Each packet tab counts as its own selection so switching tabs fades like opening a document.
// An opening packet keys on the tab it is opening, so the fade runs once rather than again on load.
function packetContentSelection({ selectedPacketId, packetPage }) {
  if (!selectedPacketId) return "";
  const tab = packetPage.isOpeningDocument ? packetPage.pendingDocumentId : packetPage.activeDocumentId;

  return `${selectedPacketId}:${tab || "overview"}`;
}
