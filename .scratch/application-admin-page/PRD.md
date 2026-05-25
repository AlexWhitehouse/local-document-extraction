# PRD: Application Admin Page

Status: needs-triage

## Problem Statement

Document Extraction has workspace-scoped administration for owners and admins, but it does not have an application-wide account management surface. The user needs trusted Application admins to manage Better Auth user accounts without confusing that authority with Workspace membership roles.

Today, account-level operations such as finding users, granting Application admin authority, banning compromised or abusive users, unbanning users, and impersonating regular users are not available in the SPA. Operational recovery also depends on direct database knowledge because the Better Auth admin plugin schema is not present yet.

The feature must avoid content layout shifts for non-admin users while determining admin navigation visibility, preserve the existing SPA layout, and keep Application admin account management independent from Workspace context resolution.

## Solution

Add an Application admin page backed by Better Auth's admin plugin utilities. The page is visible only to users whose authenticated Better Auth application role is `admin`. Workspace owners/admins do not automatically receive Application admin access.

The first slice gives Application admins a focused account-management surface. They can list users, search by email or name, paginate through newest accounts first, change a user between `user` and `admin`, permanently ban users with a required reason, unban users with confirmation, and impersonate eligible regular users. The page does not expose Workspace membership data or custom product admin routes.

Add the Better Auth admin plugin to the backend auth configuration, add the Better Auth admin client plugin to the existing runtime auth client, and add an explicit forward migration for the admin plugin user/session fields. The migration also safely promotes the known initial Application admin users when those users exist.

When an Application admin starts impersonation, the SPA clears session-scoped Workspace, Template, and Document UI state, refetches the session, and moves to the Workspace page. During impersonation, the main layout shows a persistent indicator naming the impersonated user with an immediate stop-impersonating action.

## User Stories

