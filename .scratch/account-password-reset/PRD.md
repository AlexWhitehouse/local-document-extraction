# Account Password Reset PRD

Status: ready-for-agent

## Problem Statement

Email/password users do not currently have a self-service way to recover access when they forget their password. A returning user who cannot sign in has no visible path from the auth screen to request a reset link, set a new password, or recover without maintainer intervention.

The product already has Better Auth email/password accounts, an **Account password policy**, Cloudflare Email Sending, code-owned transactional email templates, and **Account email verification**. The missing feature should fit those existing concepts rather than introduce a separate password-recovery model.

## Solution

Add **Account password reset** for email/password Accounts. From the sign-in screen, a user can open a distinct reset-request mode, submit their email, and receive neutral feedback that does not reveal whether an account exists. If an email/password Account exists, Better Auth sends a one-hour reset link through the existing transactional email infrastructure.

The reset link opens the unauthenticated `/reset-password` SPA experience with a Better Auth reset token or token error in the query string. A valid token lets the user enter and confirm a new password. The reset form uses the same password requirements UI and **Account password policy** as account creation. After successful reset, existing sessions are revoked and the user returns to sign in.

## User Stories

1. As a returning email/password user, I want a visible forgot-password entry point on sign-in, so that I can recover access when I cannot remember my password.
2. As a returning email/password user, I want the reset request flow to preserve the email I already typed, so that I do not have to enter it twice.
3. As a returning email/password user, I want to submit only my email when requesting a reset link, so that the recovery step is simple.
4. As a returning email/password user, I want neutral success feedback after requesting a reset link, so that I know to check my inbox.
5. As a returning email/password user, I want reset-request feedback to avoid saying whether my email exists, so that account privacy is protected.
6. As a returning email/password user, I want a clear way back to sign in after requesting a reset link, so that I can continue once I have reset my password.
7. As a returning email/password user, I want the reset email to clearly identify Document Extraction, so that I trust the message.
8. As a returning email/password user, I want the reset email to come from `Document Extraction <no-reply@example.com>`, so that it matches other account emails.
9. As a returning email/password user, I want the reset email to include a clear reset link, so that I can continue recovery.
10. As a returning email/password user, I want the reset email to be readable in HTML email clients, so that the message is easy to use.
11. As a returning email/password user, I want the reset email to include a plain-text alternative, so that it works in clients that do not render HTML.
12. As an unexpected recipient, I want the reset email to say I can ignore it, so that I understand no action is required.
13. As a returning email/password user, I want reset links to expire after one hour, so that old credential reset links do not remain useful indefinitely.
14. As a returning email/password user, I want the reset link to open the app's reset-password experience, so that I stay inside the normal product surface.
15. As a returning email/password user, I want an expired or invalid reset link to show a clear message, so that I know I need to request a new link.
16. As a returning email/password user, I want the reset form to ask for a new password and confirmation, so that I can avoid typos.
17. As a returning email/password user, I want reset password requirements to match account creation, so that the product has one account credential standard.
18. As a returning email/password user, I want unmet password requirements shown while setting a new password, so that I can fix issues before submitting.
19. As a returning email/password user, I want the reset password form to show “At least 8 characters”, so that I know the length requirement.
20. As a returning email/password user, I want the reset password form to show “One uppercase letter”, so that I know the uppercase requirement.
21. As a returning email/password user, I want the reset password form to show “One number”, so that I know the number requirement.
22. As a returning email/password user, I want the reset password form to show “One special character”, so that I know the special-character requirement.
23. As a returning email/password user, I want password requirements to disappear as I satisfy them, so that I can see progress.
24. As a returning email/password user, I want mismatch feedback when the new password and confirmation differ, so that I can correct typos before submitting.
25. As a returning email/password user, I want the reset submit to be blocked when passwords differ, so that I do not accidentally set an unintended password.
26. As a returning email/password user, I want the reset submit to be blocked when the new password is weak, so that account credentials remain strong.
27. As a returning email/password user, I want the backend to enforce the same password policy as the frontend, so that bypassing the UI cannot set a weak password.
28. As a returning email/password user, I want successful reset to return me to sign in, so that I understand the next step.
29. As a returning email/password user, I want existing sessions revoked after reset, so that old sessions do not remain active after a credential recovery event.
30. As a signed-in user whose session is revoked by reset, I want to sign in again with the new password, so that access resumes under the new credential.
31. As a Google social sign-in user, I do not expect the reset flow to change my Google credential, so that social-provider credentials remain provider-owned.
32. As a user with a pending **Workspace invitation**, I want password reset to affect only my Account credential, so that invitation lifecycle remains unchanged.
33. As a user with accepted **Workspace membership**, I want password reset to leave my Workspaces and product data intact, so that recovering access does not alter authorization.
34. As a workspace owner/admin, I do not expect **Account password reset** to rotate **Workspace API keys**, so that external client credentials are managed separately.
35. As an attacker, I should not be able to use reset-request responses to enumerate account emails, so that account privacy is preserved.
36. As an attacker, I should not be able to set a weak password through the reset endpoint, so that the account credential policy cannot be bypassed.
37. As a maintainer, I want **Account password reset** to reuse Better Auth reset-token handling, so that the feature avoids custom credential-token storage.
38. As a maintainer, I want reset email sending to use the existing `EMAIL` binding, so that transactional account emails share one operational path.
39. As a maintainer, I want reset email sending scheduled without blocking request responses, so that auth responsiveness does not depend on email delivery latency.
40. As a maintainer, I want reset send failures logged through the existing transactional email scheduling behavior, so that operational problems are visible.
41. As a maintainer, I want a separate code-owned reset email render module, so that the email template is testable and does not grow the verification template.
42. As a maintainer, I want the reset email render module to return sender, subject, HTML, and text, so that it matches the existing transactional email contract.
43. As a maintainer, I want the auth configuration to explicitly set a one-hour reset-token expiry, so that the rule is visible in code.
44. As a maintainer, I want the auth configuration to revoke sessions on reset, so that the security behavior is not implicit.
45. As a maintainer, I want the reset-password request guard to mirror the sign-up password guard, so that weak passwords are rejected before Better Auth mutates credentials.
46. As a maintainer, I want reset UI behavior tested through user-visible outcomes, so that refactors do not break recovery flows.
47. As a maintainer, I want backend reset email behavior tested through stable email content and auth configuration, so that implementation details can change safely.
48. As a maintainer, I want no new database schema for this slice, so that deployment risk stays low.
49. As an AI coding agent, I want the PRD and domain contexts to use **Account password reset**, so that future implementation follows the same vocabulary.

