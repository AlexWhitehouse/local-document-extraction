# Issue tracker: GitHub Issues

Issues and PRDs are GitHub issues in `AlexWhitehouse/local-document-extraction`. Use the `gh` CLI for every operation.

## Conventions

- Create issues with `gh issue create --title "<title>" --body-file <file>`. Write the body to a temporary file outside the repository. Never commit it.
- Apply triage labels from `triage-labels.md` with `--label`. New issues get `needs-triage` unless a skill names another role. Add `enhancement`, `bug` or `documentation` when one fits.
- File a PRD as one issue with the PRD as its body. File each implementation issue separately. Link it to the PRD with `Part of #<number>` at the top of its body.
- Record dependencies with a `Blocked by: #<number>` line in the issue body, or `Blocked by: none`.
- Add comments and conversation history with `gh issue comment <number>`.
- Never include secrets, `.env` values, `LITELLM_KEY`, local state or customer document content in an issue.

## When a skill says "publish to the issue tracker"

Create a GitHub issue with `gh issue create`. Report the returned URL.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`. The user normally supplies an issue number or URL.

## Resolving issues

- Link the PR with `Closes #<number>` so that merging the PR closes the issue.
- To close an issue without a PR, comment with the resolution, add the `completed` label, then run `gh issue close <number>`.
- Close out-of-scope issues with `gh issue close <number> --reason "not planned"` and the `wontfix` label. Comment with the reason.

## Local planning

Use `.scratch/` only when the user asks for local or private planning. Git ignores this directory. It is not published to GitHub.

- Use one directory per feature: `.scratch/<feature-slug>/`. Store the PRD at `PRD.md` and issues at `issues/<NN>-<slug>.md`. Start numbering at `01`.
- Put a `Status:` line near the top of each local issue. Use the role strings in `triage-labels.md`. Append history under `## Comments`.

## Wayfinding operations

Wayfinding maps and decision tickets are GitHub issues by default.

- The map is one issue with the `wayfinder:map` label. Each decision ticket gets one label: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`. Start the ticket's body with `Parent: #<map number>`.
- Record dependencies with `Blocked by: #<number>` lines, or `Blocked by: none`. Create referenced tickets before linking them.
- Find children by searching for the map reference: `gh issue list --search "Parent: #<map number>" --state open`. The frontier contains unassigned, open children with no open blocker. Sort it by issue number. Derive blocked status from dependencies. Do not maintain a separate blocked state.
- Before work, assign the ticket with `gh issue edit <number> --add-assignee @me`. Immediately before editing, view the issue again. Keep claims and edits from other sessions.
- To resolve a ticket, comment with its resolution, add the `completed` label, and close it. Add a one-line summary linking the ticket to the map's Decisions so far. Keep the full resolution only in the ticket.
- Close out-of-scope tickets as `not planned` with the `wontfix` label. Add a linked explanation under Out of scope in the map. Do not add it under Decisions so far.
- Do not list open tickets in the map. Query children and dependencies to find the frontier.