1. As an Application admin, I want to see an Admin page in the main sidebar, so that I can access application-wide account management.
2. As a non-admin user, I want not to see an Admin page in the main sidebar, so that I am not shown controls I cannot use.
3. As a non-admin user, I want the authenticated layout to render without shifting after admin visibility is checked, so that my app experience is stable.
4. As a non-admin user, I want accidental admin-page state to return me to the Workspace page, so that I never see a misleading unauthorized admin view.
5. As an Application admin, I want the Admin page to be separate from Workspace owner/admin tools, so that application-wide authority is not confused with Workspace membership.
6. As an Application admin, I want the Admin page to remain available during Loading workspace context, so that account management still works while workspace resolution is pending.
7. As an Application admin, I want the Admin page to remain available during Workspace resolution error, so that account management is not blocked by broken Workspace state.
8. As an Application admin, I want the Admin page to preserve the app's visual structure, so that account management feels like part of the existing SPA.
9. As an Application admin, I want the context sidebar to show admin-specific account-management context, so that I am not misled by Workspace, Template, or Document lists.
10. As an Application admin, I want workspace-specific toolbar content hidden on the Admin page, so that workspace actions are not confused with account actions.
11. As an Application admin, I want the Admin sidebar item to have no count badge, so that no ambiguous user-count meaning is implied.
12. As an Application admin, I want total user count shown inside the Admin page after loading, so that I can understand the list scope.
13. As an Application admin, I want to list Better Auth users, so that I can find accounts that need operational attention.
14. As an Application admin, I want users sorted by newest accounts first, so that recent registrations are easy to inspect.
15. As an Application admin, I want a fixed page size of 25 users, so that the table remains readable.
16. As an Application admin, I want previous and next pagination, so that I can browse the user list predictably.
17. As an Application admin, I want a simple in-panel loading state, so that I know when the user list is being fetched.
18. As an Application admin, I want list-loading failures shown inline, so that I can retry or understand the problem.
19. As an Application admin, I want Action toasts for admin operation outcomes, so that success and failure feedback is consistent with the rest of the app.
20. As an Application admin, I want to search users manually, so that I control when the list request runs.
21. As an Application admin, I want to clear search back to the first unfiltered page, so that I can recover from a narrow search.
22. As an Application admin, I want to choose whether search targets email or name, so that I can use Better Auth's supported search model clearly.
23. As an Application admin, I want email search to be the default, so that the primary account identifier is easiest to use.
24. As an Application admin, I want the page not to expose role or banned-status filters in the first slice, so that account management stays simple.
25. As an Application admin, I want to see each user's email, so that I can identify accounts by their primary account address.
26. As an Application admin, I want to see each user's name, so that I can recognize accounts more easily.
27. As an Application admin, I want to see each user's account email verification status, so that I can understand whether email/password access is verified.
28. As an Application admin, I want to see each user's application role, so that I know whether they are a regular user or Application admin.
29. As an Application admin, I want to see each user's banned status, so that I know whether the account can sign in.
30. As an Application admin, I want to see ban reason when relevant, so that I understand why an account was disabled.
31. As an Application admin, I want to see exact local account creation date/time, so that support and operational timelines are clear.
32. As an Application admin, I want Better Auth user IDs hidden, so that internal identifiers do not clutter the admin UI without a user-facing use case.
33. As an Application admin, I want authentication provider/source hidden in the first slice, so that the page stays focused on data available from Better Auth user listing.
34. As an Application admin, I want Workspace membership summaries hidden, so that the page remains account-focused rather than product-domain administration.
35. As an Application admin, I want Workspace data management out of this page, so that account operations do not accidentally affect Workspace resources.
36. As an Application admin, I want to make a regular user an Application admin, so that trusted users can help manage accounts.
37. As an Application admin, I want to remove Application admin authority from another Application admin, so that global account-management access can be revoked.
38. As an Application admin, I want role changes to require confirmation, so that I do not change global authority accidentally.
39. As an Application admin, I want stronger confirmation language when removing Application admin authority, so that the impact is clear.
40. As an Application admin, I want self-demotion blocked, so that I do not accidentally lock myself out.
41. As an Application admin, I want role changes to reload the current user list after success, so that I see current account state.
42. As an Application admin, I want role changes not to trigger custom session invalidation, so that the first slice avoids session-management side effects.
43. As an Application admin, I want to permanently ban a user with a required reason, so that account access can be disabled with context.
44. As an Application admin, I want temporary ban duration hidden in the first slice, so that the ban flow stays simple.
45. As an Application admin, I want banning to use a confirmation modal with a required reason field, so that I must intentionally disable an account.
46. As an Application admin, I want self-ban blocked, so that I do not accidentally lock myself out.
47. As an Application admin, I want to ban another Application admin with explicit confirmation, so that compromised admin accounts can be disabled.
48. As an Application admin, I want bans to affect account sessions and future sign-in, so that disabled users cannot access the app through Better Auth.
49. As an Application admin, I want bans not to automatically delete Workspace memberships, so that product-domain access data remains durable until explicitly changed.
50. As an Application admin, I want bans not to automatically rotate Workspace API keys, so that workspace-owned external credentials are not changed by account bans.
51. As an Application admin, I want banned users to receive Better Auth's default banned-user sign-in message, so that sign-in behavior stays plugin-standard.
52. As an Application admin, I want to unban a user, so that account access can be restored.
53. As an Application admin, I want unban confirmation to show the user's email and existing ban reason, so that restoring access is deliberate.
54. As an Application admin, I want ban and unban operations to reload the current user list after success, so that I see current banned state.
55. As an Application admin, I want to impersonate an eligible regular user, so that I can see the app from that user's account experience.
56. As an Application admin, I want impersonation to require confirmation naming the target user, so that I do not enter another user's context accidentally.
57. As an Application admin, I want confirmation to explain that impersonation leaves the Admin page and enters the target user's app experience, so that the transition is clear.
58. As an Application admin, I want self-impersonation blocked, so that redundant no-op impersonation is not available.
59. As an Application admin, I want impersonation of other Application admins blocked, so that admins cannot impersonate admins.
60. As an Application admin, I want impersonation of banned users blocked until unbanned, so that banned account semantics remain clear.
61. As an Application admin, I want successful impersonation to clear session-scoped Workspace, Template, and Document UI state, so that stale admin-user state is not shown under the impersonated account.
62. As an Application admin, I want successful impersonation to refetch the session, so that the SPA uses the impersonated session consistently.
63. As an Application admin, I want successful impersonation to move to the Workspace page, so that the impersonated user goes through normal Workspace resolution.
64. As an impersonating Application admin, I want a persistent main-layout impersonation indicator, so that I cannot forget I am acting as another user.
65. As an impersonating Application admin, I want the indicator to name the current impersonated user, so that the active account context is clear.
66. As an impersonating Application admin, I want the original admin's Better Auth user ID hidden, so that internal identifiers are not shown unnecessarily.
67. As an impersonating Application admin, I want a Stop impersonating action, so that I can return to my admin session.
68. As an impersonating Application admin, I want Stop impersonating to be immediate, so that exiting impersonation is quick.
69. As an impersonating Application admin, I want stopping impersonation to clear session-scoped Workspace, Template, and Document UI state, so that stale impersonated-user state is not retained.
70. As an impersonating Application admin, I want stopping impersonation to refetch the session, so that the restored admin account is active.
71. As an impersonating Application admin, I want stopping impersonation to return me to the Admin page when my restored session is an Application admin, so that I can continue account management.
72. As a backend maintainer, I want Better Auth admin plugin fields added through an explicit forward migration, so that schema changes are durable and reviewable.
73. As a backend maintainer, I want the one-time admin promotion to be safe when a known user does not exist, so that migration can run across environments without failure.
74. As a backend maintainer, I want Better Auth application role persisted as a user field, so that the frontend can derive admin visibility from the resolved session.
75. As a backend maintainer, I want Better Auth application role treated as single-valued, so that app behavior only distinguishes `user` and `admin`.
76. As a backend maintainer, I want no database check constraint on Better Auth role, so that Better Auth schema flexibility is not constrained unnecessarily.
77. As a backend maintainer, I want Better Auth synthetic user responses to include admin plugin fields, so that email-verification flows do not expose a different user shape from real account records.
78. As a backend maintainer, I want Better Auth admin endpoints served by the existing Better Auth handler delegation, so that no custom product admin route is needed.
79. As a frontend maintainer, I want the existing runtime auth client to include the Better Auth admin client plugin, so that auth base URL and credentials logic stay centralized.
80. As a frontend maintainer, I want admin loading and mutation state local to the admin feature, so that unrelated workspace/template/document busy state does not disable admin controls.
81. As a frontend maintainer, I want the Application admin page implemented through the existing feature-controller pattern, so that table state and mutations are testable outside the SPA root.
82. As a frontend maintainer, I want admin styles in the existing global stylesheet with feature-specific class names, so that no new styling pattern is introduced.
83. As a product maintainer, I want no custom admin audit log in the first slice, so that the feature does not introduce a partial audit system.
84. As a product maintainer, I want deleting users out of scope, so that irreversible account destruction is not introduced early.
85. As a product maintainer, I want creating users out of scope, so that the first slice focuses on managing existing accounts.
86. As a product maintainer, I want password setting out of scope, so that sensitive credential changes are not introduced early.
87. As a product maintainer, I want manual session revocation out of scope, so that session-management complexity is deferred.
88. As a product maintainer, I want user name and account email editing out of scope, so that Account email verification and Workspace invitation semantics remain untouched.

