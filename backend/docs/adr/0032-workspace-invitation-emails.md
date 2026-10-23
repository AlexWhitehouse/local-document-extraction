# Workspace invitation emails

Workspace invitations now send transactional email by default through the same mail sink as Account email verification and Account password reset. Delivery is best effort so a provider failure cannot undo access offered by a Workspace owner/admin.

This supersedes the email verification default in [ADR 0011](0011-portable-local-installation-configuration.md) and the verification recommendation in [ADR 0031](0031-invite-only-sign-up.md).

## Decision

- Keep Workspace control free of mail I/O. One application service creates invitations and attempts email for both HTTP and MCP. Local mail captures a `workspace_invitation`; Cloudflare sends it. A failed send leaves the invitation available for direct sharing. Cancellation sends nothing.
- Record every email attempt in control data without addresses or names. Count failed provider calls against limits to prevent provider failures from opening an abuse path. Rate-limited attempts are recorded but do not consume email or resend quotas. Reserve the attempt before awaiting delivery.
- Permit at most 20 email attempts per Workspace and 50 per acting user across all Workspaces in a rolling 24 hours. Record the acting user on every attempt and bound Workspace and actor quota lookups to that window in SQL, with indexes for invitation, Workspace and actor lookups. Resends require a 10-minute cooldown after the last attempt and allow at most 3 resends per invitation. A capped create still succeeds; a capped resend returns 429 without refreshing expiry. An allowed resend refreshes expiry to 7 days even if delivery fails.
- Keep expired pending invitations manageable. Creating a replacement cancels old expired pending invitations for that address. Resending cannot revive an expired invitation alongside an unexpired pending invitation for the same address.
- Email links choose sign-up or sign-in based on account existence. Inviter-visible links omit this choice so they reveal no account existence information. Links grant no authority: accepting still requires a matching signed-in account.
- Use a fixed subject and escaped, bounded user content in the shared email layout. Email discloses the Workspace name and inviter’s name and address to the recipient; it contains no credentials or document content. Analytics includes only Workspace ID, trigger and provider.
- Default `AUTH_REQUIRE_EMAIL_VERIFICATION` to `true`. Invitations identify recipients by email, so proving address control prevents a new account from claiming another person’s invitation in invite-only mode.

## Consequences

Local installations must retrieve verification links from captured mail; shared installations should configure delivery. Operators explicitly setting verification to `false` retain that behavior and accept the risk of someone registering an invited or admin address they do not control. Existing signed-in sessions are unchanged.

Provider acceptance does not prove inbox delivery. The inviter always has a shareable link. Attempts survive Workspace and invitation deletion, including hard erase, so recreating Workspaces cannot bypass the actor quota. The table contains only opaque attempt, Workspace, invitation and acting user IDs, trigger, outcome and timestamps; it contains no addresses or names. Recording an attempt opportunistically prunes rows older than seven days in batches of at most 500 using an attempted-at index. Cleanup catches up on subsequent writes; inactive installations retain old rows until the next write. Pruning also bounds the invitation history used for resend metadata and limits to the retained seven-day window.
