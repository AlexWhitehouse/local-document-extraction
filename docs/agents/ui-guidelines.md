# UI guidelines

These rules keep the SPA consistent. Issue #64 introduced them. When a change conflicts with them, update this file in the same PR.

## Feedback: inline, toast, banner or modal

| Situation | Channel | Rules |
| --- | --- | --- |
| Field validation (required, format, mismatch, range) | Inline under the field | Set `aria-invalid` and `aria-describedby`. On submit, focus the first invalid field. Validate on submit and on blur. Never a toast. |
| Form-level submit failure | Inline `role="alert"` above the submit button | Keep the user's input. Text comes from `describeError`. |
| Completed user action | Action toast through `lib/notify.js` | Name the target. Show it as soon as the mutation succeeds and refresh in the background. Don't also show the outcome inline. |
| Cheaply reversible removal (draft-only) | Toast with **Undo** | No confirmation dialog. |
| Retryable action failure | Failure toast, with **Try again** where it helps | The mapped reason is appended automatically. Give counts for partial bulk failures. |
| One-time or must-act information | Persistent inline callout next to the control | Stays until dismissed or resolved. |
| Load failure of a page, section or list | `ErrorState` in that region | Never show the empty state on error. Always offer **Try again**. Keep the page header. |
| Loading | `Skeleton` or `LoadingState` at a fixed height | The pressed button shows a pending label ("Saving…") and is disabled. No app-wide busy flag: use `useAsyncAction`. |
| Ongoing system state (offline, live updates paused) | Banner | Polite live region. Clears when resolved. |
| Destructive, irreversible server action | `confirmDialog` | Never `window.confirm` (lint enforces this). |
| Errors inside an open modal | Inline only | No duplicate toast. |
| Background events the user didn't trigger | Silent, or a persistent state | Never a toast. |

## Shared building blocks

Use these before writing new markup. Most live in `frontend/src/features/ui/`.

| Need | Use |
| --- | --- |
| Buttons | `Button` (`variant`: primary, secondary, ghost, danger, text, danger-text; `size`; `pending`, `pendingLabel`) |
| Icon-only buttons | `IconButton`. `label` is required and is used for both `aria-label` and the tooltip. Icons come from `features/layout/Icons.jsx`. Never use text characters as icons. |
| Row "add" actions | `ListAddButton` |
| Action menus | `ActionMenu` |
| Page headers | `PageHeader` (linked `breadcrumbs`, `title`, optional `description`, `actions`, `compactActions`, `overflowActions`). Destructive and rare actions go in `overflowActions`. |
| Modals | `ModalDialog`, `ModalHeader` and `ModalFooter` from `features/layout/ModalDialog.jsx`. Every modal goes through them. They trap and restore focus, mark the app inert, and ask before discarding edits when `isDirty` is set. |
| Confirmations | `confirmDialog` from `confirm.jsx`, and `DISCARD_CHANGES` |
| Forms | `Field` (label, hint and error wired to the control), `TextInput`, `Textarea`, `Select`, `CheckboxField` |
| Status | `Badge`, `StatusBadge`, `StatusDot`, `Tag`, `CountBadge`, with `statusTone` and `statusLabel` from `lib/status.js`. One tone vocabulary: neutral, info, success, warning, danger. |
| Switching views | `Tabs` (tablist and panels) for views, `Segmented` (radio group) for one choice among a few options |
| Floating surfaces | `Popover`, `Tooltip` |
| Persistent messages | `Callout` (`tone`, optional `action`) |
| Tables | `DataTable` (`compact`, `matrix`) |
| File picking | `Dropzone`, with `features/documents/sourceFileValidation.js` |
| Paging | `Pager`, `LoadMore` |
| Load states | `EmptyState`, `LoadingState`, `Spinner`, `Skeleton`, `ErrorState`, `ListStatus` from `States.jsx` |
| Pending actions | `useAsyncAction`. There is no app-wide busy flag. |
| Toasts | `createNotifier(toast)` from `lib/notify.js`, the only module that imports `sonner`. Messages live in `lib/toastNotifications.js`, one per action. |
| Errors | `describeError` from `lib/describeError.js`. Never render `error.message`, response bodies, HTML or stack traces. |
| Copy to clipboard | `copyWithFeedback` from `lib/copyWithFeedback.js` |
| Unsaved edits | `useUnsavedGuard(isDirty, label)` from `lib/unsavedChanges.js` |
| Counts | `pluralize(count, singular, plural?)` from `lib/text.js` |

