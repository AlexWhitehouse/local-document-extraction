# Studio layout study — throwaway prototype

Selected directions: A1 for workspaces, B2 for templates and C1 for documents. Refine these while keeping the current Studio UI and both sidebars.

Run from the repository root:

```sh
bun run prototype:layouts
```

Open <http://127.0.0.1:5173/?prototype=layouts&variant=A1>.
The existing single-page route hosts the study behind development-only query parameters. Both sidebars use the original components and styles. The preview uses fictional, in-memory fixtures because this is a visual layout exercise; it does not need a session or backend. The production entry point remains the normal authenticated app and excludes the prototype module.

| Variant | Layout | Main interaction |
| --- | --- | --- |
| A1 | Open settings | Inline naming, a bounded user list, and workspace creation/deletion |
| B2 | Split editor | Independent field-list scrolling, field-level saving, and template actions |
| C1 | Results ledger | Static evidence rows and selection-aware document deletion/export |

Use the bottom switcher, the existing sidebar navigation or left/right arrow keys to move between the three selected layouts. The URL preserves the selection, including reloads and browser back/forward. Arrow keys in form controls keep their usual behavior. Old variant links resolve to the selected layout for that area. The six unselected layouts and their styles have been removed.

Search, sample selection, field editing, reordering, add/remove, workspace naming, and JSON preview are interactive. Creation, upload and deletion affect sample records only. Export opens a JSON preview of the selected documents, or the current document when no checkboxes are selected. Saves, invitations, connection checks, and key rotation are simulated and labelled as such. Refreshing resets sample edits. There is no production write path.

A1 has no KPI section. Save name sits inside the name input, and the user list has its own scroll region. Create Workspace and Delete Workspace sit together in the page header.

B2 has no Field designer heading, subtitle or duplicate Add field button. The remaining Add field action is at the bottom of the independently scrollable field list. On desktop, both editor columns fit the available viewport and scroll independently. Create Template and Delete Template occupy the header. Save changes sits to the right of Remove field with matching text-button styling and a different colour; View JSON is in the footer.

C1 has static field and evidence rows, without row expansion controls, filter tabs, a review count or an invoice-specific total below line items. The sidebar uses Documents terminology. Delete appears before Upload, and Delete / Export include the checked-document count. Empty states support adding fresh samples after the last item is removed.

All three pages use the same title grid, padding, gaps, typography and action height. The page title and header actions share a vertical centre.

Decision: the user selected A1, B2 and C1 and then approved implementation in the real app. The production components now implement these directions; this development-only study remains a reference. Implementation and verification are recorded in `.scratch/studio-layout-implementation/issues/01-ship-selected-layouts.md`. The study is captured on the throwaway `codex/studio-layout-prototype` branch, including the original nine-way study in its history. Selection and implementation context are recorded in `.scratch/studio-layout-prototype/issues/01-review-layout-variants.md`.

Verified in the browser: contained user-list scrolling, relocated template saving and JSON preview, document selection counts and action targets, creation/deletion, and matching header measurements at 1280×720. The headers each have 24px vertical padding and the same 135.34px height; title and action centres match. Scoped ESLint, the production build and all four existing DocumentContextList tests pass. No new tests were added for this throwaway study.
