import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createWorkspaceRequestLayer } from "../../lib/appRuntime";
import { createWorkspaceRequestAdapter } from "./workspaceRequestAdapter";
import {
  canShowWorkspaceUserAction,
  getWorkspaceContextDisplay,
  getWorkspaceMemberPermissions,
  getWorkspacePrimaryAction,
  getWorkspaceUserActions,
  resolveAcceptedWorkspace,
  selectAcceptedWorkspaceContext,
} from "../../lib/workspaceSelection";

const WORKSPACE_STORAGE_KEY = "documentextraction.workspace.v1";
const NEW_WORKSPACE_NAME = "New Workspace";
const JSON_HEADERS = { "Content-Type": "application/json" };

function loadStoredWorkspacePreference() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) || "null");
    const workspaceId = String(parsed?.workspaceId || "").trim();
    return workspaceId ? { workspaceId, workspaceName: String(parsed.workspaceName || "").trim() } : null;
  } catch {
    return null;
  }
}

export function useWorkspaceController({
  coreRequest,
  showActionToast,
  hasSession,
  sessionUserId,
  sessionId = sessionUserId,
  isAppBusy,
  setBusy,
  onActivePageChange,
  onClearWorkspaceScopedData,
  beforeWorkspaceSelection,
  requestedWorkspaceId = "",
  requestedInvitationId = "",
  onWorkspaceNavigation,
}) {
  const [storedWorkspacePreference] = useState(loadStoredWorkspacePreference);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [userWorkspaces, setUserWorkspaces] = useState([]);
  const [userWorkspaceInvitations, setUserWorkspaceInvitations] = useState([]);
  const [workspaceResolutionStatus, setWorkspaceResolutionStatus] = useState("idle");
  const [resolvedSessionId, setResolvedSessionId] = useState("");
  const [unavailableRoute, setUnavailableRoute] = useState(false);
  const routeRef = useRef(null);
  routeRef.current = { requestedWorkspaceId, requestedInvitationId, onWorkspaceNavigation, sessionId };
  const [selectedWorkspaceInvitationId, setSelectedWorkspaceInvitationId] = useState("");
  const [workspaceUsers, setWorkspaceUsers] = useState([]);
  const [isLoadingWorkspaceUsers, setIsLoadingWorkspaceUsers] = useState(false);
  const [workspaceInvitations, setWorkspaceInvitations] = useState([]);
  const [workspaceUserActionTarget, setWorkspaceUserActionTarget] = useState(null);
  const [isAcceptingWorkspaceInvitation, setIsAcceptingWorkspaceInvitation] = useState(false);
  const [isDecliningWorkspaceInvitation, setIsDecliningWorkspaceInvitation] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");

  const isRecoveringForbiddenWorkspaceRef = useRef(false);
  const workspaceUsersRequestRef = useRef(0);
  const applyWorkspaceContextUpdateRef = useRef(null);
  const hasSessionRef = useRef(hasSession);
  const requestRef = useRef(null);
  const workspaceRequestsRef = useRef(null);
  const workspaceIdRef = useRef(workspaceId);
  const workspaceNameRef = useRef(workspaceName);
  const resolutionRef = useRef(null);
  resolutionRef.current = { status: workspaceResolutionStatus, sessionId: resolvedSessionId, invitationId: selectedWorkspaceInvitationId, unavailable: unavailableRoute };
  // Selection changes invalidate synchronously in clearWorkspaceScopedData,
  // so a follow-up list started by that action survives the resulting render.
  const contextScope = JSON.stringify([hasSession, sessionId, requestedWorkspaceId, requestedInvitationId]);
  const contextScopeRef = useRef(contextScope);
  const contextGenerationRef = useRef(0);
  const contextRefreshRequestRef = useRef(0);
  const workspaceListRequestRef = useRef(0);
  if (contextScopeRef.current !== contextScope) {
    contextScopeRef.current = contextScope;
    contextGenerationRef.current += 1;
  }

  const normalizedWorkspaceId = workspaceId.trim();
  const hasWorkspaceContext = workspaceResolutionStatus === "resolved" && resolvedSessionId === sessionId &&
    (!requestedWorkspaceId || requestedWorkspaceId === normalizedWorkspaceId) && !unavailableRoute && Boolean(normalizedWorkspaceId);
  const hasApiAccess = hasSession && hasWorkspaceContext;
  const isWorkspaceContextLoading =
    hasSession && Boolean(workspaceResolutionStatus === "idle" || workspaceResolutionStatus === "loading" ||
      (workspaceResolutionStatus === "resolved" && (resolvedSessionId !== sessionId || (!unavailableRoute && requestedWorkspaceId && requestedWorkspaceId !== workspaceId))));
  const hasWorkspaceResolutionError = hasSession && workspaceResolutionStatus === "error";

  const { request } = createWorkspaceRequestLayer({
    coreRequest,
    hasSession,
    workspaceId,
    onForbiddenWorkspaceAccess: recoverForbiddenWorkspaceAccess,
  });
  const workspaceRequests = createWorkspaceRequestAdapter({ request });

  hasSessionRef.current = hasSession;
  requestRef.current = request;
  workspaceRequestsRef.current = workspaceRequests;
  workspaceIdRef.current = workspaceId;
  workspaceNameRef.current = workspaceName;

  const {
    availableWorkspaces,
    selectedWorkspaceName,
    selectedWorkspaceInvitationId: effectiveSelectedWorkspaceInvitationId,
    workspaceSelectionView,
  } = useMemo(
    () =>
      getWorkspaceContextDisplay({
        hasApiAccess,
        workspaceId,
        workspaceName,
        selectedWorkspaceInvitationId,
        userWorkspaces,
        userWorkspaceInvitations,
      }),
    [hasApiAccess, selectedWorkspaceInvitationId, workspaceId, workspaceName, userWorkspaceInvitations, userWorkspaces],
  );
  const selectedWorkspaceInvitation = workspaceSelectionView.invitation;
  const isWorkspaceInvitationSelected = workspaceSelectionView.type === "invitation";
  const selectedWorkspace = userWorkspaces.find((workspace) => String(workspace.id || "") === workspaceId);
  const selectedWorkspaceRole = String(selectedWorkspace?.role || "");
  const selectedWorkspaceHasApiKey = Boolean(selectedWorkspace?.has_api_key);
  const canRotateWorkspaceApiKey = ["owner", "admin"].includes(selectedWorkspaceRole.trim().toLowerCase());
  const workspacePrimaryAction = getWorkspacePrimaryAction(selectedWorkspaceRole);
  const memberPermissions = getWorkspaceMemberPermissions(
    isWorkspaceInvitationSelected ? "" : selectedWorkspaceRole,
  );
  const canListWorkspaceUsers = memberPermissions.canListUsers;
  const canManageWorkspaceInvitations = memberPermissions.canManage;
  const isWorkspaceNameDirty =
    Boolean(normalizedWorkspaceId) && workspaceName.trim() !== selectedWorkspaceName.trim();

  const filteredWorkspaces = useMemo(() => {
    const query = workspaceSearch.trim().toLowerCase();
    if (!query) {
      return availableWorkspaces;
    }
    return availableWorkspaces.filter((workspace) =>
      [
        workspace.id,
        workspace.name,
        workspace.inviter_name,
        workspace.inviter_email,
        workspace.inviter_display,
        workspace.email,
        workspace.role,
      ].some((value) => String(value || "").toLowerCase().includes(query)),
    );
  }, [availableWorkspaces, workspaceSearch]);

  function clearWorkspaceScopedData({ isSwitchingAcceptedWorkspace = false, sessionEnded = false } = {}) {
    contextGenerationRef.current += 1;
    onClearWorkspaceScopedData?.({ sessionEnded });
    workspaceUsersRequestRef.current += 1;
    setWorkspaceUsers([]);
    setIsLoadingWorkspaceUsers(isSwitchingAcceptedWorkspace);
    setWorkspaceInvitations([]);
  }

  // Applies only the keys present in the update, so an invitation selection
  // leaves the accepted Workspace context untouched.
  function applyWorkspaceContextUpdate(update) {
    if (!update) {
      return;
    }

    const has = (key) => Object.hasOwn(update, key);
    const nextWorkspaceId = has("workspaceId") ? String(update.workspaceId || "") : workspaceIdRef.current;
    if (nextWorkspaceId !== workspaceIdRef.current) {
      const nextInvitationId = has("selectedWorkspaceInvitationId")
        ? String(update.selectedWorkspaceInvitationId || "")
        : selectedWorkspaceInvitationId;
      clearWorkspaceScopedData({
        isSwitchingAcceptedWorkspace: hasSession && Boolean(nextWorkspaceId.trim()) && !nextInvitationId.trim(),
      });
    }

    if (has("workspaceId")) {
      workspaceIdRef.current = nextWorkspaceId;
      setWorkspaceId(update.workspaceId);
    }
    if (has("workspaceName")) setWorkspaceName(update.workspaceName);
    if (has("selectedWorkspaceInvitationId")) setSelectedWorkspaceInvitationId(update.selectedWorkspaceInvitationId);
    if (has("apiKey")) setApiKey(update.apiKey);
  }
  applyWorkspaceContextUpdateRef.current = applyWorkspaceContextUpdate;

  useEffect(() => {
    if (hasSession && (workspaceResolutionStatus !== "resolved" || unavailableRoute)) {
      return;
    }

    const storedWorkspaceId = workspaceId.trim();
    if (!storedWorkspaceId) {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ workspaceId: storedWorkspaceId, workspaceName }),
    );
  }, [hasSession, workspaceResolutionStatus, workspaceName, workspaceId, unavailableRoute]);

  async function copyToClipboard(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }

  async function createWorkspace() {
    setBusy(true);
    try {
      const data = await request(
        "/workspaces",
        { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name: NEW_WORKSPACE_NAME }) },
        true,
        false,
      );
      const createdWorkspaceId = String(data.workspace_id || "");
      const createdWorkspaceName = data.name || NEW_WORKSPACE_NAME;
      if (createdWorkspaceId !== workspaceId) {
        clearWorkspaceScopedData();
      }
      setWorkspaceId(createdWorkspaceId);
      setWorkspaceName(createdWorkspaceName);
      setApiKey("");
      showActionToast("workspace.create", "success", { targetName: createdWorkspaceName });
      await listWorkspaces({
        storedWorkspacePreference: { workspaceId: createdWorkspaceId, workspaceName: createdWorkspaceName },
      });
    } catch (error) {
      showActionToast("workspace.create", "failure", { error });
    } finally {
      setBusy(false);
    }
  }

  async function refreshApiKey() {
    if (!hasWorkspaceContext) {
      return;
    }
    if (
      selectedWorkspaceHasApiKey &&
      !window.confirm(
        "Rotate this Workspace API key? Existing external clients using the current key will stop working.",
      )
    ) {
      return;
    }

    const wasRotation = selectedWorkspaceHasApiKey;
    setBusy(true);
    try {
      const data = await request(
        `/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/api-key`,
        { method: "POST" },
        true,
        false,
      );
      const rotatedWorkspaceId = data.workspace_id || normalizedWorkspaceId;
      setWorkspaceId(rotatedWorkspaceId);
      setApiKey(data.api_key || "");
      setUserWorkspaces((prev) =>
        prev.map((workspace) =>
          String(workspace.id || "") === String(rotatedWorkspaceId)
            ? { ...workspace, has_api_key: true }
            : workspace,
        ),
      );
      const copied = data.api_key ? await copyToClipboard(String(data.api_key)) : false;
      const verb = wasRotation ? "rotate" : "generate";
      showActionToast(`workspace.apiKey.${verb}.${copied ? "copied" : "manualCopy"}`, "success", data);
    } catch (error) {
      showActionToast("workspace.apiKey.rotate", "failure", { error });
    } finally {
      setBusy(false);
    }
  }

  // Resolves to the accepted Workspace that became selected, or null.
  const listWorkspaces = useCallback(async (options = {}) => {
    if (!hasSessionRef.current) {
      return null;
    }

    const generation = contextGenerationRef.current;
    const requestId = ++workspaceListRequestRef.current;
    const isCurrent = () =>
      generation === contextGenerationRef.current &&
      requestId === workspaceListRequestRef.current &&
      hasSessionRef.current;
    try {
      const [workspaceData, invitationData] = await Promise.all([
        requestRef.current("/workspaces", { method: "GET" }, true, false),
        requestRef.current("/invitations", { method: "GET" }, true, false),
      ]);
      if (!isCurrent()) return null;
      const workspaces = Array.isArray(workspaceData?.workspaces) ? workspaceData.workspaces : [];
      const invitations = Array.isArray(invitationData?.invitations) ? invitationData.invitations : [];
      setUserWorkspaces(workspaces);
      setUserWorkspaceInvitations(invitations);
      const resolvedWorkspace = resolveAcceptedWorkspace({
        storedWorkspacePreference:
          options.storedWorkspacePreference ||
          (routeRef.current.requestedWorkspaceId && !options.ignoreRoute
            ? { workspaceId: routeRef.current.requestedWorkspaceId } : null) ||
          (workspaceIdRef.current.trim()
            ? { workspaceId: workspaceIdRef.current, workspaceName: workspaceNameRef.current }
            : storedWorkspacePreference),
        userWorkspaces: workspaces,
      });
      const target = routeRef.current;
      const invitation = target.requestedInvitationId && invitations.find(item => item.id === target.requestedInvitationId);
      const unavailable = !options.ignoreRoute && !options.storedWorkspacePreference && Boolean(
        (target.requestedWorkspaceId && !workspaces.some(item => item.id === target.requestedWorkspaceId)) ||
        (target.requestedInvitationId && !invitation),
      );
      setUnavailableRoute(unavailable);
      setResolvedSessionId(target.sessionId);
      if (unavailable) {
        applyWorkspaceContextUpdateRef.current({ workspaceId: "", workspaceName: "", apiKey: "", selectedWorkspaceInvitationId: "" });
        setWorkspaceResolutionStatus("resolved");
        return null;
      }
      if (resolvedWorkspace) {
        applyWorkspaceContextUpdateRef.current(selectAcceptedWorkspaceContext(resolvedWorkspace));
      }
      if (invitation && !options.ignoreRoute) applyWorkspaceContextUpdateRef.current({ selectedWorkspaceInvitationId: invitation.id });
      setWorkspaceResolutionStatus(resolvedWorkspace ? "resolved" : "error");
      if (options.ignoreRoute || options.storedWorkspacePreference) target.onWorkspaceNavigation?.(resolvedWorkspace?.id || "", { force: true });
      return resolvedWorkspace;
    } catch (error) {
      if (!isCurrent()) return null;
      setWorkspaceResolutionStatus("error");
      throw error;
    }
  }, [storedWorkspacePreference]);

  function retryWorkspaceResolution() {
    setWorkspaceResolutionStatus("loading");
    void listWorkspaces().catch(() => {});
  }

  async function refreshSelectedWorkspaceContext() {
    const targetWorkspaceId = workspaceIdRef.current.trim();
    if (!hasSessionRef.current || !targetWorkspaceId) {
      return null;
    }

    const generation = contextGenerationRef.current;
    const requestId = ++contextRefreshRequestRef.current;
    const isCurrent = () =>
      generation === contextGenerationRef.current &&
      requestId === contextRefreshRequestRef.current &&
      hasSessionRef.current &&
      targetWorkspaceId === workspaceIdRef.current;
    try {
      const data = await requestRef.current(
        `/workspaces/${encodeURIComponent(targetWorkspaceId)}/context`,
        { method: "GET" },
        true,
        false,
      );
      if (!isCurrent()) return null;
      const refreshedWorkspace = data?.workspace;
      if (String(refreshedWorkspace?.id || "") !== targetWorkspaceId) {
        return null;
      }

      setUserWorkspaces((prev) =>
        prev.some((workspace) => String(workspace.id || "") === targetWorkspaceId)
          ? prev.map((workspace) =>
              String(workspace.id || "") === targetWorkspaceId ? refreshedWorkspace : workspace,
            )
          : [...prev, refreshedWorkspace],
      );
      applyWorkspaceContextUpdateRef.current(selectAcceptedWorkspaceContext(refreshedWorkspace));
      setWorkspaceResolutionStatus("resolved");
      return refreshedWorkspace;
    } catch (error) {
      if (!isCurrent()) return null;
      if (error.status === 403 || error.status === 404) {
        return listWorkspaces();
      }
      throw error;
    }
  }

  async function recoverForbiddenWorkspaceAccess() {
    if (isRecoveringForbiddenWorkspaceRef.current) {
      return;
    }

    isRecoveringForbiddenWorkspaceRef.current = true;
    try {
      const nextWorkspace = await listWorkspaces();
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

  const listWorkspaceUsers = useCallback(async (targetWorkspaceId) => {
    const requestId = ++workspaceUsersRequestRef.current;
    if (!hasSessionRef.current || !targetWorkspaceId || !canListWorkspaceUsers) {
      setWorkspaceUsers([]);
      setIsLoadingWorkspaceUsers(false);
      return;
    }

    setIsLoadingWorkspaceUsers(true);
    try {
      const users = await workspaceRequestsRef.current.listWorkspaceUsers(targetWorkspaceId);
      if (workspaceUsersRequestRef.current === requestId) setWorkspaceUsers(users);
    } catch {
      if (workspaceUsersRequestRef.current === requestId) setWorkspaceUsers([]);
    } finally {
      if (workspaceUsersRequestRef.current === requestId) setIsLoadingWorkspaceUsers(false);
    }
  }, [canListWorkspaceUsers]);

  const listWorkspaceInvitations = useCallback(async (targetWorkspaceId) => {
    if (!hasSessionRef.current || !targetWorkspaceId || !canManageWorkspaceInvitations) {
      setWorkspaceInvitations([]);
      return;
    }

    try {
      setWorkspaceInvitations(await workspaceRequestsRef.current.listWorkspaceInvitations(targetWorkspaceId));
    } catch {
      setWorkspaceInvitations([]);
    }
  }, [canManageWorkspaceInvitations]);

  async function applyWorkspaceUserAction(targetUser, action) {
    const targetUserId = String(targetUser.user_id || "").trim();
    if (!normalizedWorkspaceId || !targetUserId) {
      return;
    }
    const targetWorkspaceUser = workspaceUsers.find(
      (user) => String(user.user_id || "").trim() === targetUserId,
    );
    const targetDisplay =
      String(targetWorkspaceUser?.name || "").trim() ||
      String(targetWorkspaceUser?.email || "").trim() ||
      targetUserId;
    const actionToast = WORKSPACE_MEMBER_ACTION_TOASTS[action] || "workspaceMember.remove";

    setBusy(true);
    try {
      await workspaceRequests.applyWorkspaceMemberAction({
        workspaceId: normalizedWorkspaceId,
        targetUserId,
        action,
      });
      await listWorkspaces();
      await listWorkspaceUsers(normalizedWorkspaceId);
      showActionToast(actionToast, "success", { targetName: targetDisplay });
    } catch (error) {
      showActionToast(actionToast, "failure", { error });
    } finally {
      setBusy(false);
    }
  }

  async function inviteUser() {
    if (!normalizedWorkspaceId) {
      return;
    }
    const email = inviteEmail.trim();
    if (!email) {
      showActionToast("workspaceInvitation.create", "validation", { reason: "email" });
      return;
    }

    setBusy(true);
    try {
      await request(`/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/invitations`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ email, role: inviteRole }),
      });
      showActionToast("workspaceInvitation.create", "success", { targetEmail: email });
      setInviteEmail("");
      await listWorkspaceInvitations(normalizedWorkspaceId);
    } catch (error) {
      showActionToast("workspaceInvitation.create", "failure", { error });
    } finally {
      setBusy(false);
    }
  }

  async function cancelWorkspaceInvitation(invitation) {
    const invitationId = String(invitation.id || "").trim();
    if (!normalizedWorkspaceId || !invitationId) {
      return;
    }
    const invitationEmail = String(invitation.email || "this invitation").trim();
    if (!window.confirm(`Cancel pending invitation for ${invitationEmail}?`)) {
      return;
    }

    setBusy(true);
    try {
      await request(
        `/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
        { method: "DELETE" },
        true,
        false,
      );
      await listWorkspaceInvitations(normalizedWorkspaceId);
      showActionToast("workspaceInvitation.cancel", "success", { targetEmail: invitationEmail });
    } catch (error) {
      showActionToast("workspaceInvitation.cancel", "failure", { error });
    } finally {
      setBusy(false);
    }
  }

  function isActionablePendingInvitation(invitation) {
    return Boolean(invitation?.id.trim()) && invitation.status.toLowerCase() === "pending";
  }

  async function acceptSelectedWorkspaceInvitation() {
    const invitation = selectedWorkspaceInvitation;
    if (!isActionablePendingInvitation(invitation)) {
      return;
    }

    setIsAcceptingWorkspaceInvitation(true);
    try {
      const data = await request(
        `/invitations/${encodeURIComponent(invitation.id.trim())}/accept`,
        { method: "POST" },
        true,
        false,
      );
      await listWorkspaces();
      const acceptedWorkspaceId = String(data?.workspace_id || "").trim();
      if (acceptedWorkspaceId) {
        applyWorkspaceContextUpdate(
          selectAcceptedWorkspaceContext({ id: acceptedWorkspaceId, name: invitation.workspaceName }),
        );
        onWorkspaceNavigation?.(acceptedWorkspaceId, { force: true });
      }
      showActionToast("workspaceInvitation.accept", "success");
    } catch (error) {
      showActionToast("workspaceInvitation.accept", "failure", { error });
    } finally {
      setIsAcceptingWorkspaceInvitation(false);
    }
  }

  async function declineSelectedWorkspaceInvitation() {
    const invitation = selectedWorkspaceInvitation;
    if (!isActionablePendingInvitation(invitation)) {
      return;
    }

    setIsDecliningWorkspaceInvitation(true);
    try {
      await request(
        `/invitations/${encodeURIComponent(invitation.id.trim())}/decline`,
        { method: "POST" },
        true,
        false,
      );
      applyWorkspaceContextUpdate({ selectedWorkspaceInvitationId: "" });
      await listWorkspaces({ ignoreRoute: true });
      showActionToast("workspaceInvitation.decline", "success");
    } catch (error) {
      showActionToast("workspaceInvitation.decline", "failure", { error });
    } finally {
      setIsDecliningWorkspaceInvitation(false);
    }
  }

  async function saveWorkspaceChanges() {
    if (!normalizedWorkspaceId || isSavingWorkspace || !isWorkspaceNameDirty) {
      return;
    }

    const nextName = workspaceName.trim();
    setIsSavingWorkspace(true);
    try {
      await request(`/workspaces/${encodeURIComponent(normalizedWorkspaceId)}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: nextName }),
      });
      await listWorkspaces();
      showActionToast("workspace.rename", "success", { targetName: nextName });
    } catch (error) {
      showActionToast("workspace.rename", "failure", { error });
    } finally {
      setIsSavingWorkspace(false);
    }
  }

  async function deleteWorkspace() {
    if (!normalizedWorkspaceId || isDeletingWorkspace) {
      return;
    }
    if (!window.confirm(`Delete workspace ${normalizedWorkspaceId}? This action cannot be undone.`)) {
      return;
    }

    setIsDeletingWorkspace(true);
    try {
      await workspaceRequests.deleteWorkspace(workspaceId);
      clearWorkspaceScopedData();
      setWorkspaceId("");
      setWorkspaceName("");
      setApiKey("");
      await listWorkspaces({ ignoreRoute: true });
      showActionToast("workspace.delete", "success");
    } catch (error) {
      showActionToast("workspace.delete", "failure", { error });
    } finally {
      setIsDeletingWorkspace(false);
    }
  }

  async function leaveWorkspace() {
    if (!normalizedWorkspaceId || isDeletingWorkspace) {
      return;
    }
    if (!window.confirm("Leave this workspace? You will lose access unless you are invited again.")) {
      return;
    }

    setIsDeletingWorkspace(true);
    try {
      const data = await workspaceRequests.leaveWorkspace(normalizedWorkspaceId);
      await listWorkspaces({ ignoreRoute: true });
      showActionToast("workspace.leave", "success", {
        replacementPersonalWorkspaceCreated: Boolean(data?.replacement_workspace),
      });
    } catch (error) {
      showActionToast("workspace.leave", "failure", { error });
    } finally {
      setIsDeletingWorkspace(false);
    }
  }

  function selectInvitedWorkspace(workspace) {
    if (onWorkspaceNavigation) { onWorkspaceNavigation("", { invitationId: workspace.invitation_id }); return; }
    if (beforeWorkspaceSelection && !beforeWorkspaceSelection()) return;
    applyWorkspaceContextUpdate({ selectedWorkspaceInvitationId: String(workspace.invitation_id || "") });
    onActivePageChange("workspace");
  }

  function selectAcceptedWorkspace(workspace) {
    if (onWorkspaceNavigation) { onWorkspaceNavigation(workspace.id); return; }
    if (workspace.id !== workspaceIdRef.current && beforeWorkspaceSelection && !beforeWorkspaceSelection()) return;
    applyWorkspaceContextUpdate(selectAcceptedWorkspaceContext(workspace));
  }

  function clearSessionWorkspaceData() {
    workspaceIdRef.current = "";
    setApiKey("");
    setWorkspaceId("");
    setWorkspaceName("");
    clearWorkspaceScopedData({ sessionEnded: true });
    setUserWorkspaces([]);
    setUserWorkspaceInvitations([]);
    setSelectedWorkspaceInvitationId("");
    setWorkspaceResolutionStatus("idle");
    setUnavailableRoute(false);
    setResolvedSessionId("");
    setIsLoadingWorkspaceUsers(false);
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  }

  const dismissApiKey = useCallback(() => setApiKey(""), []);

  useEffect(() => {
    if (!hasSession) {
      setWorkspaceResolutionStatus("idle");
      return;
    }

    const resolved = resolutionRef.current;
    // Canonicalizing / to the selected Workspace must not clear loaded state,
    // restart sockets, or discard edits that began during startup.
    if (workspaceIdRef.current && (!requestedWorkspaceId || requestedWorkspaceId === workspaceIdRef.current) &&
      resolved.status === "resolved" && resolved.sessionId === sessionId && !resolved.unavailable && !resolved.invitationId && !requestedInvitationId) return;

    setWorkspaceResolutionStatus("loading");
    void listWorkspaces().catch(() => {});
    return () => { contextGenerationRef.current += 1; };
  }, [hasSession, sessionId, listWorkspaces, requestedWorkspaceId, requestedInvitationId]);

  useEffect(() => {
    const targetWorkspaceId = workspaceId.trim();
    if (!hasSession || !targetWorkspaceId) {
      setWorkspaceUsers([]);
      setIsLoadingWorkspaceUsers(false);
      setWorkspaceInvitations([]);
      return;
    }

    void listWorkspaceUsers(targetWorkspaceId);
    void listWorkspaceInvitations(targetWorkspaceId);
  }, [hasSession, listWorkspaceInvitations, listWorkspaceUsers, workspaceId]);

  return {
    context: {
      workspaceId,
      workspaceName,
      hasApiAccess,
      hasWorkspaceApiAccess: workspaceSelectionView.hasWorkspaceApiAccess,
      isDeletingWorkspace,
      isWorkspaceContextLoading,
      hasWorkspaceResolutionError,
      unavailableRoute,
      isWorkspaceInvitationSelected,
      selectedWorkspaceInvitation,
      availableWorkspaces,
      selectedWorkspaceRole,
    },
    sidebar: {
      search: workspaceSearch,
      workspaces: filteredWorkspaces,
      selectedWorkspaceId: workspaceId,
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
      onWorkspacePrimaryAction: workspacePrimaryAction.type === "leave" ? leaveWorkspace : deleteWorkspace,
    },
    acceptedPage: {
      workspaceName,
      onWorkspaceNameChange: setWorkspaceName,
      isSavingWorkspace,
      isWorkspaceNameDirty,
      onSaveWorkspaceChanges: saveWorkspaceChanges,
      apiKey,
      workspaceApiKeyPlaceholder: selectedWorkspaceHasApiKey
        ? "Rotate API key to view again"
        : "Generate an API key to view",
      onCopyVisibleWorkspaceApiKey: () => (apiKey ? copyToClipboard(apiKey) : undefined),
      busy: isAppBusy,
      canRotateWorkspaceApiKey,
      workspaceApiKeyActionLabel: selectedWorkspaceHasApiKey ? "Rotate API key" : "Generate API key",
      onRefreshApiKey: refreshApiKey,
      inviteEmail,
      onInviteEmailChange: setInviteEmail,
      inviteRole,
      onInviteRoleChange: setInviteRole,
      hasApiAccess,
      onInviteUser: inviteUser,
      isLoadingWorkspaceUsers,
      workspaceUsers,
      canShowWorkspaceUserAction: (user) => canShowWorkspaceUserAction(memberPermissions, user.role),
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
      options: workspaceUserActionTarget
        ? getWorkspaceUserActions(memberPermissions, workspaceUserActionTarget.role)
        : [],
      busy: isAppBusy,
      onClose: () => setWorkspaceUserActionTarget(null),
      onApplyAction: (action) => {
        void applyWorkspaceUserAction(workspaceUserActionTarget, action);
        setWorkspaceUserActionTarget(null);
      },
    },
    actions: {
      clearSessionWorkspaceData,
      recoverForbiddenWorkspaceAccess,
      refreshSelectedWorkspaceContext,
      dismissApiKey,
    },
  };
}

const WORKSPACE_MEMBER_ACTION_TOASTS = {
  make_admin: "workspaceMember.makeAdmin",
  make_owner: "workspaceMember.transferOwnership",
};
