# Auth Feedback UX PRD

Status: needs-triage

## Problem Statement

Users currently get poor feedback when sign-in or sign-up fails. Auth failures are written to an activity log, but the unauthenticated auth screen does not render that log, so a user can press Sign In or Create Account and see no visible explanation when validation fails, credentials are rejected, account creation fails, or Google sign-in cannot start.

The sign-up flow also does not make the **Account password policy** visible or enforce the full agreed policy consistently. Users only see a password placeholder, do not get live guidance while typing, can mistype their password because there is no confirm-password field, and may only learn about password problems after a server response.

## Solution

Improve the auth experience by adding visible, immediate, and accessible feedback to the sign-in and sign-up flows.

Auth failures should show Sonner toast feedback. Sign-in and Google sign-in failures should use generic safe messages, while sign-up should show actionable user-friendly messages for client-validatable issues and common account creation errors. Existing activity-log messages should remain for diagnostics and history.

Sign-up should make the **Account password policy** explicit with live inline requirement messages that disappear as each requirement is satisfied. The policy is: at least 8 characters, one ASCII uppercase letter, one ASCII number, and one special character, where special character means any non-alphanumeric character. The frontend should block invalid sign-up attempts with a toast, and the backend should enforce the same policy before account creation.

Sign-up should add a Confirm Password field. Confirm password should be frontend-only and never sent to the auth backend. Once the user starts typing in Confirm Password, both password fields should be outlined in red while they differ, and the inline message “Passwords do not match.” should appear until they match. If a user attempts to submit while they still differ, the same message should be shown as a toast.

The auth panel should use real form submission so pressing Enter submits the active sign-in or sign-up flow.

## User Stories