## Implementation Decisions

- Build an Application admin frontend feature using the existing feature-controller pattern. The controller should encapsulate user listing state, search state, pagination state, confirmation modal state, mutation state, and Better Auth admin utility calls behind a small interface consumed by the page component.
- Modify the app shell to derive `isApplicationAdmin` from the resolved authenticated session before rendering the authenticated layout. Use exact single-role semantics: only `role === "admin"` is an Application admin.
- Add `Admin` as a fourth main sidebar page only for Application admins. The item has no count badge in the first slice.
- If non-admin frontend state attempts to show the Application admin page, return to the Workspace page rather than rendering an unauthorized admin view.
- Keep the existing no-URL-routing model. Refreshing the SPA continues to start from the Workspace page.
- Do not render workspace-specific toolbar content on the Application admin page. Preserve the established page layout and visual structure with an admin-owned page header/actions area.
- When the Application admin page is active, render admin-specific context sidebar content rather than Workspace, Template, or Document lists.
- Keep the global Upload Document sidebar button visible and governed by existing workspace API access enablement rules. Do not special-case it for the Admin page in the first slice.
- Add Better Auth's admin plugin to the backend auth configuration. Do not pass `adminUserIds`; bootstrap is database-backed through the migration.
- Add Better Auth's admin client plugin to the existing runtime auth client rather than creating a separate admin-only client.
- Use Better Auth admin client utilities directly from the SPA. Do not add custom product `/v1/admin/*` routes in the first slice.
- Keep Better Auth admin endpoints under the existing `/api/auth/*` Better Auth handler delegation.
- Add an explicit forward migration for the Better Auth admin plugin fields: persisted application role, banned flag, ban reason, ban expiry, and impersonation source on sessions.
- Use a safe one-time role promotion update for the known initial Application admin user IDs. Missing IDs should update zero rows and not fail the migration.
- Do not add a database check constraint to the Better Auth role field. The application enforces single-valued `user` or `admin` semantics through behavior.
- Add Better Auth synthetic user shape support for admin plugin fields because email/password access requires Account email verification.
- Keep Better Auth's default banned-user sign-in message.
- The first user table shows email, name, email verification status, application role, banned status, ban reason when relevant, and exact local account creation date/time.
- The first user table does not show Better Auth user IDs, authentication provider/source, Workspace membership summaries, or Workspace data.
- User listing uses fixed page size 25, newest accounts first, and previous/next pagination.
- User search uses one input plus a field selector for email or name, defaults to email, submits manually, and can be cleared back to the first unfiltered page.
- Do not expose role filters or banned-status filters in the first slice.
- Role changes are per-row `Make admin` or `Remove admin` actions with confirmation, not inline role dropdown editing.
- Do not allow an Application admin to demote their own application role.
- Do not add custom session invalidation after role changes in the first slice.
- Ban users through a confirmation modal with a required free-text reason. Bans are permanent; temporary ban duration is not exposed.
- Do not allow an Application admin to ban their own account.
- Allow banning another Application admin with explicit confirmation.
- Unban users through a confirmation modal that shows the user's email and existing ban reason.
- Reload the current user list after successful role changes, bans, and unbans.
- Starting impersonation requires confirmation that identifies the target user and explains that the admin will leave the Admin page and enter that user's app experience.
- Do not allow self-impersonation, impersonating other Application admins, or impersonating banned users.
- After successful impersonation, clear session-scoped Workspace, Template, and Document UI state, refetch the session, and move to the Workspace page. Do not reload the admin list after impersonation.
- Read impersonation state from Better Auth's session response rather than a custom product session endpoint.
- During impersonation, show a persistent main-layout indicator naming the current impersonated user, with an immediate Stop impersonating action.
- Stopping impersonation calls Better Auth's stop-impersonating utility, clears session-scoped Workspace, Template, and Document UI state, refetches the session, and returns an Application admin to the Admin page. It does not require confirmation.
- Admin list and mutation state stays local to the admin feature. Do not use the app-wide busy flag for admin list or mutation requests.
- Use the existing global frontend stylesheet with feature-specific admin class names. Do not introduce CSS modules or a new styling pattern.
- Do not create an ADR for using Better Auth admin utilities directly. The decision is documented here and in domain context, and can be reversed later if custom audit logging, joins, or response shaping become necessary.

