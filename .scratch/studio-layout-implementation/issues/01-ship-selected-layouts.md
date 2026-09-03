# Implement the selected Studio layouts

Status: completed

User approved A1, B2 and C1 from `frontend/src/features/layout/prototype/` and asked to implement them in the real app. The existing prototype remains available for reference.

## Requirements

- Preserve both existing sidebars, with Jobs renamed Documents in the document UI.
- A1: open settings layout, no KPI cards, inline Save name, no visibility helper, bounded independently scrolling user list, and Create Workspace / Delete Workspace in the header. Keep member Leave Workspace semantics and permissions.
- B2: open split editor with independent field-list and inspector scrolling. Remove the Field Designer heading/subtitle/duplicate Add field action. View JSON replaces the footer create action. Save changes sits to the right of Remove field with matching text styling and a different colour. Create Template / Delete Template occupy the header.
- C1: static field / extracted value / confidence / evidence table. Remove field expansion controls, review tabs/count, and invoice-specific totals. Render arbitrary structured results using their real fields. Delete precedes Upload. Delete and Export show the checked-document count.
- Shared title spacing, typography and vertical alignment of header actions across all three pages.
- Preserve real APIs, permissions, gateway configuration, invitations, object-schema editing, validation, busy states, deletion confirmations, loading/failure states and actual XLSX export. Export of mixed selections retains skipped-document reporting; exporting with no checkboxes targets the open terminal document.

## Verification

Implemented in the production App and feature components. The prototype is retained as a development-only reference.

- Root `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build` pass. The frontend suite contains 239 passing tests, including real controller action targets, mixed-selection export, current-document export, structured results and schema-dialog focus trapping.
- `bun run test:e2e` passes all four real-runtime journeys: account recovery, application administration, extraction/upload/save/XLSX export/deletion, and workspace creation/rename/key rotation/invitations/member changes/leave/delete.
- CUA inspected the real built app at 1280×720 with a disposable verified account, local gateway fixture, four extracted documents and four workspace members.
- All three title sections measured 135.34px high with 24px vertical padding and matching title/action centres at y=78.5px.
- A1 user-list scrollTop changed from 0 to 59.5px while page scroll remained 482px. The list was bounded to 202px with 261px of content.
- B2 outline and inspector scrolled to 39.5px and 58.5px independently; the page remained 720px high at scrollTop 0. Remove field / Save changes have matching 32px height, typography and transparent borderless styling, with distinct colours and Save changes on the right. The schema modal remains outside the clipped editor and traps/restores keyboard focus.
- C1 renders the real result in a borderless static evidence table. Four checked documents show Delete 4 / Export 4. Structured medical/table results are covered by component tests without invoice-specific headings or totals.
- Test-generated changes to the shared CI artifact folder were restored after verification. Existing workspace-configuration edits were preserved. No live user data was used for deletion or export verification.
