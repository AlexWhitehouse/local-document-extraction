# Workspace costs page — throwaway prototype

This prototype shows the Workspace **Costs** page and how to reach it. It combines the earlier four-variant study (Ledger, Spend over time, Packet anatomy, Unit cost spread) into the direction that was selected.

Run from the repository root:

```sh
bun run prototype:costs
```

Open <http://127.0.0.1:5173/?prototype=costs>. Add `&page=costs&tab=overview` or `&tab=documents` to open a view directly.
Development-only query parameters gate the study. It reuses the production `MainLayout`, `ContextSidebar`, `WorkspaceContextList`, `WorkspaceToolbar` and `AcceptedWorkspacePage`, and the packet tab styles. It needs no session or backend. Production builds exclude the module.

## Flow

1. **Workspace page.** The real Workspace page has a **Costs** button in its header. Only owners and admins see it. Use the "View as" control at the bottom right to switch between Owner, Admin and Member. A member who opens a costs URL sees a restricted message.
2. **Costs page.** It uses the same Studio header ("Workspaces / Costs") and has a **← Workspace** button. Below the header is one tab row with **Overview** and **Documents** on the left and the date range on the right. The range applies to both tabs.
3. **Date range.** The presets are `1D` (the last 24 hours, by hour), `7D`, `14D` and `30D` (calendar days ending today), and `Custom`. Custom opens a From/To popover. A one-day custom range is shown by hour. Totals compare with the previous period of the same length when the sample covers that period.

## Overview tab

This tab shows only Workspace-level figures. It has no per-document ledger.

- Headline figures appear as one hairline strip in the Studio style, like the Workspace facts list and the Evaluation scores. They are total spend (with a trend sparkline and the change from the previous period), documents (with page count), per document, per page, and per day or per hour.
- Spend over time: columns stacked by stage (Smart split, Auto template, Extraction) with hover tooltips, a chart/table toggle, and a marker for the model change.
- Average cost per document: a separate line chart with its own scale, so there is no dual axis.
- Cost per document or per page: a strip plot grouped by template or model, with interquartile band, median, labelled outliers or reassessments, and a summary table.

## Documents tab

One list shows everything uploaded in the range, with or without a packet. It includes multi-document packets, single-document packets, plain documents and deleted items. You can search, filter (All, Multi, Single) and sort (Recent, Total, Per page). The selected item has a header (breadcrumb, title, time and model) and a compact version of the headline figure strip (Total, Per page, Smart split, Documents or Pages).

- **Multi-document:** a cost bar for each document plus excluded-page overhead, a page strip linked to the bar and table on hover, a reconciliation table, and a worked example of the split allocation.
- **Single document:** the cost by stage, and the page strip when there is more than one page. There is no table, because it would repeat the figures.

## Decisions from review

- Only Workspace owners and admins can open the Costs page or see its entry button.
- Deleting a document or packet does not remove its cost records, because the cost was incurred. Deleted items stay in totals and are tagged **Deleted** in the Documents tab. **This differs from ADR-0017**, which removes receipts when a packet or standalone Document is deleted. The real implementation needs an ADR amendment and a backend change. Workspace erasure still removes all accounting data.

## Fixtures

`sampleCosts.js` creates 60 days of deterministic history for each sample Workspace. It uses `shared/processingCosts.ts` (`costAmount`, `sumCosts`, `allocateCost`), so split allocation, excluded-page overhead, partial (`+`) totals and unavailable (pre-tracking) totals follow the real rules. Smart splitting is on in the sample, so PDFs become packets. Images never form a packet, so they become plain documents, as in the backend. The sample also includes a model change on 21 Sept, a few reassessment retries, and some deleted packets and documents. `NOW` is fixed at 2026-10-04 13:20 UTC, so `1D` always has data.

Stage colours are the first three dark categorical slots of the dataviz reference palette (blue, orange, aqua). They were validated all-pairs against the main pane surface: worst CVD ΔE 9.4, worst normal-vision ΔE 20.9, all ≥ 3:1 contrast. Every chart also has a legend, tooltips, or a table, so colour is never the only cue.

No tests were added for this throwaway study.
