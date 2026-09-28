# Issue tracker: Local Markdown

Local issues and PRDs live as markdown files in `.scratch/`. The entire directory is ignored and is not published to GitHub.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

- The canonical map is `.scratch/<feature-slug>/map.md`, with `Labels: wayfinder:map`. Decision tickets live under the same feature's `issues/` directory and carry one `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task` label.
- Use the title as the human-facing name. Each issue has a unique `ID:` within the feature, `State: open|closed`, a canonical triage `Status:`, `Assignee: unassigned|<dev>`, and `Parent:` linking to the map. The map has no parent. IDs identify records; prose and links use their titles.
- This tracker has no native parent or blocking relationships. Express dependencies with `Blocked by:` followed by relative Markdown links using ticket titles, or `none`. Create all referenced tickets before wiring dependencies.
- List children by scanning the feature's issue files for `Parent:` pointing to the map. The frontier is children with `State: open`, `Assignee: unassigned`, and no blocker whose `State:` is open. Order the frontier by the numbered filenames. Blocked status is derived from dependency state, not maintained separately.
- Claim a ticket by assigning it to the dev driving the map before work. Re-read the issue immediately before changing it to preserve another session's claim or edits.
- Resolve a ticket by appending a resolution comment under `## Comments`, setting `State: closed` and `Status: completed`, and adding a title-linked one-line gist to the map's Decisions so far. Keep the resolution itself only in the ticket. Link supporting assets rather than copying their contents.
- Out-of-scope tickets close with `Status: wontfix` and a title-linked explanation in the map's Out of scope, not Decisions so far.
- The map does not enumerate open tickets; query children and dependencies to discover the frontier. All map and ticket files remain ignored local planning data.
