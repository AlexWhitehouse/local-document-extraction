# Show Reset Link Recovery States

Status: completed

## Parent

.scratch/account-password-reset/PRD.md

## What to build

Build the unauthenticated `/reset-password` **Account password reset** recovery states for links that cannot currently set a password. A visitor who opens `/reset-password` without a token, or with a Better Auth token error in the query string, should see a clear recovery message and a path back to requesting a new reset link.

This slice should be demoable without the valid-token password form: visiting `/reset-password` in missing-token and token-error states should render the reset recovery experience rather than the normal sign-in screen or authenticated app shell.

## Acceptance criteria

- [x] The SPA recognizes `/reset-password` as an unauthenticated auth experience.
- [x] Visiting `/reset-password` without a reset token shows a clear message that the reset link is missing or invalid.
- [x] Visiting `/reset-password` with a Better Auth token error query parameter shows a clear expired-or-invalid-link message.
- [x] Missing-token and token-error states provide a path back to requesting a new **Account password reset** link.
- [x] The recovery states do not attempt to resolve a session, Workspace context, Templates, or Documents.
- [x] The recovery states do not show the valid-token new-password form.
- [x] Focused frontend tests cover missing-token and token-error behavior through user-visible output.

## Blocked by

None - can start immediately