## Implementation Decisions

- Use **Account password reset** as the canonical product and domain term.
- Keep UI copy familiar where appropriate, including a sign-in “Forgot password?” link.
- Add a distinct auth-screen reset-request mode reached from the sign-in password field area.
- Preserve any email already typed on sign-in when entering reset-request mode.
- The reset-request mode contains one email field and submits through the existing Better Auth client.
- Reset-request success replaces the request form with a neutral success panel and a return-to-sign-in action.
- Reset-request feedback must not reveal whether the submitted email belongs to an email/password Account.
- Use Better Auth's built-in password reset request and reset-password token handling rather than custom reset-token tables or product routes.
- Configure reset emails through the email/password auth configuration.
- Set reset-token expiry explicitly to one hour.
- Set session revocation on password reset explicitly.
- Send reset links to the SPA `/reset-password` experience.
- Treat `/reset-password` as an unauthenticated frontend experience separate from sign-in and sign-up modes.
- The `/reset-password` experience reads Better Auth reset token or token error query parameters.
- A missing, expired, or invalid token shows a clear recovery message and a path back to requesting a new link.
- A valid token shows a reset form with new password and confirm password fields.
- The reset form uses the same **Account password policy** UI as account creation.
- The reset form uses the same confirm-password mismatch behavior as account creation.
- The backend enforces the **Account password policy** for reset-password requests before Better Auth handles them.
- The backend reset-password policy failure uses the same stable `password_policy_not_met` error code and safe message as sign-up.
- After successful reset, the frontend returns the user to sign in and does not treat them as signed in.
- **Account password reset** does not create, remove, or alter **Workspace membership**.
- **Account password reset** does not affect pending **Workspace invitations**.
- **Account password reset** does not rotate or invalidate **Workspace API keys**.
- Add a code-owned **Account password reset** email render module.
- Send **Account password reset** email from `Document Extraction <no-reply@example.com>`.
- Include the reset link visibly in both HTML and text email bodies.
- Include unexpected-recipient ignore guidance in both HTML and text email bodies.
- Send reset emails through the existing Worker `EMAIL` binding.
- Schedule reset email sending without blocking the reset-request response.
- Keep transactional email templates one render module per email type.
- No database migration is expected for this slice.
- No ADR is required because the feature follows existing auth, email, and SPA fallback patterns rather than introducing a surprising hard-to-reverse trade-off.