1. As a visitor, I want to see a visible error when sign-in fails, so that I understand the action did not succeed.
2. As a visitor, I want sign-in failures to avoid revealing whether an email address exists, so that account privacy is protected.
3. As a returning user, I want sign-in credential failures to tell me to check my email and password, so that I know what to try next.
4. As a returning user, I want missing sign-in fields to be reported in a toast, so that I know which required inputs are blocking sign-in.
5. As a returning user, I want all missing sign-in fields reported at once, so that I do not have to submit repeatedly to discover each missing field.
6. As a returning user, I want the Sign In button to stay clickable unless a request is busy, so that invalid submissions can produce clear feedback.
7. As a returning user, I want pressing Enter in the sign-in form to submit sign-in, so that the form behaves like a normal web form.
8. As a visitor, I want to see visible feedback when Google sign-in cannot start, so that I am not left wondering whether the click worked.
9. As a visitor, I want Google sign-in failures to use a generic readable message, so that technical OAuth details do not distract me.
10. As a new user, I want to see a visible error when account creation fails, so that I understand the action did not succeed.
11. As a new user, I want sign-up failures to be actionable when possible, so that I know what to fix.
12. As a new user, I want missing sign-up fields to be reported in a toast, so that I know which required inputs are blocking account creation.
13. As a new user, I want all missing sign-up fields reported at once, so that I do not have to submit repeatedly to discover each missing field.
14. As a new user, I want Confirm Password to be treated as required, so that accidental password typos are caught before account creation.
15. As a new user, I want pressing Enter in the sign-up form to submit account creation, so that the form behaves like a normal web form.
16. As a new user, I want to see the Account password policy while I type my password, so that I can create a valid password without guessing.
17. As a new user, I want password requirement messages to appear after I start typing, so that the blank form does not begin with an intimidating error checklist.
18. As a new user, I want password requirement messages to appear after a blocked submit, so that I understand why account creation was blocked.
19. As a new user, I want the “At least 8 characters” message to disappear once my password is long enough, so that I can see progress toward satisfying the policy.
20. As a new user, I want the “One uppercase letter” message to disappear once my password includes an ASCII uppercase letter, so that I can see progress toward satisfying the policy.
21. As a new user, I want the “One number” message to disappear once my password includes an ASCII number, so that I can see progress toward satisfying the policy.
22. As a new user, I want the “One special character” message to disappear once my password includes a non-alphanumeric character, so that I can see progress toward satisfying the policy.
23. As a new user, I want unmet password-policy requirements to be inline rather than only in a toast, so that I can correct my password while typing.
24. As a new user, I want a toast when I submit without meeting password complexity requirements, so that blocked account creation has visible feedback.
25. As a new user, I want the password-policy submit toast to say “Password must meet all complexity requirements.”, so that it points me back to the visible checklist without overwhelming me.
26. As a new user, I want password-policy feedback to appear only on sign-up, so that sign-in remains focused for returning users.
27. As a new user, I want the Password field not to be outlined red merely because policy requirements are still unmet while typing, so that normal password composition does not feel like a persistent error.
28. As a new user, I want to confirm my password, so that I can catch typos before creating my account.
29. As a new user, I want mismatch feedback to appear once I start typing Confirm Password, so that I can correct the mismatch immediately.
30. As a new user, I want both password text boxes outlined in red while Password and Confirm Password differ, so that the relationship between the two fields is clear.
31. As a new user, I want both password text boxes outlined in red when Confirm Password has text but Password is empty, so that the mismatch is still obvious.
32. As a new user, I want the red outlines to disappear immediately once Password and Confirm Password match, so that the form reflects the corrected state.
33. As a new user, I want the inline text “Passwords do not match.” while the fields differ, so that the red outline has an explicit explanation.
34. As a new user, I want a toast saying “Passwords do not match.” if I submit while the fields differ, so that the blocked submit is clearly explained.
35. As a new user, I want Confirm Password to remain frontend-only, so that only the actual password is sent to the auth backend.
36. As a new user, I want an email-already-in-use sign-up failure to be translated into a friendly toast, so that I know whether to sign in instead.
37. As a new user, I want invalid email sign-up failures to be translated into a friendly toast, so that I can correct the email address.
38. As a new user, I want unknown sign-up failures to use a generic message, so that technical details are not exposed.
39. As a user switching between Sign In and Sign Up, I want password-related state cleared while email and name are preserved, so that stale passwords and mismatch state do not carry across modes.
40. As a user switching between Sign In and Sign Up, I want my entered email preserved, so that I do not have to retype it when changing modes.
41. As a user switching between Sign In and Sign Up, I want my entered name preserved, so that switching modes does not discard useful sign-up context.
42. As a user, I want auth failure toasts to use an accessible error style, so that errors are visually distinct and announced appropriately.
43. As a user, I want auth failure toasts in a predictable global location, so that feedback is easy to find.
44. As a user, I do not want success toasts for sign-in or account creation, so that successful navigation/session changes are not noisy.
45. As a user, I want only failures to create auth toasts, so that toast feedback remains meaningful.
46. As a maintainer, I want the existing activity log behavior preserved, so that diagnostic history is not lost.
47. As a maintainer, I want raw auth errors kept out of user-facing sign-in and Google sign-in toasts, so that privacy and clarity are preserved.
48. As a maintainer, I want the backend to enforce the Account password policy, so that bypassing frontend validation cannot create weak account credentials.
49. As a maintainer, I want backend password-policy failures to return a stable error code and safe message, so that frontend mapping is reliable.
50. As a maintainer, I want the frontend and backend to use the same password-policy semantics, so that users do not see contradictory behavior.
51. As a maintainer, I want password-policy checks isolated behind a small interface, so that the policy can be tested without rendering the whole app or invoking Better Auth.
52. As a maintainer, I want sign-up error mapping isolated behind a small interface, so that user-facing copy can be tested separately from auth transport details.
53. As a maintainer, I want the auth screen to keep using the existing auth client, so that the change remains focused on feedback and validation rather than auth architecture.
54. As a maintainer, I want no database schema changes for this feature, so that deployment risk stays low.
55. As an AI coding agent, I want the Account password policy documented in the domain glossary, so that future auth work uses the same vocabulary.

## Implementation Decisions

