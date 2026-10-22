import { describe, expect, it } from "vitest";
import {
  describeSignInRedirectError,
  getAccessMessage,
  readSignInRedirectError,
  withoutSignInRedirectError,
} from "./signInAccess.js";

const INVITATION = "Sign-up is by invitation only. Ask a workspace admin to invite your Google email address.";

const ACCESS = "This account doesn't have access to any workspace. Ask a workspace admin to invite you.";

describe("invite-only refusals", () => {
  it("maps the sign-up and sign-in codes, and nothing else", () => {
    expect(getAccessMessage("INVITATION_REQUIRED")).toBe(
      "Sign-up is by invitation only. Ask a workspace admin to invite this email address.",
    );
    expect(getAccessMessage("ACCESS_REQUIRED")).toBe(ACCESS);
    expect(getAccessMessage("INVALID_EMAIL_OR_PASSWORD")).toBe("");
    expect(getAccessMessage(undefined)).toBe("");
  });
});

describe("sign-in redirect errors", () => {
  it.each([
    ["INVITATION_REQUIRED", true, INVITATION],
    ["invitation_required", true, INVITATION],
    ["ACCESS_REQUIRED", true, ACCESS],
    ["signup_disabled", false, INVITATION],
    ["unable_to_create_user", false, INVITATION],
    ["unable_to_create_session", false, ACCESS],
  ])("shows %s (sign-up on: %s) as an invite-only refusal that stays", (error, signupEnabled, message) => {
    expect(describeSignInRedirectError(error, { signupEnabled })).toEqual({ message, persistent: true });
  });

  it("keeps Better Auth's generic failures generic while sign-up is open", () => {
    expect(describeSignInRedirectError("signup_disabled", { signupEnabled: true })).toEqual({
      message: "Couldn't sign in. Try again.",
      persistent: false,
    });
    expect(describeSignInRedirectError("access_denied", { signupEnabled: false }).message).toBe(
      "Couldn't sign in. Try again.",
    );
  });

  it("explains a failed verification link", () => {
    expect(describeSignInRedirectError("TOKEN_EXPIRED", { signupEnabled: true }).message).toBe(
      "This verification link has expired or was already used. Sign in to get a new one.",
    );
  });

  it("reads nothing without an error", () => {
    expect(readSignInRedirectError("?client_id=a")).toBe("");
    expect(describeSignInRedirectError("", { signupEnabled: false })).toBeNull();
    expect(readSignInRedirectError("?error=ACCESS_REQUIRED&error_description=x")).toBe("ACCESS_REQUIRED");
  });

  it("removes only the error from an address and keeps the rest byte for byte", () => {
    const signed = "client_id=c&scope=workspace%3Aread+documents%3Aread&sig=a%2Fb";

    expect(
      withoutSignInRedirectError(`https://studio.test/mcp/connect?${signed}&error=ACCESS_REQUIRED&error_description=No+access`),
    ).toBe(`https://studio.test/mcp/connect?${signed}`);
    expect(withoutSignInRedirectError("https://studio.test/?error=signup_disabled#top")).toBe("https://studio.test/#top");
    expect(withoutSignInRedirectError("https://studio.test/workspaces/ws_1")).toBe("https://studio.test/workspaces/ws_1");
  });
});