## Testing Decisions

- Good tests should assert external behavior visible to users or callers, not internal component structure. Avoid brittle styling assertions and avoid testing Better Auth endpoint internals.
- Add backend configuration tests for Better Auth admin setup using the existing mock-based auth configuration test style.
- Backend tests should verify the admin plugin is configured, no config-based admin user ID bootstrap is required, synthetic user responses include admin plugin fields, and existing Account email verification and personal Workspace bootstrap behavior remains intact.
- Backend tests should not re-test Better Auth's admin endpoints. Better Auth owns those internals.
- Add focused frontend coverage for admin visibility and layout safety using the existing React/Vitest testing style.
- Frontend tests should verify non-admin sessions do not see the Admin sidebar item.
- Frontend tests should verify Application admin sessions see the Admin sidebar item and that it has no count badge.
- Frontend tests should verify a non-admin admin-page state returns to the Workspace page rather than rendering an unauthorized admin view.
- Frontend tests should verify admin visibility is based on the resolved session role rather than a later permission check that causes content layout shift.
- Frontend tests should verify self-demotion, self-ban, and self-impersonation controls are disabled or absent.
- Frontend tests should verify banned users and Application admins are not eligible impersonation targets.
- Frontend tests should verify role changes, bans, and unbans show confirmation before calling Better Auth admin utilities.
- Frontend tests should verify missing ban reason is handled as recoverable inline validation.
- Frontend tests should verify successful role changes, bans, and unbans reload the current user list and show Action toasts.
- Frontend tests should verify successful impersonation clears session-scoped state and navigates to the Workspace page.
- Frontend tests should verify the impersonation indicator appears in the main layout, names the current impersonated user, and does not show Better Auth user IDs.
- Frontend tests should verify Stop impersonating clears session-scoped state, refetches the session, returns the restored admin to the Admin page, and does not require confirmation.
- Frontend tests should verify the Admin page remains usable during Loading workspace context and Workspace resolution error because it is not workspace-scoped.
- Prior frontend test examples include auth-screen behavior, workspace context UI behavior, and feature-controller tests. The admin feature should follow those patterns instead of asserting implementation details.
- Prior backend test examples include Better Auth configuration tests and policy tests. The admin setup should extend the configuration-test style rather than adding product route tests.

