# Account Email Verification PRD

Status: needs-triage

## Problem Statement

Email/password users can currently create an account and access Document Extraction without proving that they control the email address on the account. This allows accidental or malicious sign-up with someone else's email address and creates durable product state, including a personal **Workspace** and starter **Template**, before **Account email verification** has happened.

The backend is already using Better Auth with email/password accounts, Google social sign-in, a `user.emailVerified` field, and a Better Auth `verification` table, but the Better Auth email verification flow is not configured. Cloudflare Email Sending has been onboarded for the production domain, but the Worker does not yet have a Cloudflare Email Sending binding or a reusable transactional email module.

## Solution

Require **Account email verification** before an email/password user can access the application. Email/password sign-up should create the Better Auth account and send a verification email, but it should not create a personal **Workspace**, resolve a session, or allow application access until the user verifies their email.

Use Cloudflare Email Sending from the Worker through a generated `EMAIL` binding. Send an HTML-formatted account verification email from `Document Extraction <no-reply@extract.t3m.uk>` with a plain-text alternative and a verification link that returns the user to the application root. Better Auth should automatically sign the user in after successful verification.

Create reusable backend email infrastructure that keeps the sending module generic and stores transactional email templates as code-owned render modules, one email type per file. For this slice, implement the **Account email verification** template only.

Move personal **Workspace** bootstrap from account creation to the moment **Account email verification** gives the user account access. The bootstrap should be idempotent and should not be suppressed by pending **Workspace invitations**. A trusted social provider's verified email claim satisfies **Account email verification**, so verified Google social sign-in should not require a separate Document Extraction verification email.

## User Stories