## CSS and tokens

- Global styles load before feature styles. Don't win specificity fights with doubled classes or `!important`.
- Colours, font sizes, z-indices, control heights and the focus ring come from tokens in `:root` (`frontend/src/styles.css`):
  - surfaces: `--pane-*`
  - rules: `--rule-*`
  - text: `--text-*`
  - tones: `--tone-{neutral|info|success|warning|danger}-{fg|text|bg|bg-subtle|border}`
  - type scale: `--font-size-1..7`
  - layers: `--z-*`
  - control heights: `--control-h-sm|md`
  - focus ring: `--focus-ring`
- `bun run lint` runs `scripts/checkCssTokens.ts`. It fails on hex, rgb, rgba or hsl colours and numeric z-index outside `:root`. A justified exception needs `/* token-exempt: reason */` on the same line.
- Breakpoints are 600, 900, 1120 and 1440 px.
- Utilities: `.sr-only` and `.scroll-thin`.

## Confirmations

- Refer to the item by name in quotes: `Delete "Invoice"?`.
- State the consequence in at most one sentence. The irreversibility phrase is always "This can't be undone."
- The confirm button is a verb plus a noun: "Delete template", "Remove Jane", "Ban user", "Clear gateway".
- Danger dialogs focus **Cancel**, and Enter never confirms them. Put the request in `action` so the dialog shows a pending label and keeps failures inline.
- Button order: Cancel first, the confirm action last. Destructive actions go last in every action group.

## Copy

- **Voice:** plain, direct and in the second person. Say what happened and what to do next. Don't use marketing chips, whimsy, "Successfully" or "Please".
- **Length:**
  - Headings: 2–5 words.
  - Subtitles: only when they add information the heading doesn't, and at most one sentence.
  - Hints: at most one sentence.
  - Empty states: one line plus an action.
  - Errors: at most two short sentences.
- **No implementation details:** no library names, storage, machine or installation, endpoints, attempts, revisions, batches, context, resolution, jobs or schema.
- **Casing:**
  - Sentence case for every button, heading, label, tab, menu item and `aria-label`.
  - Domain nouns (workspace, template, document, evaluation, expected answer) are lowercase in running text.
  - Capitalise proper nouns (Studio, PDF, Model gateway).
- **Punctuation:**
  - No full stop on headings, labels, buttons, chips or single-phrase toasts.
  - Use "…" only for in-progress states and for buttons that open a further step.
- **Spelling:** UK English ("cancelled", "colour").
- **Verbs:**
  - **Delete:** permanent, server-side.
  - **Remove:** take something out of a list or draft.
  - **Clear:** reset local state.
  - **Save:** persist.
  - **Apply:** change the in-memory draft.
  - **Try again:** retry.
  - **Cancel:** dismiss.
- **Placeholders** are examples only. Never use them as the only label, and never repeat the label.

## Terminology

| Concept | Use | Avoid |
| --- | --- | --- |
| Uploaded item | document; "file" only for bytes being picked; "original" for the retained file | job, source file, upload |
| Table-typed field | Table, columns, "Edit columns" | object schema, schema columns |
| Gateway secret | API key (in the Model gateway section) | credential |
| Template version | version, shown as "v3" | field version, Fields v3 |
| Expected answers | Expected answer; verbs Verify, Unverify, Delete answer | Remove verification |
| Held document | Needs template | Template needed |
| Processing done | Completed (processing), Queued (after upload) | Done, Success |
| Retry | Try again (failures), Reload (conflicts only) | Retry storage, Retry Workspace |
| File types | "PDF, PNG, JPG or WEBP", size in MB | MiB, other orderings |

## Accessibility baseline

- Modals use `ModalDialog`. Tabs and segmented controls use a roving tabindex with Arrow, Home and End.
- Every interactive element shows a 2px `:focus-visible` ring.
- Never convey status by colour alone.
- Icon buttons have a label, used for both `aria-label` and the tooltip. Labels name their target ("Remove invoice.pdf").
- Use `role="status"` only for content that changes. Static text never gets a live region.
- Respect `prefers-reduced-motion` for every animation.