## Testing Decisions

- Good tests should assert externally observable behavior and stable module contracts rather than private helper names, component state variable names, or exact implementation decomposition.
- The **Account password reset** email render module should be tested as a pure function: agreed sender, subject, reset URL in HTML, reset URL in text, and unexpected-recipient guidance.
- Better Auth configuration should be tested for reset email sending, one-hour reset-token expiry, and session revocation after reset.
- Reset email scheduling should be tested through the existing transactional email scheduling contract: scheduled with Worker context when available and non-blocking from the requester's perspective.
- Backend auth routing should test weak reset-password requests are rejected with `password_policy_not_met` before normal auth handling.
- Backend auth routing should test strong reset-password requests pass through to normal Better Auth handling.
- Frontend auth tests should verify the “Forgot password?” link enters reset-request mode and preserves the typed email.
- Frontend auth tests should verify missing reset-request email feedback is visible and does not call the auth client.
- Frontend auth tests should verify reset-request success shows neutral account-existence-safe copy.
- Frontend auth tests should verify reset-request failures use safe user-facing feedback.
- Frontend reset-password tests should verify token-error and missing-token states show a recovery message instead of the password form.
- Frontend reset-password tests should verify the reset form reuses the account creation password-requirement behavior.
- Frontend reset-password tests should verify confirm-password mismatch feedback blocks reset submission.
- Frontend reset-password tests should verify successful reset calls Better Auth with the token and new password, clears password fields, and returns to sign in.
- Prior art exists in backend email template tests, transactional email scheduling tests, auth request handling tests, Better Auth configuration tests, and frontend auth tests.
- Verification should include backend typecheck.
- Verification should include focused backend and frontend Vitest tests for the changed auth behavior.
- Verification should include the frontend production build because the unauthenticated SPA auth surface changes.

## Out of Scope

- Changing the **Account password policy**.
- Adding multi-factor authentication, passkeys, magic links, or account recovery codes.
- Changing Google or other social-provider credential recovery.
- Manually setting passwords from the **Application admin page**.
- Admin-triggered reset emails.
- Editing account email addresses.
- Changing **Account email verification** semantics.
- Adding Workspace invitation emails.
- Changing **Workspace membership**, **Workspace invitation**, or **Workspace API key** lifecycle.
- Creating custom reset-token persistence outside Better Auth.
- Adding durable email queueing, audit tables, provider failover, or retry orchestration.
- Admin-editable email templates, localization, template previews, or template management UI.
- Adding URL routing across the rest of the SPA beyond supporting `/reset-password`.
- Creating a post-reset signed-in landing page.
- Creating an ADR for this implementation.

## Further Notes

- The backend context now defines **Account password reset** and records the agreed reset rules.
- The frontend context now defines **Account password reset** and records the agreed auth-screen behavior.
- Existing **Account email verification** work already introduced the reusable transactional email scheduling and code-owned template pattern that this feature should follow.
- Existing auth feedback work already introduced the **Account password policy** UI and backend request guard pattern that reset should mirror.
- The Worker already serves frontend assets for non-`/v1` GET and HEAD requests, so `/reset-password` can be served by the SPA fallback in production.
