# Issue tracker: Local Markdown

Local issues and PRDs are Markdown files in `.scratch/`. Git ignores this directory. It is not published to GitHub.

## Conventions

- Use one directory per feature: `.scratch/<feature-slug>/`.
- Store the PRD at `.scratch/<feature-slug>/PRD.md`.
- Store implementation issues at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`. Start numbering at `01`.
- Put a `Status:` line near the top of each issue. Use the role strings in `triage-labels.md`.
- Append comments and conversation history under `## Comments` at the end of the file.

## When a skill says "publish to the issue tracker"

Create a file under `.scratch/<feature-slug>/`. If necessary, create the directory first.

## When a skill says "fetch the relevant ticket"

Read the file at the supplied path. The user normally supplies a path or issue number.

## Wayfinding operations

- Store the canonical map at `.scratch/<feature-slug>/map.md`. Set `Labels: wayfinder:map`. Store decision tickets in the feature's `issues/` directory. Assign one label: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Use each title as its displayed name. Give each issue a unique `ID:` within its feature. Include `State: open|closed`, a canonical triage `Status:`, and `Assignee: unassigned|<dev>`. Set `Parent:` to the map. The map has no parent. IDs identify records. Use titles in prose and links.
- Record dependencies after `Blocked by:`. Use relative Markdown links with ticket titles, or `none`. Create referenced tickets before adding dependency links. The tracker has no built-in parent or blocking relationships.
- Find children by reading issue files whose `Parent:` points to the map. The frontier contains unassigned, open children with no open blocker. Sort it by numbered filename. Derive blocked status from dependencies. Do not maintain a separate blocked state.
- Before work, assign the ticket to the developer responsible for the map. Immediately before editing, read the issue again. Keep claims and edits from other sessions.
- To resolve a ticket, append its resolution under `## Comments`. Set `State: closed` and `Status: completed`. Add a one-line, title-linked summary to the map's Decisions so far. Keep the full resolution only in the ticket. Link supporting assets instead of copying them.
- Close out-of-scope tickets with `Status: wontfix`. Add a title-linked explanation under Out of scope in the map. Do not add it under Decisions so far.
- Do not list open tickets in the map. Query children and dependencies to find the frontier. Maps and tickets remain ignored local planning data.
