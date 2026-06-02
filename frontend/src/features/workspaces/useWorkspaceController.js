import { useEffect, useMemo, useRef, useState } from "react";

import { createWorkspaceRequestLayer } from "../../lib/appRuntime";
import {
  getAcceptWorkspaceInvitationTransition,
  getCancelWorkspaceInvitationTransition,
  getDeclineWorkspaceInvitationTransition,
  getInviteWorkspaceInvitationTransition,
  getLeaveWorkspaceTransition,
  getWorkspacePrimaryAction,
  getWorkspaceMemberActionTransition,
  getWorkspaceContextDisplay,
  resolveAcceptedWorkspaceContext,
  selectPendingWorkspaceInvitationContext,
  selectAcceptedWorkspaceContext,
} from "../../lib/workspaceSelection";

const WORKSPACE_STORAGE_KEY = "documentextraction.workspace.v1";
export const DEFAULT_WORKSPACE_ID = "workspace_local_default";
const NEW_WORKSPACE_NAME = "New Workspace";

export function loadPersistedWorkspace() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const workspaceId = String(parsed.workspaceId || "").trim();
    if (!workspaceId || workspaceId === DEFAULT_WORKSPACE_ID) {
      return null;
    }

    return {
      workspaceId,
      workspaceName: String(parsed.workspaceName || "").trim(),
    };
  } catch {
    return null;
  }
}

export function clearPersistedWorkspace() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  }
}

