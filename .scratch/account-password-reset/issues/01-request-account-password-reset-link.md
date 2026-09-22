# Request Account Password Reset Link

Status: completed

## Parent

.scratch/account-password-reset/PRD.md

## What to build

Build the first complete **Account password reset** tracer bullet: a returning email/password user can open a forgot-password path from sign-in, request a reset link by email, and receive neutral account-existence-safe feedback. If an email/password Account exists, Better Auth sends a one-hour reset link through the existing transactional email path using a code-owned **Account password reset** email template.

This slice should be demoable without the final password-changing form: the user can request a link, see the neutral success state, and the backend auth configuration can produce the reset email with the agreed sender, expiry, and scheduling behavior.

## Acceptance criteria

- [x] The sign-in screen shows a “Forgot password?” entry point near the password field area.
- [x] Opening the reset-request mode preserves any email already typed on sign-in.
- [x] The reset-request mode contains one email field and a submit action.
- [x] Submitting without an email shows visible feedback and does not call the auth client.
- [x] Submitting an email calls Better Auth's reset-request client behavior with a `/reset-password` redirect target.
- [x] Reset-request success shows neutral copy that does not reveal whether the Account exists.
- [x] The success state offers a return-to-sign-in action.
- [x] The reset email is sent from `Document Extraction <no-reply@example.com>`.
- [x] The reset email includes the reset URL in both HTML and plain text.
- [x] The reset email tells unexpected recipients they can ignore it.
- [x] Better Auth reset-token expiry is explicitly configured as one hour.
- [x] Better Auth reset email sending uses the existing transactional email scheduling behavior and does not block the request response.
- [x] Focused backend and frontend tests cover the reset-request UI, reset email render module, and Better Auth reset configuration.

## Blocked by

None - can start immediately
