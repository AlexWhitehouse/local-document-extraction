import { isNumber, isString } from "../../../../shared/json.ts";

// What a pending invitation's row can offer for its email at `now`. `resendBlockedUntil` is the
// time (ms) the cooldown ends, so the row can re-render then. Older servers send none of these
// fields; their rows offer neither the link nor Resend.
export function getInvitationEmailState(invitation, now = Date.now()) {
  const inviteUrl = isString(invitation.invite_url) ? invitation.invite_url : "";
  const resendsRemaining = isNumber(invitation.email_resends_remaining) ? invitation.email_resends_remaining : null;
  const availableAt = Date.parse(isString(invitation.email_resend_available_at) ? invitation.email_resend_available_at : "");
  const coolingDown = resendsRemaining !== null && resendsRemaining > 0 && Number.isFinite(availableAt) && availableAt > now;
  const lastEmailedAt = Date.parse(isString(invitation.email_last_sent_at) ? invitation.email_last_sent_at : "");

  return {
    inviteUrl,
    expired: invitation.expired === true,
    supportsResend: resendsRemaining !== null,
    canResend: resendsRemaining !== null && resendsRemaining > 0 && !coolingDown,
    noResendsLeft: resendsRemaining === 0,
    resendBlockedUntil: coolingDown ? availableAt : null,
    lastEmailedAt: Number.isFinite(lastEmailedAt) ? lastEmailedAt : null,
  };
}

// The soonest moment any row's Resend opens, or null when none is waiting.
export function nextResendOpening(invitations, now = Date.now()) {
  let soonest = null;

  for (const invitation of invitations) {
    const blockedUntil = getInvitationEmailState(invitation, now).resendBlockedUntil;

    if (blockedUntil !== null && (soonest === null || blockedUntil < soonest)) soonest = blockedUntil;
  }

  return soonest;
}