export function useWorkspaceController({
  apiBase,
  coreRequest,
  addLog,
  showActionToast,
  hasSession,
  sessionUserId,
  isAppBusy,
  setBusy,
  onActivePageChange,
  onClearWorkspaceScopedData,
  onClearCompletedDocumentCache,
}) {
  const initialWorkspaceRef = useRef(loadPersistedWorkspace());
  const initialWorkspace = initialWorkspaceRef.current || {};

  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [userWorkspaces, setUserWorkspaces] = useState([]);
  const [userWorkspaceInvitations, setUserWorkspaceInvitations] = useState([]);
  const [workspaceResolutionStatus, setWorkspaceResolutionStatus] =
    useState("idle");
  const [selectedWorkspaceInvitationId, setSelectedWorkspaceInvitationId] =
    useState("");
  const [workspaceUsers, setWorkspaceUsers] = useState([]);
  const [isLoadingWorkspaceUsers, setIsLoadingWorkspaceUsers] =
    useState(false);
  const [workspaceInvitations, setWorkspaceInvitations] = useState([]);
  const [workspaceUserActionTarget, setWorkspaceUserActionTarget] =
    useState(null);
  const [isAcceptingWorkspaceInvitation, setIsAcceptingWorkspaceInvitation] =
    useState(false);
  const [isDecliningWorkspaceInvitation, setIsDecliningWorkspaceInvitation] =
    useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");

  const isRecoveringForbiddenWorkspaceRef = useRef(false);
  const workspaceUsersRequestRef = useRef(0);

  const normalizedWorkspaceId = workspaceId.trim();
  const hasWorkspaceContext =
    workspaceResolutionStatus === "resolved" &&
    Boolean(normalizedWorkspaceId) &&
    normalizedWorkspaceId !== DEFAULT_WORKSPACE_ID;
  const hasApiAccess = hasSession && hasWorkspaceContext;
  const isWorkspaceContextLoading =
    hasSession &&
    (workspaceResolutionStatus === "idle" ||
      workspaceResolutionStatus === "loading");
  const hasWorkspaceResolutionError =
    hasSession && workspaceResolutionStatus === "error";

  const { request } = createWorkspaceRequestLayer({
    coreRequest,
    hasSession,
    workspaceId,
    onForbiddenWorkspaceAccess: recoverForbiddenWorkspaceAccess,
  });

  const workspaceContextDisplay = useMemo(
    () =>
      getWorkspaceContextDisplay({
        apiBase,
        hasApiAccess,
        workspaceId,
        workspaceName,
        selectedWorkspaceInvitationId,
        userWorkspaces,
        userWorkspaceInvitations,
      }),
    [
      apiBase,
      hasApiAccess,
      selectedWorkspaceInvitationId,
      workspaceId,
      workspaceName,
      userWorkspaceInvitations,
      userWorkspaces,
    ],
  );
  const availableWorkspaces = workspaceContextDisplay.availableWorkspaces;
  const workspaceUserManagement =
    workspaceContextDisplay.workspaceSelectionView.userManagement;
  const canListWorkspaceUsers = Boolean(
    workspaceUserManagement?.canListWorkspaceUsers,
  );
  const canManageWorkspaceInvitations = Boolean(
    workspaceUserManagement?.canManageWorkspaceInvitations,
  );
  const selectedWorkspace = userWorkspaces.find(
    (workspace) => String(workspace?.id || "") === String(workspaceId || ""),
  );
  const selectedWorkspaceRole = String(selectedWorkspace?.role || "");
  const selectedWorkspaceHasApiKey = Boolean(
    selectedWorkspace?.has_api_key,
  );
  const billingOperationalStatus = normalizeBillingOperationalStatus(
    selectedWorkspace?.billing_operational_status,
  );
  const billingPlanLimits = normalizeBillingPlanLimits(
    selectedWorkspace?.billing_plan_limits,
  );
  const billingUsageSummary = normalizeBillingUsageSummary(
    selectedWorkspace?.billing_usage_summary,
  );
  const isBillingSubmissionBlocked =
    billingOperationalStatus.blocking_reasons.length > 0;
  const hasWorkspaceBillingAuthority =
    !selectedWorkspaceInvitationId.trim() &&
    selectedWorkspaceRole.trim().toLowerCase() === "owner";
  const workspaceApiKeyActionLabel = selectedWorkspaceHasApiKey
    ? "Rotate API Key"
    : "Generate API Key";
  const workspaceApiKeyPlaceholder = selectedWorkspaceHasApiKey
    ? "Rotate API key to view again"
    : "Generate an API key to view";
  const canRotateWorkspaceApiKey = ["owner", "admin"].includes(
    selectedWorkspaceRole.trim().toLowerCase(),
  );
  const workspacePrimaryAction = getWorkspacePrimaryAction({
    workspaceRole: selectedWorkspaceRole,
  });

  const filteredWorkspaces = useMemo(() => {
    const query = workspaceSearch.trim().toLowerCase();
    if (!query) {
      return availableWorkspaces;
    }

    return availableWorkspaces.filter((workspace) => {
      const searchable = [
        workspace.id,
        workspace.name,
        workspace.inviter_name,
        workspace.inviter_email,
        workspace.inviter_display,
        workspace.email,
        workspace.role,
      ].map((value) => String(value || "").toLowerCase());
      return searchable.some((value) => value.includes(query));
    });
  }, [availableWorkspaces, workspaceSearch]);

  const selectedWorkspaceName = workspaceContextDisplay.selectedWorkspaceName;
  const effectiveSelectedWorkspaceInvitationId =
    workspaceContextDisplay.selectedWorkspaceInvitationId;
  const workspaceSelectionView = workspaceContextDisplay.workspaceSelectionView;
  const selectedWorkspaceInvitation = workspaceSelectionView.invitation;
  const isWorkspaceInvitationSelected =
    workspaceSelectionView.type === "invitation";
  const workspaceUserActionOptions = useMemo(() => {
    if (!workspaceUserActionTarget) {
      return [];
    }
    return getWorkspaceUserActions(
      workspaceUserManagement,
      String(workspaceUserActionTarget.role || ""),
    );
  }, [workspaceUserActionTarget, workspaceUserManagement]);

  const isWorkspaceNameDirty =
    Boolean(workspaceId.trim()) &&
    workspaceName.trim() !== selectedWorkspaceName.trim();

  function canShowWorkspaceUserAction(user) {
    const role = String(user?.role || "")
      .trim()
      .toLowerCase();
    if (role === "owner") {
      return Boolean(workspaceUserManagement?.canShowOwnerActions);
    }
    if (role === "admin") {
      return Boolean(workspaceUserManagement?.canShowAdminActions);
    }
    return Boolean(workspaceUserManagement?.canShowMemberActions);
  }

  function applyAcceptedWorkspaceContext(workspace) {
    const selection = selectAcceptedWorkspaceContext({ workspace });
    applyWorkspaceContextUpdate(selection);
    return selection;
  }

  function clearWorkspaceScopedData({ isSwitchingAcceptedWorkspace = false } = {}) {
    onClearWorkspaceScopedData?.();
    workspaceUsersRequestRef.current += 1;
    setWorkspaceUsers([]);
    setIsLoadingWorkspaceUsers(isSwitchingAcceptedWorkspace);
    setWorkspaceInvitations([]);
  }

  function applyWorkspaceContextUpdate(nextWorkspaceContext) {
    if (!nextWorkspaceContext) {
      return null;
    }

    const nextWorkspaceId = Object.prototype.hasOwnProperty.call(
      nextWorkspaceContext,
      "workspaceId",
    )
      ? String(nextWorkspaceContext.workspaceId || "")
      : workspaceId;
    if (String(nextWorkspaceId || "") !== String(workspaceId || "")) {
      if (String(workspaceId || "")) {
        onClearCompletedDocumentCache?.();
      }
      const nextSelectedWorkspaceInvitationId = Object.prototype.hasOwnProperty.call(
        nextWorkspaceContext,
        "selectedWorkspaceInvitationId",
      )
        ? String(nextWorkspaceContext.selectedWorkspaceInvitationId || "")
        : selectedWorkspaceInvitationId;
      clearWorkspaceScopedData({
        isSwitchingAcceptedWorkspace:
          hasSession &&
          Boolean(String(nextWorkspaceId || "").trim()) &&
          !String(nextSelectedWorkspaceInvitationId || "").trim(),
      });
    }

    if (Object.prototype.hasOwnProperty.call(nextWorkspaceContext, "workspaceId")) {
      setWorkspaceId(nextWorkspaceContext.workspaceId);
    }
    if (Object.prototype.hasOwnProperty.call(nextWorkspaceContext, "workspaceName")) {
      setWorkspaceName(nextWorkspaceContext.workspaceName);
    }
    if (
      Object.prototype.hasOwnProperty.call(
        nextWorkspaceContext,
        "selectedWorkspaceInvitationId",
      )
    ) {
      setSelectedWorkspaceInvitationId(
        nextWorkspaceContext.selectedWorkspaceInvitationId,
      );
    }
    if (Object.prototype.hasOwnProperty.call(nextWorkspaceContext, "apiKey")) {
      setApiKey(nextWorkspaceContext.apiKey);
    }

    return nextWorkspaceContext;
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (hasSession && workspaceResolutionStatus !== "resolved") {
      return;
    }

    const storedWorkspaceId = workspaceId.trim();
    if (!storedWorkspaceId || storedWorkspaceId === DEFAULT_WORKSPACE_ID) {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      return;
    }

    const payload = { workspaceId: storedWorkspaceId, workspaceName };
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
  }, [hasSession, workspaceResolutionStatus, workspaceName, workspaceId]);

  async function copyWorkspaceApiKeyToClipboard(keyMaterial) {
    if (!navigator.clipboard?.writeText) {
      return false;
    }
    try {
      await navigator.clipboard.writeText(keyMaterial);
      return true;
    } catch {
      return false;
    }
  }

  async function rotateWorkspaceApiKey(targetWorkspaceId = workspaceId) {
    const wasRotation = selectedWorkspaceHasApiKey;
    const data = await request(
      `/workspaces/${encodeURIComponent(targetWorkspaceId)}/api-key`,
      { method: "POST" },
      true,
      false,
    );

    setWorkspaceId(data.workspace_id || targetWorkspaceId);
    setApiKey(data.api_key || "");
    setUserWorkspaces((prev) =>
      prev.map((workspace) =>
        String(workspace?.id || "") === String(data.workspace_id || targetWorkspaceId)
          ? { ...workspace, has_api_key: true }
          : workspace,
      ),
    );
    const copied = data.api_key
      ? await copyWorkspaceApiKeyToClipboard(String(data.api_key))
      : false;
    addLog(
      `API key rotated for workspace: ${data.workspace_id || targetWorkspaceId}`,
    );
    showActionToast(
      wasRotation
        ? copied
          ? "workspace.apiKey.rotate.copied"
          : "workspace.apiKey.rotate.manualCopy"
        : copied
          ? "workspace.apiKey.generate.copied"
          : "workspace.apiKey.generate.manualCopy",
      "success",
      data,
    );
    return data;
  }

  async function copyVisibleWorkspaceApiKey() {
    if (!apiKey) {
      return;
    }
    await copyWorkspaceApiKeyToClipboard(apiKey);
  }

  async function createWorkspace(options = {}) {
    const silent = Boolean(options.silent);
    const nameForCreate = NEW_WORKSPACE_NAME;

    setBusy(true);
    try {
      if (!silent) {
        addLog("Creating workspace...");
      }
      const data = await request(
        "/workspaces",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nameForCreate }),
        },
        true,
        false,
      );
      if (String(data.workspace_id || "") !== String(workspaceId || "")) {
        onClearCompletedDocumentCache?.();
        clearWorkspaceScopedData();
      }
      setWorkspaceId(data.workspace_id || "");
      setWorkspaceName(data.name || NEW_WORKSPACE_NAME);
      setApiKey("");
      if (!silent) {
        addLog(`Workspace created: ${data.workspace_id || "unknown"}`);
        showActionToast("workspace.create", "success", {
          targetName: data.name || nameForCreate,
        });
      }
      await listWorkspaces({
        storedWorkspacePreference: {
          workspaceId: data.workspace_id || "",
          workspaceName: data.name || nameForCreate,
        },
      });
    } catch (error) {
      addLog(`Create workspace failed: ${error.message}`);
      if (!silent) {
        showActionToast("workspace.create", "failure", { error });
      }
    } finally {
      setBusy(false);
    }
  }

  async function refreshApiKey() {
    if (!hasWorkspaceContext) {
      addLog("Refresh API key failed: select or create a workspace first");
      return;
    }

    const targetWorkspaceId = normalizedWorkspaceId;
    if (
      selectedWorkspaceHasApiKey &&
      !window.confirm(
        "Rotate this Workspace API key? Existing external clients using the current key will stop working.",
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      await rotateWorkspaceApiKey(targetWorkspaceId);
    } catch (error) {
      addLog(`Refresh API key failed: ${error.message}`);
      showActionToast("workspace.apiKey.rotate", "failure", { error });
    } finally {
      setBusy(false);
    }
  }

  async function listWorkspaces(options = {}) {
    if (!hasSession) {
      return;
    }

    try {
      const [workspaceData, invitationData] = await Promise.all([
        request("/workspaces", { method: "GET" }, true, false),
        request("/invitations", { method: "GET" }, true, false),
      ]);
      const workspaces = Array.isArray(workspaceData?.workspaces)
        ? workspaceData.workspaces
        : [];
      const invitations = Array.isArray(invitationData?.invitations)
        ? invitationData.invitations
        : [];
      setUserWorkspaces(workspaces);
      setUserWorkspaceInvitations(invitations);
      const resolution = resolveAcceptedWorkspaceContext({
        storedWorkspacePreference:
          options.storedWorkspacePreference ||
          (workspaceId.trim()
            ? { workspaceId, workspaceName }
            : initialWorkspaceRef.current),
        userWorkspaces: workspaces,
        userWorkspaceInvitations: invitations,
      });
      applyWorkspaceContextUpdate(resolution.nextWorkspaceContext);
      setWorkspaceResolutionStatus(resolution.type === "resolved" ? "resolved" : "error");
      return { workspaces, invitations, resolution };
    } catch (error) {
      addLog(`List workspaces failed: ${error.message}`);
      setWorkspaceResolutionStatus("error");
      throw error;
    }
  }

  function retryWorkspaceResolution() {
    setWorkspaceResolutionStatus("loading");
    void listWorkspaces().catch(() => {});
  }

  async function recoverForbiddenWorkspaceAccess() {
    if (isRecoveringForbiddenWorkspaceRef.current) {
      return;
    }

    isRecoveringForbiddenWorkspaceRef.current = true;
    try {
      const refresh = await listWorkspaces();
      const nextWorkspace = refresh?.resolution?.workspace;
      if (nextWorkspace?.id) {
        showActionToast("workspace.access.changed", "success", {
          targetName: nextWorkspace.name || nextWorkspace.id,
        });
      }
    } catch {
      // listWorkspaces already records the retryable resolution failure.
    } finally {
      isRecoveringForbiddenWorkspaceRef.current = false;
    }
  }

  async function listWorkspaceUsers(targetWorkspaceId = workspaceId) {
    const normalizedTargetWorkspaceId = String(targetWorkspaceId || "").trim();
    const requestId = workspaceUsersRequestRef.current + 1;
    workspaceUsersRequestRef.current = requestId;
    if (!hasSession || !normalizedTargetWorkspaceId || !canListWorkspaceUsers) {
      setWorkspaceUsers([]);
      setIsLoadingWorkspaceUsers(false);
      return;
    }

    setIsLoadingWorkspaceUsers(true);
    try {
      const data = await request(
        `/workspaces/${encodeURIComponent(normalizedTargetWorkspaceId)}/users`,
        { method: "GET" },
        true,
        false,
      );
      if (workspaceUsersRequestRef.current !== requestId) {
        return;
      }
      setWorkspaceUsers(Array.isArray(data?.users) ? data.users : []);
    } catch (error) {
      if (workspaceUsersRequestRef.current !== requestId) {
        return;
      }
      setWorkspaceUsers([]);
      addLog(`List workspace users failed: ${error.message}`);
    } finally {
      if (workspaceUsersRequestRef.current === requestId) {
        setIsLoadingWorkspaceUsers(false);
      }
    }
  }

  async function listWorkspaceInvitations(targetWorkspaceId = workspaceId) {
    const normalizedTargetWorkspaceId = String(targetWorkspaceId || "").trim();
    if (!hasSession || !normalizedTargetWorkspaceId || !canManageWorkspaceInvitations) {
      setWorkspaceInvitations([]);
      return;
    }

    try {
      const data = await request(
        `/workspaces/${encodeURIComponent(normalizedTargetWorkspaceId)}/invitations`,
        { method: "GET" },
        true,
        false,
      );
      setWorkspaceInvitations(
        Array.isArray(data?.invitations) ? data.invitations : [],
      );
    } catch (error) {
      setWorkspaceInvitations([]);
      addLog(`List workspace invitations failed: ${error.message}`);
    }
  }

  async function applyWorkspaceUserAction(targetUserId, action) {
    const transition = getWorkspaceMemberActionTransition({
      workspaceId,
      targetUserId,
      action,
    });
    if (transition.reason === "missing_accepted_workspace_context") {
      addLog("User update failed: select a workspace first");
      return;
    }
    if (transition.reason === "missing_target_workspace_user") {
      return;
    }
    const targetWorkspaceUser = workspaceUsers.find(
      (user) => String(user?.user_id || "").trim() === String(targetUserId || "").trim(),
    );
    const targetDisplay =
      String(targetWorkspaceUser?.name || "").trim() ||
      String(targetWorkspaceUser?.email || "").trim() ||
      String(targetUserId || "").trim();
    const actionToast = getWorkspaceMemberActionToastAction(action);

    setBusy(true);
    try {
      const data = await request(
        transition.request.path,
        {
          method: transition.request.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(transition.request.body),
        },
        true,
        false,
      );
      const workspaces = await listWorkspaces();
      const successTransition = getWorkspaceMemberActionTransition({
        workspaceId,
        targetUserId,
        action,
        actionResult: data || {},
        refreshedUserWorkspaces: workspaces,
      });
      if (successTransition.nextWorkspaceContext) {
        applyWorkspaceContextUpdate(successTransition.nextWorkspaceContext);
      }
      if (successTransition.refresh.includes("workspaceUsers")) {
        await listWorkspaceUsers(successTransition.workspaceId);
      }
      showActionToast(actionToast, "success", { targetName: targetDisplay });
      addLog(`User updated (${successTransition.action.replace(/_/g, " ")})`);
    } catch (error) {
      getWorkspaceMemberActionTransition({
        workspaceId,
        targetUserId,
        action,
        actionError: error,
      });
      showActionToast(actionToast, "failure", { error });
      addLog(`User update failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function inviteUser() {
    const transition = getInviteWorkspaceInvitationTransition({
      workspaceId,
      email: inviteEmail,
      role: inviteRole,
    });
    if (transition.reason === "missing_accepted_workspace_context") {
      addLog("Invite failed: select a workspace first");
      return;
    }
    if (transition.reason === "missing_invitation_email") {
      showActionToast("workspaceInvitation.create", "validation", { reason: "email" });
      addLog("Invite failed: email is required");
      return;
    }

    setBusy(true);
    try {
      const data = await request(transition.request.path, {
        method: transition.request.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transition.request.body),
      });
      const successTransition = getInviteWorkspaceInvitationTransition({
        workspaceId,
        email: inviteEmail,
        role: inviteRole,
        inviteResult: data || {},
      });
      showActionToast("workspaceInvitation.create", "success", {
        targetEmail: successTransition.email,
      });
      addLog(`Invitation sent to ${successTransition.email}`);
      setInviteEmail("");
      if (successTransition.refresh.includes("pendingWorkspaceInvitations")) {
        await listWorkspaceInvitations(successTransition.workspaceId);
      }
    } catch (error) {
      getInviteWorkspaceInvitationTransition({
        workspaceId,
        email: inviteEmail,
        role: inviteRole,
        inviteError: error,
      });
      showActionToast("workspaceInvitation.create", "failure", { error });
      addLog(`Invite failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function cancelWorkspaceInvitation(invitation) {
    const transition = getCancelWorkspaceInvitationTransition({ workspaceId, invitation });
    if (transition.reason === "missing_accepted_workspace_context") {
      addLog("Cancel invitation failed: select a workspace first");
      return;
    }
    if (transition.reason === "missing_pending_workspace_invitation") {
      addLog("Cancel invitation failed: select a pending invitation first");
      return;
    }
    if (transition.requiresConfirmation && !window.confirm(transition.confirmationMessage)) {
      return;
    }
    const requestTransition = getCancelWorkspaceInvitationTransition({
      workspaceId,
      invitation,
      confirmed: true,
    });

    setBusy(true);
    try {
      const data = await request(
        requestTransition.request.path,
        { method: requestTransition.request.method },
        true,
        false,
      );
      const successTransition = getCancelWorkspaceInvitationTransition({
        workspaceId,
        invitation,
        cancelResult: data || {},
      });
      if (successTransition.refresh.includes("pendingWorkspaceInvitations")) {
        await listWorkspaceInvitations(successTransition.workspaceId);
      }
      showActionToast("workspaceInvitation.cancel", "success", {
        targetEmail: successTransition.invitationEmail,
      });
      addLog(`Invitation cancelled for ${successTransition.invitationEmail}`);
    } catch (error) {
      getCancelWorkspaceInvitationTransition({ workspaceId, invitation, cancelError: error });
      showActionToast("workspaceInvitation.cancel", "failure", { error });
      addLog(`Cancel invitation failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function acceptSelectedWorkspaceInvitation() {
    const transition = getAcceptWorkspaceInvitationTransition({ selectedWorkspaceInvitation });
    if (transition.reason === "missing_selected_workspace_invitation") {
      addLog("Accept invitation failed: select a pending invitation first");
      return;
    }
    if (transition.reason === "selected_workspace_invitation_not_pending") {
      addLog("Accept invitation failed: only pending invitations can be accepted");
      return;
    }

    setIsAcceptingWorkspaceInvitation(true);
    try {
      const data = await request(
        transition.request.path,
        { method: transition.request.method },
        true,
        false,
      );
      const workspaces = await listWorkspaces();
      const successTransition = getAcceptWorkspaceInvitationTransition({
        selectedWorkspaceInvitation,
        acceptResult: data,
        refreshedUserWorkspaces: workspaces,
      });
      if (successTransition.nextWorkspaceContext) {
        applyWorkspaceContextUpdate(successTransition.nextWorkspaceContext);
      }
      showActionToast("workspaceInvitation.accept", "success");
      addLog(
        `Invitation accepted for workspace ${successTransition.acceptedWorkspaceId || "unknown"}`,
      );
    } catch (error) {
      const failureTransition = getAcceptWorkspaceInvitationTransition({
        selectedWorkspaceInvitation,
        acceptError: error,
      });
      if (failureTransition.nextWorkspaceContext) {
        applyWorkspaceContextUpdate(failureTransition.nextWorkspaceContext);
      }
      showActionToast("workspaceInvitation.accept", "failure", { error });
      addLog(`Accept invitation failed: ${error.message}`);
    } finally {
      setIsAcceptingWorkspaceInvitation(false);
    }
  }

  async function declineSelectedWorkspaceInvitation() {
    const transition = getDeclineWorkspaceInvitationTransition({ selectedWorkspaceInvitation });
    if (transition.reason === "missing_selected_workspace_invitation") {
      addLog("Decline invitation failed: select a pending invitation first");
      return;
    }
    if (transition.reason === "selected_workspace_invitation_not_pending") {
      addLog("Decline invitation failed: only pending invitations can be declined");
      return;
    }

    setIsDecliningWorkspaceInvitation(true);
    try {
      await request(
        transition.request.path,
        { method: transition.request.method },
        true,
        false,
      );
      const successTransition = getDeclineWorkspaceInvitationTransition({
        selectedWorkspaceInvitation,
        declineResult: {},
      });
      if (successTransition.nextWorkspaceContext) {
        applyWorkspaceContextUpdate(successTransition.nextWorkspaceContext);
      }
      await listWorkspaces();
      showActionToast("workspaceInvitation.decline", "success");
      addLog(
        `Invitation declined for ${selectedWorkspaceInvitation.workspaceName || "workspace"}`,
      );
    } catch (error) {
      getDeclineWorkspaceInvitationTransition({ selectedWorkspaceInvitation, declineError: error });
      showActionToast("workspaceInvitation.decline", "failure", { error });
      addLog(`Decline invitation failed: ${error.message}`);
    } finally {
      setIsDecliningWorkspaceInvitation(false);
    }
  }

  async function saveWorkspaceChanges() {
    if (!workspaceId.trim()) {
      addLog("Save changes failed: select a workspace first");
      return;
    }
    if (isSavingWorkspace || !isWorkspaceNameDirty) {
      return;
    }

    setIsSavingWorkspace(true);
    try {
      await request(`/workspaces/${encodeURIComponent(workspaceId.trim())}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workspaceName.trim() }),
      });
      await listWorkspaces();
      addLog(`Workspace renamed to ${workspaceName.trim()}`);
      showActionToast("workspace.rename", "success", {
        targetName: workspaceName.trim(),
      });
    } catch (error) {
      addLog(`Save changes failed: ${error.message}`);
      showActionToast("workspace.rename", "failure", { error });
    } finally {
      setIsSavingWorkspace(false);
    }
  }

  async function deleteWorkspace() {
    if (!workspaceId.trim()) {
      addLog("Delete workspace failed: select a workspace first");
      return;
    }
    if (isDeletingWorkspace) {
      return;
    }

    const confirmed = window.confirm(
      `Delete workspace ${workspaceId.trim()}? This action cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setIsDeletingWorkspace(true);
    try {
      await request(`/workspaces/${encodeURIComponent(workspaceId.trim())}`, {
        method: "DELETE",
      });
      onClearCompletedDocumentCache?.();
      setWorkspaceId("");
      setWorkspaceName("");
      setApiKey("");
      await listWorkspaces();
      addLog("Workspace deleted");
      showActionToast("workspace.delete", "success");
    } catch (error) {
      addLog(`Delete workspace failed: ${error.message}`);
      showActionToast("workspace.delete", "failure", { error });
    } finally {
      setIsDeletingWorkspace(false);
    }
  }

  async function leaveWorkspace() {
    const transition = getLeaveWorkspaceTransition({ workspaceId });
    if (transition.reason === "missing_accepted_workspace_context") {
      addLog("Leave workspace failed: select a workspace first");
      return;
    }
    if (isDeletingWorkspace) {
      return;
    }

    const confirmed = window.confirm(transition.confirmationMessage);
    if (!confirmed) {
      return;
    }

    const requestTransition = getLeaveWorkspaceTransition({ workspaceId, confirmed: true });
    setIsDeletingWorkspace(true);
    try {
      const data = await request(
        requestTransition.request.path,
        { method: requestTransition.request.method },
        true,
        false,
      );
      const leftWorkspaceId = requestTransition.workspaceId;
      const workspaces = await listWorkspaces();
      const successTransition = getLeaveWorkspaceTransition({
        workspaceId: leftWorkspaceId,
        leaveResult: data,
        refreshedUserWorkspaces: workspaces,
      });
      if (successTransition.nextWorkspaceContext) {
        applyWorkspaceContextUpdate(successTransition.nextWorkspaceContext);
      }
      addLog("Workspace left");
      showActionToast("workspace.leave", "success", {
        replacementPersonalWorkspaceCreated: Boolean(data?.replacement_workspace),
      });
    } catch (error) {
      getLeaveWorkspaceTransition({ workspaceId, leaveError: error });
      addLog(`Leave workspace failed: ${error.message}`);
      showActionToast("workspace.leave", "failure", { error });
    } finally {
      setIsDeletingWorkspace(false);
    }
  }

  function runWorkspacePrimaryAction() {
    if (workspacePrimaryAction.type === "leave") {
      void leaveWorkspace();
      return;
    }
    void deleteWorkspace();
  }

  function selectInvitedWorkspace(workspace) {
    applyWorkspaceContextUpdate(
      selectPendingWorkspaceInvitationContext({
        invitation: { id: workspace.invitation_id },
      }),
    );
    onActivePageChange("workspace");
    addLog(`Selected invitation for workspace ${workspace.id}`);
  }

  function selectAcceptedWorkspace(workspace) {
    applyAcceptedWorkspaceContext(workspace);
    addLog(`Switched workspace context to ${workspace.id}`);
  }

  function clearSessionWorkspaceData() {
    onClearCompletedDocumentCache?.();
    setApiKey("");
    setWorkspaceId("");
    setWorkspaceName("");
    clearWorkspaceScopedData();
    setUserWorkspaces([]);
    setUserWorkspaceInvitations([]);
    setSelectedWorkspaceInvitationId("");
    setWorkspaceResolutionStatus("idle");
    setIsLoadingWorkspaceUsers(false);
    clearPersistedWorkspace();
  }

  useEffect(() => {
    if (!hasSession) {
      setWorkspaceResolutionStatus("idle");
      return;
    }

    setWorkspaceResolutionStatus("loading");
    void listWorkspaces().catch(() => {});
  }, [hasSession]);

  useEffect(() => {
    if (!hasSession || !workspaceId.trim()) {
      setWorkspaceUsers([]);
      setIsLoadingWorkspaceUsers(false);
      setWorkspaceInvitations([]);
      return;
    }

    void listWorkspaceUsers(workspaceId.trim());
    void listWorkspaceInvitations(workspaceId.trim());
  }, [canListWorkspaceUsers, canManageWorkspaceInvitations, hasSession, workspaceId]);

  return {
    initialWorkspace,
    request,
    context: {
      workspaceId,
      workspaceName,
      hasWorkspaceContext,
      hasApiAccess,
      hasWorkspaceApiAccess: workspaceSelectionView.hasWorkspaceApiAccess,
      canSubmitDocuments:
        workspaceSelectionView.hasWorkspaceApiAccess &&
        !isBillingSubmissionBlocked,
      billingOperationalStatus,
      isBillingSubmissionBlocked,
      isWorkspaceContextLoading,
      hasWorkspaceResolutionError,
      isWorkspaceInvitationSelected,
      selectedWorkspaceInvitation,
      availableWorkspaces,
      workspaceSelectionView,
      selectedWorkspaceRole,
      billingPlanLimits,
      billingUsageSummary,
      hasWorkspaceBillingAuthority,
      canManageWorkspaceInvitations,
    },
    sidebar: {
      search: workspaceSearch,
      workspaces: filteredWorkspaces,
      selectedWorkspaceId: workspaceId || DEFAULT_WORKSPACE_ID,
      selectedWorkspaceInvitationId: effectiveSelectedWorkspaceInvitationId,
      isLoading: isWorkspaceContextLoading,
      hasResolutionError: hasWorkspaceResolutionError,
      onSearchChange: setWorkspaceSearch,
      onSelectAcceptedWorkspace: selectAcceptedWorkspace,
      onSelectInvitedWorkspace: selectInvitedWorkspace,
      onRetryResolution: retryWorkspaceResolution,
    },
    toolbar: {
      workspaceLabel: isWorkspaceContextLoading
        ? "Loading workspace context"
        : hasWorkspaceResolutionError
          ? "Workspace resolution error"
          : workspaceSelectionView.workspaceName,
      workspaceId,
      workspacePrimaryAction,
      isDeletingWorkspace,
      onCreateWorkspace: createWorkspace,
      onWorkspacePrimaryAction: runWorkspacePrimaryAction,
    },
    acceptedPage: {
      workspaceName,
      onWorkspaceNameChange: setWorkspaceName,
      isSavingWorkspace,
      isWorkspaceNameDirty,
      onSaveWorkspaceChanges: saveWorkspaceChanges,
      apiKey,
      workspaceApiKeyPlaceholder,
      onCopyVisibleWorkspaceApiKey: copyVisibleWorkspaceApiKey,
      busy: isAppBusy,
      canRotateWorkspaceApiKey,
      workspaceApiKeyActionLabel,
      onRefreshApiKey: refreshApiKey,
      inviteEmail,
      onInviteEmailChange: setInviteEmail,
      inviteRole,
      onInviteRoleChange: setInviteRole,
      hasApiAccess,
      onInviteUser: inviteUser,
      isLoadingWorkspaceUsers,
      workspaceUsers,
      canShowWorkspaceUserAction,
      sessionUserId,
      onSelectWorkspaceUserActionTarget: setWorkspaceUserActionTarget,
      canManageWorkspaceInvitations,
      workspaceInvitations,
      onCancelWorkspaceInvitation: cancelWorkspaceInvitation,
    },
    invitationPage: {
      invitation: selectedWorkspaceInvitation,
      isAcceptingWorkspaceInvitation,
      isDecliningWorkspaceInvitation,
      onAcceptInvitation: acceptSelectedWorkspaceInvitation,
      onDeclineInvitation: declineSelectedWorkspaceInvitation,
    },
    userActionModal: {
      target: workspaceUserActionTarget,
      options: workspaceUserActionOptions,
      onClose: () => setWorkspaceUserActionTarget(null),
      onApplyAction: (action) => {
        if (!workspaceUserActionTarget) {
          return;
        }
        void applyWorkspaceUserAction(workspaceUserActionTarget.user_id, action);
        setWorkspaceUserActionTarget(null);
      },
    },
    actions: {
      clearSessionWorkspaceData,
      recoverForbiddenWorkspaceAccess,
      listWorkspaces,
    },
  };
}

function getWorkspaceUserActions(userManagement, targetRole) {
  const target = String(targetRole || "")
    .trim()
    .toLowerCase();

  if (target === "owner") {
    return userManagement?.canShowOwnerActions ? ["make_admin"] : [];
  }
  if (target === "admin") {
    return userManagement?.canShowAdminActions
      ? ["remove_user", "make_owner"]
      : [];
  }
  if (target === "member" && userManagement?.canShowOwnerActions) {
    return ["remove_user", "make_admin", "make_owner"];
  }
  if (target === "member" && userManagement?.canShowMemberActions) {
    return ["remove_user"];
  }
  return [];
}

function normalizeBillingOperationalStatus(value) {
  const blockingReasons = Array.isArray(value?.blocking_reasons)
    ? value.blocking_reasons
        .map((reason) => String(reason || "").trim())
        .filter(Boolean)
    : [];
  return {
    status: blockingReasons.length ? "blocked" : String(value?.status || "active"),
    blocking_reasons: blockingReasons,
  };
}

function normalizeBillingPlanLimits(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    templates: normalizePlanLimitCount(value.templates),
    top_level_template_fields: normalizePlanLimitCount(
      value.top_level_template_fields,
    ),
    table_shaped_fields: normalizePlanLimitCount(value.table_shaped_fields),
    table_columns_per_field: normalizePlanLimitCount(
      value.table_columns_per_field,
    ),
    members: normalizePlanLimitCount(value.members),
    monthly_pages: normalizePlanLimitCount(value.monthly_pages),
    api_access: Boolean(value.api_access),
  };
}

function normalizeBillingUsageSummary(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    remaining_credits: normalizePlanLimitCount(value.remaining_credits),
    remaining_pages: normalizePlanLimitCount(value.remaining_pages),
  };
}

function normalizePlanLimitCount(value) {
  if (value === null) {
    return null;
  }

  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return undefined;
  }
  return number;
}

export function workspaceUserActionLabel(action) {
  if (action === "remove_user") {
    return "Remove User";
  }
  if (action === "make_admin") {
    return "Make Admin";
  }
  if (action === "make_owner") {
    return "Make Owner";
  }
  return "Action";
}

function getWorkspaceMemberActionToastAction(action) {
  if (action === "make_admin") {
    return "workspaceMember.makeAdmin";
  }
  if (action === "make_owner") {
    return "workspaceMember.transferOwnership";
  }
  return "workspaceMember.remove";
}
