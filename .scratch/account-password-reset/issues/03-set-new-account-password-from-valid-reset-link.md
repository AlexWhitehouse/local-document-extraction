# Set New Account Password From Valid Reset Link

Status: completed

## Parent

.scratch/account-password-reset/PRD.md

## What to build

Complete **Account password reset** for a valid Better Auth reset token. A visitor who opens `/reset-password` with a valid token can enter and confirm a new password, receive the same **Account password policy** guidance as account creation, submit the reset to Better Auth, have existing sessions revoked, and return to sign in.

This slice should also close the backend policy gap: reset-password requests must be checked against the same **Account password policy** before Better Auth mutates credentials.

## Acceptance criteria

- [x] `/reset-password` with a reset token shows a new-password form rather than missing-token or token-error recovery.
- [x] The form has new password and confirm password fields.
- [x] The form shows the same unmet password requirement list used by account creation.
- [x] The form blocks submission when the new password does not satisfy the **Account password policy**.
- [x] The form shows confirm-password mismatch feedback and blocks submission when the fields differ.
- [x] Successful submission calls Better Auth reset-password behavior with the token and new password.
- [x] Successful reset clears password fields and returns the user to sign in.
- [x] Better Auth is explicitly configured to revoke existing sessions after password reset.
- [x] Weak reset-password requests are rejected by the backend with `password_policy_not_met` before normal Better Auth handling.
- [x] Strong reset-password requests pass through to normal Better Auth handling.
- [x] Focused backend and frontend tests cover valid-token reset behavior, password-policy enforcement, mismatch behavior, session-revocation configuration, and return-to-sign-in behavior.

## Blocked by

- .scratch/account-password-reset/issues/01-request-account-password-reset-link.md
- .scratch/account-password-reset/issues/02-show-reset-link-recovery-states.md