1. As a visitor, I want to create an email/password account, so that I can start using Document Extraction.
2. As a visitor, I want account creation to send me an **Account email verification** email, so that I can prove I control the email address.
3. As a visitor, I want account creation to keep me out of the app until verification, so that access depends on verified ownership of the email address.
4. As a visitor, I want to see an **Account verification prompt** after sign-up, so that I know to check my inbox before signing in.
5. As a visitor, I want the sign-up prompt to avoid trying to load a **Workspace**, so that the app does not enter a broken loading state before verification.
6. As a visitor, I want the verification email to clearly identify Document Extraction, so that I trust the message and understand what account it relates to.
7. As a visitor, I want the verification email to come from `Document Extraction <no-reply@extract.t3m.uk>`, so that it is recognizable as a product transactional email.
8. As a visitor, I want the verification email to be HTML formatted, so that it is readable and professional in modern email clients.
9. As a visitor, I want the verification email to include a plain-text alternative, so that it remains usable in clients that do not render HTML.
10. As a visitor, I want the verification email to include a clear verification link, so that I can complete **Account email verification**.
11. As a visitor, I want the verification email to say I can ignore it if I did not create an account, so that unexpected recipients know no action is required.
12. As a visitor, I want the verification link to return me to the application root, so that I land in the normal app entry point after verification.
13. As a newly verified user, I want to be signed in automatically after verification, so that I do not have to enter my password again immediately.
14. As a newly verified user, I want a personal **Workspace** created only after verification, so that account access and workspace access begin together.
15. As a newly verified user, I want personal **Workspace** creation to be reliable if the verification callback is retried, so that I do not receive duplicate personal Workspaces.
16. As a newly verified user with a pending **Workspace invitation**, I want a personal **Workspace** created after verification, so that I still have an accepted **Workspace context** before deciding whether to accept the invitation.
17. As an invited user, I want pending **Workspace invitations** to remain separate from account verification, so that invitation acceptance is still an explicit action.
18. As an email/password user, I want sign-in to be blocked when my email is unverified, so that unverified accounts cannot access the application.
19. As an unverified email/password user, I want sign-in attempts to send me a fresh verification link, so that I can recover if I lost or missed the original email.
20. As an unverified email/password user, I want the frontend to tell me to verify my email and that a new link was sent, so that I understand why sign-in did not proceed.
21. As an unverified email/password user, I do not need a separate resend button in this slice, so that the first implementation remains simple while sign-in retry provides a recovery path.
22. As an existing email/password user with an unverified email, I want the new rule to apply on future sign-in, so that all email/password access eventually requires **Account email verification**.
23. As an existing signed-in user with an unverified email, I do not want this slice to forcibly invalidate my current session, so that rollout disruption is limited.
24. As a Google social sign-in user, I want the provider's verified email claim to satisfy **Account email verification**, so that I do not have to complete a second verification flow.
25. As a Google social sign-in user, I want verified social sign-in to create my personal **Workspace** when needed, so that social login remains a complete onboarding path.
26. As a user whose social provider does not assert a verified email, I want access to follow the same no-access rule as unverified email/password accounts, so that email ownership remains the gate.
27. As a user, I want **Account email verification** to be the access gate rather than email delivery success, so that temporary send failures do not accidentally grant access.
28. As a user, I want a sign-in retry to send a new verification email after a delivery failure, so that I am not permanently stuck by one failed send attempt.
29. As a maintainer, I want Cloudflare Email Sending configured through a generated `EMAIL` binding, so that the Worker uses Cloudflare's supported transactional email integration.
30. As a maintainer, I want local development to send real verification emails through Cloudflare Email Sending, so that the local flow matches production without a verification bypass.
31. As a maintainer, I want auth-triggered email sending to use Worker scheduling, so that sign-up and sign-in responses are not blocked by email delivery latency.
32. As a maintainer, I want email send failures logged, so that operational problems are visible without changing auth access semantics.
33. As a maintainer, I want to defer a durable email queue, so that this slice avoids retry infrastructure until retry, audit, or provider-switching needs justify it.
34. As a maintainer, I want a generic email sending module, so that account verification, password reset, and future invitation emails can share the same small interface.
35. As a maintainer, I want the generic email module to require callers to provide sender identity, so that different transactional emails can use different `from` addresses later.
36. As a maintainer, I want email templates stored as code-owned render modules, so that templates are reusable, testable, and easy to add without adding a database or runtime templating system.
37. As a maintainer, I want each transactional email type in its own render module, so that future templates do not create one large, shallow template file.
38. As a maintainer, I want the **Account email verification** template named with the glossary term, so that code search connects implementation to domain language.
39. As a maintainer, I want generated Wrangler types to be the source of truth for Worker bindings, so that `EMAIL` and future binding shapes are not hand-rolled.
40. As a maintainer, I want application domain types to remain separate from generated Worker binding types, so that domain modeling stays stable while platform bindings are generated.
41. As a maintainer, I want session-read code to avoid requiring Worker scheduling context, so that simple session reads stay easy to call and test.
42. As a maintainer, I want auth-route code to provide Worker scheduling context, so that hooks that can send email use `waitUntil` correctly.
43. As a maintainer, I want personal **Workspace** bootstrap to check existing accepted **Workspace membership** before creating anything, so that verification and social sign-in paths are safe to retry.
44. As a maintainer, I want no migration that marks existing unverified users as verified, so that the new verification rule is not undermined by grandfathering.
45. As a maintainer, I want no password reset flow in this slice, so that the work remains focused on **Account email verification**.
46. As a maintainer, I want no admin-editable email templates in this slice, so that we avoid premature product and schema decisions.
47. As a maintainer, I want no email provider abstraction in this slice, so that Cloudflare Email Sending remains the direct integration until another provider is actually needed.
48. As a maintainer, I want focused unit tests around email rendering and scheduling, so that core behavior can be verified without full auth integration.
49. As a maintainer, I want focused auth behavior tests, so that required verification and post-verification Workspace bootstrap do not regress.
50. As a maintainer, I want frontend auth behavior tested through user-visible outcomes, so that the **Account verification prompt** and unverified sign-in message remain correct.
51. As an AI coding agent, I want **Account email verification** documented in the domain contexts, so that future auth and email work uses the same vocabulary.

## Implementation Decisions

