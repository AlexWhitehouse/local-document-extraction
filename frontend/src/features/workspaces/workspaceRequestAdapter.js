import { isJsonObject, isNumber, isString } from "../../../../shared/json.ts";

export function createWorkspaceRequestAdapter({ request }) {
  function normalizedWorkspaceId(workspaceId) {
    const value = String(workspaceId || "").trim();

    if (!value) {
      throw new Error("Workspace ID is required");
    }

    return value;
  }

  return {
    async deleteWorkspace(workspaceId) {
      const normalizedId = normalizedWorkspaceId(workspaceId);

      const result = await request(
        `/workspaces/${encodeURIComponent(normalizedId)}`,
        { method: "DELETE" },
        true,
        false,
      );

      if (result?.ok !== true || result.workspace_id !== normalizedId) {
        throw new Error("Workspace deletion returned an invalid response");
      }

      return result;
    },
    async listWorkspaceUsers(workspaceId) {
      const normalizedId = normalizedWorkspaceId(workspaceId);

      const result = await request(
        `/workspaces/${encodeURIComponent(normalizedId)}/users`,
        { method: "GET" },
        true,
        false,
      );

      return Array.isArray(result?.users) ? result.users : [];
    },
    async applyWorkspaceMemberAction({ workspaceId, targetUserId, action }) {
      const normalizedId = normalizedWorkspaceId(workspaceId);
      const normalizedTargetUserId = String(targetUserId || "").trim();

      if (!normalizedTargetUserId) {
        throw new Error("Workspace user ID is required");
      }

      const normalizedAction = String(action || "").trim();

      if (!normalizedAction) {
        throw new Error("Workspace member action is required");
      }

      return request(
        `/workspaces/${encodeURIComponent(normalizedId)}/users/${encodeURIComponent(normalizedTargetUserId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: normalizedAction }),
        },
        true,
        false,
      );
    },
    async listWorkspaceInvitations(workspaceId) {
      const normalizedId = normalizedWorkspaceId(workspaceId);

      const result = await request(
        `/workspaces/${encodeURIComponent(normalizedId)}/invitations`,
        { method: "GET" },
        true,
        false,
      );

      return Array.isArray(result?.invitations) ? result.invitations : [];
    },
    // Resolves to the stored invitation and what happened to its email. Email is best effort:
    // the invitation exists even when its email failed or was skipped.
    async createWorkspaceInvitation({ workspaceId, email, role }) {
      const normalizedId = normalizedWorkspaceId(workspaceId);

      const result = await request(`/workspaces/${encodeURIComponent(normalizedId)}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });

      return readInvitationDelivery(result);
    },
    // Emails the invitation again and renews it for 7 days. A refused resend throws with
    // `code: "invitation_email_rate_limited"`; read its wait with readResendRetryAfter.
    async resendWorkspaceInvitation({ workspaceId, invitationId }) {
      const normalizedId = normalizedWorkspaceId(workspaceId);
      const normalizedInvitationId = String(invitationId || "").trim();

      if (!normalizedInvitationId) {
        throw new Error("Invitation ID is required");
      }

      const result = await request(
        `/workspaces/${encodeURIComponent(normalizedId)}/invitations/${encodeURIComponent(normalizedInvitationId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resend" }),
        },
        true,
        false,
      );

      return readInvitationDelivery(result);
    },
    leaveWorkspace(workspaceId) {
      const normalizedId = normalizedWorkspaceId(workspaceId);

      return request(`/workspaces/${encodeURIComponent(normalizedId)}/leave`, { method: "POST" }, true, false);
    },
  };
}

const EMAIL_DELIVERY_STATUSES = new Set(["sent", "captured", "failed", "rate_limited"]);

// Splits a create or resend response into the invitation row and its email outcome. An older
// server reports no outcome, which reads as "unknown".
export function readInvitationDelivery(result) {
  const { email_delivery: emailDelivery, ...invitation } = isJsonObject(result) ? result : {};
  const status = isJsonObject(emailDelivery) && isString(emailDelivery.status) ? emailDelivery.status : "";

  return { invitation, delivery: EMAIL_DELIVERY_STATUSES.has(status) ? status : "unknown" };
}

// Seconds until a refused resend may be tried again: a number, null when this invitation has
// no resends left, or undefined when the server didn't say.
export function readResendRetryAfter(error) {
  const value = error?.details?.retry_after_seconds;

  if (value === null) return null;

  return isNumber(value) && Number.isFinite(value) && value >= 0 ? value : undefined;
}
