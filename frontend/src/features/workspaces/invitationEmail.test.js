import { describe, expect, it } from "vitest";
import { getInvitationEmailState, nextResendOpening } from "./invitationEmail";

const NOW = Date.parse("2026-10-23T12:00:00.000Z");

function invitation(overrides = {}) {
  return {
    id: "inv_1",
    invite_url: "https://studio.example.com/invitations/inv_1?email=grace%40example.com",
    expired: false,
    email_last_sent_at: "2026-10-23T11:00:00.000Z",
    email_resends_remaining: 3,
    email_resend_available_at: null,
    ...overrides,
  };
}

describe("getInvitationEmailState", () => {
  it("offers the link and Resend for a pending invitation", () => {
    expect(getInvitationEmailState(invitation(), NOW)).toEqual({
      inviteUrl: invitation().invite_url,
      expired: false,
      supportsResend: true,
      canResend: true,
      noResendsLeft: false,
      resendBlockedUntil: null,
      lastEmailedAt: Date.parse("2026-10-23T11:00:00.000Z"),
    });
  });

  it("closes Resend until the cooldown ends", () => {
    const state = getInvitationEmailState(invitation({ email_resend_available_at: "2026-10-23T12:09:00.000Z" }), NOW);

    expect(state.canResend).toBe(false);
    expect(state.resendBlockedUntil).toBe(Date.parse("2026-10-23T12:09:00.000Z"));
    expect(getInvitationEmailState(invitation({ email_resend_available_at: "2026-10-23T11:59:00.000Z" }), NOW).canResend).toBe(
      true,
    );
  });

  it("closes Resend for good once none are left", () => {
    const state = getInvitationEmailState(
      invitation({ email_resends_remaining: 0, email_resend_available_at: "2026-10-23T12:09:00.000Z" }),
      NOW,
    );

    expect(state).toMatchObject({ canResend: false, noResendsLeft: true, resendBlockedUntil: null });
  });

  it("keeps Resend open for an expired invitation, which it renews", () => {
    expect(getInvitationEmailState(invitation({ expired: true }), NOW)).toMatchObject({ expired: true, canResend: true });
  });

  it("offers neither the link nor Resend for an older server's rows", () => {
    expect(getInvitationEmailState({ id: "inv_1", email: "grace@example.com" }, NOW)).toEqual({
      inviteUrl: "",
      expired: false,
      supportsResend: false,
      canResend: false,
      noResendsLeft: false,
      resendBlockedUntil: null,
      lastEmailedAt: null,
    });
  });
});

describe("nextResendOpening", () => {
  it("finds the soonest cooldown to end", () => {
    expect(
      nextResendOpening(
        [
          invitation({ email_resend_available_at: "2026-10-23T12:09:00.000Z" }),
          invitation({ email_resend_available_at: "2026-10-23T12:03:00.000Z" }),
          invitation({ email_resend_available_at: "2026-10-23T11:00:00.000Z" }),
          invitation(),
        ],
        NOW,
      ),
    ).toBe(Date.parse("2026-10-23T12:03:00.000Z"));
  });

  it("is null when nothing is waiting", () => {
    expect(nextResendOpening([invitation()], NOW)).toBeNull();
  });
});
