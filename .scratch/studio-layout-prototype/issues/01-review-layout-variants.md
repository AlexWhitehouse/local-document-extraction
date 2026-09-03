# Studio main-area layout study: refine A1, B2 and C1

Status: completed

## Question

How can the main workspace, template and document areas have fewer bordered, rounded cards while preserving the existing Studio visual language and both sidebar menus?

## Primary source

- Throwaway branch: `codex/studio-layout-prototype`
- Prototype: `frontend/src/features/layout/prototype/`
- Run: `bun run prototype:layouts`
- Start: <http://127.0.0.1:5173/?prototype=layouts&variant=A1>

## Delivered

Three selected, interactive, development-only layouts with fictional, in-memory records. The production sidebar components and CSS are reused. The floating switcher supports direct selection, cycling, keyboard navigation, shareable URLs and browser history. The original nine-way study is preserved in the prototype branch history.

## Verdict

The user selected A1 for workspaces, B2 for templates and C1 for documents. All other layouts were removed from the active prototype. These refinements were subsequently approved for production implementation. See `.scratch/studio-layout-implementation/issues/01-ship-selected-layouts.md` for the implementation and verification record.

- A1: move Save name inside the name input, aligned right; remove its visibility helper text and the KPI section. Bound the user list with independent scrolling. Place Delete Workspace next to Create Workspace.
- B2: remove the Field designer heading, its subtitle and the adjacent Add field button. Keep the existing Add field action in the field list. Make the field list scroll independently without extending the main area. Move View JSON to the footer and Save changes immediately after Remove field, with matching styling apart from colour. Place Create Template and Delete Template in the header.
- C1: remove result-filter tabs, field expansion controls and the review count. Replace Source with Evidence, display evidence in static rows, and remove the invoice-specific total below line items. Rename Jobs to Documents and place Delete before Upload. Delete and Export reflect and act on the checked-document count.
- Shared: one title grid, padding, margins, gaps, font sizing and action height across the three pages, with title and action centres aligned. Deleting the last sample shows a recoverable empty state.

## Verification

The selected layouts were inspected in the browser. Workspace rename works through the inline button. The workspace user list scrolls internally without moving the page. At the default 1280×720 viewport, the template field list and editor each scroll independently; adding a field does not increase page height. Relocated Save changes persists preview edits and View JSON reflects them. Selecting four documents yields Delete 4 / Export 4; export contains those four records and deletion removes only those four, then resets the selection. Header measurements match across A1, B2 and C1, including title/action vertical centres. Scoped ESLint, the production build and all four existing DocumentContextList tests pass. Unrelated workspace configuration edits remain excluded from the prototype capture.
