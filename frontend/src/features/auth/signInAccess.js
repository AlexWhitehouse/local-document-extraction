import { isString } from "../../../../shared/json.ts";

// Invite-only refusals. Sign-up and sign-in return them as Better Auth error codes; a failed
// Google attempt returns to the app with one as `?error=`.
const ACCESS_MESSAGES = {
  INVITATION_REQUIRED: "Sign-up is by invitation only. Ask a workspace admin to invite this email address.",
  ACCESS_REQUIRED: "This account doesn't have access to any workspace. Ask a workspace admin to invite you.",
};

// The same refusal from Google, where the user never typed the email address.
const GOOGLE_ACCESS_MESSAGES = {
  INVITATION_REQUIRED: "Sign-up is by invitation only. Ask a workspace admin to invite your Google email address.",
  ACCESS_REQUIRED: ACCESS_MESSAGES.ACCESS_REQUIRED,
};

// Better Auth's generic Google failures. With invite-only sign-up they mean the gate refused.
const INVITE_ONLY_GOOGLE_ERRORS = {
  signup_disabled: "INVITATION_REQUIRED",
  unable_to_create_user: "INVITATION_REQUIRED",
  unable_to_create_session: "ACCESS_REQUIRED",
};

// Email verification links that fail return to the app the same way.
const VERIFICATION_LINK_ERRORS = new Set(["invalid_token", "token_expired"]);

const REDIRECT_ERROR_PARAMS = new Set(["error", "error_description"]);

export function getAccessMessage(code) {
  return isString(code) ? ACCESS_MESSAGES[code] || "" : "";
}

export function readSignInRedirectError(search) {
  return new URLSearchParams(search).get("error")?.trim() || "";
}

// The toast for a sign-in that came back to the app with `?error=`, or null for none.
// Access refusals are must-act, so they stay until dismissed.
export function describeSignInRedirectError(error, { signupEnabled }) {
  if (!error) return null;

  const code = error.toUpperCase();
  const accessCode = GOOGLE_ACCESS_MESSAGES[code] ? code : signupEnabled ? "" : INVITE_ONLY_GOOGLE_ERRORS[error.toLowerCase()];

  if (accessCode) return { message: GOOGLE_ACCESS_MESSAGES[accessCode], persistent: true };

  if (VERIFICATION_LINK_ERRORS.has(error.toLowerCase())) {
    return { message: "This verification link has expired or was already used. Sign in to get a new one.", persistent: false };
  }

  return { message: "Couldn't sign in. Try again.", persistent: false };
}

// Drops the error a failed sign-in added to the address. The rest of the query stays byte for
// byte, because the connect page's query is signed.
export function withoutSignInRedirectError(href) {
  const hashStart = href.indexOf("#");
  const beforeHash = hashStart === -1 ? href : href.slice(0, hashStart);
  const hash = hashStart === -1 ? "" : href.slice(hashStart);
  const queryStart = beforeHash.indexOf("?");

  if (queryStart === -1) return href;

  const kept = beforeHash
    .slice(queryStart + 1)
    .split("&")
    .filter((part) => part && !REDIRECT_ERROR_PARAMS.has(part.split("=", 1)[0]));

  return `${beforeHash.slice(0, queryStart)}${kept.length ? `?${kept.join("&")}` : ""}${hash}`;
}