- Add a Cloudflare Email Sending binding named `EMAIL` and use generated Wrangler Worker types as the source of truth for the binding shape.
- Configure local development to use the real Cloudflare Email Sending service rather than a verification bypass.
- Stop manually exporting Worker binding types from the application domain types module; keep application domain types there and rely on generated Worker `Env` for bindings.
- Create a deep email sending module with a small generic interface for immediate sending and non-blocking scheduling.
- The generic email sending module requires callers to provide sender identity rather than reading a global sender from configuration.
- Auth-triggered email sends use Worker scheduling when available so that sign-up and sign-in responses do not await Cloudflare Email Sending.
- Scheduled email send failures are logged and do not synchronously fail sign-up or sign-in responses.
- Do not introduce a durable email queue for this slice; direct Cloudflare Email Sending is sufficient until durable retry, audit, or provider-switching requirements emerge.
- Create a code-owned **Account email verification** template render module that returns sender, subject, HTML body, and plain-text body.
- Store transactional email templates as one render module per email type, rather than a database, file-system runtime templates, or one central growing template list.
- Send **Account email verification** from `Document Extraction <no-reply@extract.t3m.uk>`.
- Use the subject `Verify your Document Extraction account`.
- Include a verification link and unexpected-recipient ignore guidance in both HTML and text email bodies.
- Configure Better Auth email verification with a send hook, send-on-sign-up, send-on-sign-in, required email verification for email/password sign-in, and automatic sign-in after verification.
- Use the application root as the verification callback target.
- Move personal **Workspace** bootstrap from Better Auth user creation to successful **Account email verification** for email/password accounts.
- Treat a trusted social provider's verified email claim as satisfying **Account email verification** without sending a separate Document Extraction verification email.
- Keep verified Google social sign-in as a complete onboarding path that can create a personal **Workspace** when needed.
- Make personal **Workspace** bootstrap idempotent by checking accepted **Workspace membership** before creating a personal **Workspace**.
- Pending **Workspace invitations** do not suppress post-verification personal **Workspace** creation because pending invitations do not satisfy the accepted **Workspace** invariant.
- Existing unverified email/password users are blocked on future sign-in, but this slice does not forcibly invalidate existing sessions.
- Do not add a migration that marks existing unverified users as verified.
- Update the frontend sign-up flow so successful email/password sign-up shows an **Account verification prompt**, does not refetch session, and does not attempt to resolve a **Workspace**.
- Update frontend unverified sign-in handling so users are told to verify their email and that a new verification link was sent.
- Do not add a separate resend verification control in this slice; sign-in retry sends a new verification link.
- Do not implement password reset email sending in this slice.
- Do not create an ADR for this slice because the decisions are documented, reversible, and unsurprising at this stage.

## Testing Decisions

- Tests should verify external behavior and stable module contracts rather than implementation details such as exact private helper names or internal branching.
- The email template render module should be tested as a pure function: the result includes the agreed sender, subject, verification URL in HTML, verification URL in text, and unexpected-recipient guidance.
- The email scheduling module should be tested through its public scheduling behavior: it calls Worker scheduling when provided and logs send failures without throwing synchronously.
- Auth behavior tests should verify that email/password sign-up triggers the verification flow without granting access, and that unverified email/password sign-in is blocked while sending a fresh verification link.
- Post-verification bootstrap tests should verify idempotent personal **Workspace** creation: a user with no accepted **Workspace membership** receives one, while a user who already has accepted **Workspace membership** does not receive a duplicate.
- Social sign-in behavior should preserve the rule that trusted provider-verified email satisfies **Account email verification** without a separate verification email.
- Frontend auth tests should verify user-visible behavior: sign-up success shows the **Account verification prompt** and does not refetch session, while unverified sign-in displays the agreed verification message.
- Prior art exists in backend unit tests for isolated policy modules, index/auth routing tests, workspace policy behavior tests, and frontend auth controller tests.
- Verification should include backend typecheck after Wrangler types are regenerated.
- Verification should include the relevant backend Vitest tests and frontend build because the auth UI changes.

## Out of Scope

- Password reset email sending and any forgot-password frontend flow.
- Workspace invitation emails or outbound email for **Workspace invitations**.
- A separate resend verification email button.
- Durable email queueing, retry orchestration, audit tables, or provider failover.
- Admin-editable email templates, database-backed templates, localization, template previews, or template management UI.
- Marketing or bulk email.
- Retroactive invalidation of existing sessions for users whose email is currently unverified.
- Backfilling existing unverified email/password users as verified.
- New public API endpoints outside Better Auth's built-in verification flow.
- A dedicated verification-success frontend route or page.
- An ADR for the initial code-owned template/direct-send approach.

## Further Notes

- The backend context now defines **Account email verification** as proof that a user controls the email address used for application access.
- The frontend context now defines **Account verification prompt** as the auth-screen message telling an email/password user to verify their email before account access is available.
- The current backend already has Better Auth's `user.emailVerified` field and `verification` table, so no new schema is expected for the core verification flow.
- Better Auth documentation recommends avoiding awaited email sends in verification hooks and using `waitUntil` or an equivalent serverless scheduling mechanism.
- Cloudflare Email Sending documentation recommends generated Wrangler types for the Email Sending binding.
- The production sender domain has already been onboarded to Cloudflare Email Sending.