## Out of Scope

- Deleting users.
- Creating users.
- Setting or resetting user passwords.
- Manually revoking sessions.
- Custom audit logging for admin actions.
- Custom product `/v1/admin/*` routes.
- Workspace membership summaries.
- Workspace data management.
- User name editing.
- Account email editing.
- Authentication provider/source display.
- Temporary bans or ban expiry configuration.
- Role or banned-status filters.
- Page-size selection.
- Sortable table columns.
- Multi-role Better Auth UI.
- Showing Better Auth user IDs in the admin UI.
- Admin-to-admin impersonation.
- Custom banned-user sign-in messages.
- Introducing URL routing for the Admin page.
- Introducing CSS modules or a new styling system.
- Creating an ADR for this first slice.

## Further Notes

- Application admin authority is application-wide and separate from Workspace owner/admin membership. Workspace owners/admins do not receive Application admin access unless their Better Auth application role is `admin`.
- The Better Auth application role is single-valued in Document Extraction: a user is either `user` or `admin` in the application-wide auth context.
- The migration's one-time promotion uses known Better Auth user IDs, but those IDs are operational/bootstrap data and should not appear in the admin UI.
- The Application admin page is account-level and must not depend on accepted Workspace context or Workspace API access.
- Banning a user affects Better Auth account access. It does not automatically delete Workspace memberships or rotate Workspace API keys.
- The first slice intentionally avoids product-domain joins and custom audit logging. Those can be revisited if support workflows require account history or Workspace-aware administration.