- Add Sonner as a frontend runtime dependency.
- Mount one global Sonner toaster at the app root.
- Use Sonner error toasts with rich colors for auth failures.
- Show toasts only for auth failures, not successful sign-in, sign-up, or sign-out events.
- Keep existing activity-log messages alongside the new toasts.
- Use generic user-facing toasts for sign-in failures.
- Use generic user-facing toasts for Google sign-in failures.
- Use actionable user-facing sign-up toasts for password-policy failures, email already in use, invalid email, and missing required fields.
- Fall back to a generic sign-up failure toast for unknown server-side sign-up failures.
- Report all missing required fields in one toast.
- Add Confirm Password as a required sign-up field.
- Keep Confirm Password frontend-only and do not send it to the auth backend.
- Add live password-policy requirement messages in sign-up mode only.
- Show password-policy requirement messages after password typing begins or after an invalid sign-up submit attempt.
- Use the requirement copy “At least 8 characters”, “One uppercase letter”, “One number”, and “One special character”.
- Define uppercase and number checks as ASCII-only.
- Define special character as any non-alphanumeric character.
- Keep Create Account clickable unless a request is busy.
- Block invalid sign-up submissions in the submit handler and show toast feedback.
- Show the password-policy submit toast “Password must meet all complexity requirements.”.
- Show inline confirm-password mismatch feedback after Confirm Password typing begins or after an invalid submit attempt.
- Use “Passwords do not match.” for both inline mismatch feedback and mismatch submit toast.
- Outline both Password and Confirm Password in red once Confirm Password has input and the values differ.
- Remove both red outlines immediately once Password and Confirm Password match.
- Reserve red password field outlines for mismatch feedback only, not unmet password-policy requirements.
- Clear password, confirm password, and password-validation state when switching auth modes, while preserving email and name.
- Convert the auth panel to real form submission so Enter submits the active auth mode.
- Add backend enforcement for the Account password policy before Better Auth processes email/password sign-up.
- Configure Better Auth minimum password length to 8 and enforce the additional uppercase, number, and special-character requirements in a request gate.
- Return a stable backend error code such as `password_policy_not_met` with a safe message when backend password-policy validation fails.
- No database schema changes are required.
- No ADR is required because the decisions are low-reversibility-cost UI/auth validation choices and do not meet the threshold for a hard-to-reverse architectural trade-off.

## Testing Decisions

- Good tests should assert externally observable behavior: which password-policy requirements are unmet, whether a password satisfies the Account password policy, whether a weak sign-up request is rejected, whether safe error messages are surfaced, and whether the auth UI displays/clears validation feedback at the right moments.
- Tests should avoid asserting implementation details such as exact internal state variable names, helper function internals, or component decomposition that users cannot observe.
- The password-policy module should be tested directly as a deep module because it encapsulates the Account password policy behind a small, stable interface.
- The backend sign-up request gate should be tested through request/response behavior where feasible, proving weak passwords are rejected before account creation and strong passwords are allowed to proceed to normal auth handling.
- The sign-up error mapping should be tested as a small pure mapping if extracted, proving known backend/client cases produce the intended user-facing messages and unknown cases stay generic.
- The auth UI should be covered with focused component-level or integration-level tests if the repo’s frontend test setup supports it, verifying live password checklist behavior, confirm-password mismatch text, red outlines, toast calls on blocked submit, and Enter-key submission.
- Prior art exists in backend tests that exercise durable policy behavior through Vitest; auth request validation should follow the same external-behavior style rather than testing private implementation details.
- Focused verification after implementation should include the backend typecheck and frontend production build.

## Out of Scope

- Password reset flows.
- Email verification flows.
- Changing OAuth provider configuration.
- Adding success toasts for auth events.
- Adding a full inline required-field error system for name, email, or missing password fields.
- Disabling Create Account until the form is valid.
- Sending Confirm Password to the backend.
- Changing persisted auth/session database schema.
- Changing account email editability.
- Reworking the broader unauthenticated visual design beyond the feedback and form-behavior changes.
- Adding toasts for non-auth app operations.
- Creating a broad application notification abstraction beyond direct Sonner usage.

## Further Notes

- The backend glossary now defines **Account password policy** and should be treated as the canonical language for this feature.
- The current auth screen writes failures to an activity log, but unauthenticated users do not see that log, which is the direct UX gap this feature closes.
- Sonner is not currently present in the frontend dependencies and must be added.
- Better Auth provides `minPasswordLength`, but the full Account password policy requires additional backend validation for uppercase, number, and special-character requirements.
- Existing auth endpoints remain under the Better Auth `/api/auth/*` route space.
