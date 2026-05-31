# Prepaid Submission Enforcement

Category: enhancement
Type: AFK
Status: ready-for-agent

## Parent

.scratch/workspace-billing/PRD.md

## What to build

Enforce prepaid Credit and Plan page capacity on Document submission for non-enterprise Workspaces. The backend should generate the Extraction job ID, determine exact Billable Document page count, reserve Credits and page usage in the Billing ledger, then store the Source file and create/queue the Extraction job. If the Workspace lacks Credits or monthly page capacity, reject before Source file storage. If billing succeeds but later acceptance work fails, record a compensating refund.

This slice should be demoable by manually granting Credits, submitting images and PDFs successfully, exhausting Credits or Free monthly capacity, and seeing blocked submissions without orphaned Source files.

## Acceptance criteria

- [ ] Image Documents count as one Billable Document page.
- [ ] PDF Documents count by detected Source file page count.
- [ ] Billing validation happens after exact page count is known and before Source file storage.
- [ ] A successful prepaid submission records a Credit reservation before Source file storage and Extraction job creation.
- [ ] Credit reservation entries include Workspace ID, Extraction job ID, Template ID/version, Billable Document page count, submission time, actor or auth mode when available, and an internally generated idempotency key from the job ID.
- [ ] Credit reservations spend Included Credits before Purchased/Goodwill Credits when both are present.
- [ ] Submissions with insufficient Credits are rejected before Source file storage, job creation, queue send, or analytics emission.
- [ ] Submissions exceeding remaining Plan page capacity are rejected before Source file storage, job creation, queue send, or analytics emission.
- [ ] A Plan page limit is enforced as monthly capacity, not as a per-Document page cap.
- [ ] Duplicate user submissions with different generated job IDs are treated as separate billable submissions.
- [ ] If billing reservation succeeds but Source file storage, job creation, or queueing fails, a Credit refund restores Credits and page capacity.
- [ ] Deleting an Extraction job does not refund Credits or reduce historical page usage.
- [ ] Frontend upload controls use advisory entitlement summaries to disable upload when the Workspace is already blocked.
- [ ] Tests cover successful image and PDF prepaid submissions, insufficient Credit rejection, page-cap rejection, no R2 storage on billing rejection, compensation refunds, and upload advisory behavior.
- [ ] `npm run typecheck --prefix backend` and `npm run build --prefix frontend` pass.

## Blocked by

- .scratch/workspace-billing/issues/02-workspace-billing-ledger-with-manual-credit-grants.md

