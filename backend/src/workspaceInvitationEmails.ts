import type { Database } from "bun:sqlite";
import type { LocalWorkspaceControl, LocalWorkspaceInvitation, InvitationEmailAttempt } from "./localWorkspaceControl";
import { LocalWorkspaceControlError } from "./localWorkspaceControl";
import type { LocalMailSink } from "./localMailSink";
import type { LocalProductAnalytics } from "./localProductAnalytics";
import { renderWorkspaceInvitationEmail } from "./lib/email/accountEmails";
import { newId } from "./lib/ids";

export class InvitationEmailRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number | null) {
    super("Invitation email limit reached");
  }
}

export type WorkspaceInvitationEmails = ReturnType<typeof createWorkspaceInvitationEmails>;

type InvitationInput = Parameters<LocalWorkspaceControl["createInvitation"]>[0];

export function createWorkspaceInvitationEmails(input: {
  database: Database; control: LocalWorkspaceControl; mailSink: LocalMailSink;
  provider: "local" | "cloudflare"; from: { email: string; name: string };
}) {
  let analytics: LocalProductAnalytics | undefined;
  const { control } = input;

  function limit(invitation: LocalWorkspaceInvitation, trigger: "create" | "resend", actorUserId: string): number | null | undefined {
    const attempts = control.invitationEmailAttempts(invitation.id, invitation.workspace_id, actorUserId).filter((attempt) => attempt.outcome !== "rate_limited");
    const own = attempts.filter((attempt) => attempt.invitation_id === invitation.id);

    if (trigger === "resend" && own.filter((attempt) => attempt.trigger === "resend").length >= 3) return null;

    const recent = attempts.filter((attempt) => attempt.workspace_id === invitation.workspace_id && Date.parse(attempt.attempted_at) > Date.now() - 86400000);
    const actorRecent = attempts.filter((attempt) => attempt.actor_user_id === actorUserId && Date.parse(attempt.attempted_at) > Date.now() - 86400000);
    const waits: number[] = [];

    if (actorRecent.length >= 50) waits.push(Date.parse(actorRecent[actorRecent.length - 50]!.attempted_at) + 86400000 - Date.now());

    if (recent.length >= 20) waits.push(Date.parse(recent[recent.length - 20]!.attempted_at) + 86400000 - Date.now());

    if (trigger === "resend" && own.length) waits.push(Date.parse(own[own.length - 1]!.attempted_at) + 600000 - Date.now());

    const wait = Math.max(0, ...waits);

    return wait > 0 ? Math.ceil(wait / 1000) : undefined;
  }

  async function deliver(invitation: LocalWorkspaceInvitation, trigger: "create" | "resend", userId = invitation.inviter_user_id) {
    const attempt: InvitationEmailAttempt = {
      id: newId("invite_email"), workspace_id: invitation.workspace_id, invitation_id: invitation.id,
      actor_user_id: userId, trigger, outcome: "failed", attempted_at: new Date().toISOString(),
    };

    const retry = limit(invitation, trigger, userId);

    if (retry !== undefined) {
      attempt.outcome = "rate_limited";
      control.recordInvitationEmailAttempt(attempt);
      analytics?.record({ type: "workspace_invitation_email_rate_limited", workspaceId: invitation.workspace_id, trigger, provider: input.provider });

      if (trigger === "resend") throw new InvitationEmailRateLimitError(retry);
    } else {
      if (trigger === "resend") invitation = control.refreshInvitation({ workspaceId: invitation.workspace_id, invitationId: invitation.id, userId });
      control.recordInvitationEmailAttempt(attempt);
      const existing = input.database.query("SELECT 1 FROM user WHERE lower(email) = ?").get(invitation.email);
      const url = new URL(invitation.invite_url);
      url.searchParams.set("auth", existing ? "signin" : "signup");

      const message = renderWorkspaceInvitationEmail({
        workspaceName: invitation.workspace_name, inviterName: invitation.inviter_name ?? invitation.inviter_email,
        inviterEmail: invitation.inviter_email, email: invitation.email, role: invitation.role,
        expiresAt: invitation.expires_at, url: url.href, existingAccount: Boolean(existing), from: input.from,
      });

      try {
        await input.mailSink.capture({ ...message, type: "workspace_invitation", to: invitation.email });
        attempt.outcome = input.provider === "local" ? "captured" : "sent";
      } catch {
        attempt.outcome = "failed";
      }

      control.recordInvitationEmailAttempt(attempt);
      analytics?.record({ type: attempt.outcome === "failed" ? "workspace_invitation_email_failed" : "workspace_invitation_email_sent", workspaceId: invitation.workspace_id, trigger, provider: input.provider });
    }

    const refreshed = control.listWorkspaceInvitations({ workspaceId: invitation.workspace_id, userId }).find((item) => item.id === invitation.id) ?? invitation;

    return { ...refreshed, email_delivery: { status: attempt.outcome } };
  }

  return {
    setAnalytics(value: LocalProductAnalytics | undefined) { analytics = value; },
    create: async (value: InvitationInput, create = () => control.createInvitation(value)) => deliver(create(), "create"),
    async resend(value: { workspaceId: string; invitationId: string; userId: string }) {
      const invitation = control.listWorkspaceInvitations(value).find((item) => item.id === value.invitationId);

      if (!invitation) throw new LocalWorkspaceControlError("not_found", "Invitation not found");

      return deliver(invitation, "resend", value.userId);
    },
  };
}
