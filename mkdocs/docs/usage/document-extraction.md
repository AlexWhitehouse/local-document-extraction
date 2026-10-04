# Document extraction

## Upload and select a template

1. Open **Upload Document**.
2. Select a template.
3. Add one or more PDF, PNG, JPEG, or WebP files.

The app submits each file separately. The upload modal shows the current file-size limit.

For automatic selection, first add tags on Templates. In the upload modal, select **Automatic — select by tags**, then select one or more **Template tags**. The picker shows templates with any selected tag. The model uses candidate names and descriptions, without comparing their extraction fields. An explicit template takes priority and applies to all documents found in the file.

Uploads use Workspace processing settings. The browser submits all pages. API clients can specify PDF `pages`. Individual uploads cannot override splitting or blank-page settings.

## Smart splitting

An owner or admin can enable **Smart splitting** under **Workspaces → Document processing**, below Model gateway. Splitting identifies logical documents within a PDF and extracts each separately. One document can span multiple pages. Image uploads remain single documents.

Splitting and **Exclude blank pages** default to off. Blank exclusion requires splitting. Nonblank covers remain. Excluded pages retain their original page numbers and exclusion reasons.

A PDF uploaded with only one page skips splitting and blank-page checks, even when enabled. It proceeds to template selection or extraction as a single document. Multi-page uploads still follow Workspace settings, including when an API client selects only one page.

A one-page PDF or accepted one-document split appears as a normal document and opens directly in results. Exclusion reasons remain visible. Multiple documents appear in a packet overview with progress, original-page groups, and one tab per child document. Unresolved boundaries also require the packet overview. Deleting children does not convert a multi-document packet to a single-document view.

Splitting also runs with an explicit template. All resulting documents use its fixed version. With automatic selection, each document selects independently from templates that match the supplied tags.

## Progress and review

Extraction runs in the background. The browser updates progress automatically. Each logical document has an extraction job:

| State | Meaning |
| --- | --- |
| `queued` | Waiting for classification or extraction. A temporary failure can return the job here for a bounded retry. |
| `processing` | The extraction model is reading the document. |
| `awaiting_template` | Automatic selection needs assistance. Select a template to continue with the existing source. |
| `completed` | Processing finished. Results were saved before the state changed. |
| `failed` | Processing failed. The job shows an error code and message. |

Packets progress through split analysis, child-document creation, and extraction. Clear decisions continue automatically. Split analysis and each template selection permit one initial assessment and at most two targeted reassessments. Manual review follows only when these assessments cannot resolve the choice or another attempt cannot help.

Sign in to the Workspace and open the held item in **Documents**. Review uses the existing source. You do not need to upload it again.

### Choose a template

1. Select a usable Template under **Template for this document**.
2. Select **Use template and continue**.

You can select a Template outside the original tags. The app records its current version for the document and resumes extraction. Later Template edits do not change this accepted choice.

### Confirm document boundaries

For **Review needed**, use this procedure:

1. Inspect the original-page previews.
2. Assign each page to exactly one document group, or exclude it with a reason.
3. Select **Confirm plan and extract**.

A group can include nonadjacent pages. Pages retain their original order. You can explicitly exclude nonblank pages, such as covers, when necessary.

If another user changes the plan, reload before confirmation. Confirmed groups remain fixed. Repeated confirmation does not duplicate documents.

An all-blank PDF completes as **No documents to extract** only with blank exclusion enabled. Each selected page must be independently verified as blank.

## Results, originals, and deletion

Open a completed document to inspect extracted values, confidence, and evidence. If its original remains available, select **Side by side** to compare it with results. Select **Download** to save it.

The document header shows total model cost beside average confidence once the document is completed. The packet header shows total cost beside the excluded-page count once the packet is completed. Hover, focus, or tap the total to see **Smart split**, **Auto template**, and **Extraction** costs in USD. These are costs reported by your model endpoint, including reported retries and reassessments. A `+` marks a known subtotal with missing call costs; **Unavailable** means no usable total was reported or the work predates cost tracking.

Each document receives `packet split cost × document pages ÷ selected packet pages`. Excluded pages keep their share at packet level. Packet totals include the full split cost and all child selection/extraction costs once. Deleting a child does not remove its incurred cost from the packet total or change its siblings' allocations.

A child source contains only its assigned pages. The packet’s original download contains the full uploaded PDF, including excluded pages.

Select **Export** for completed documents, including packet children. A packet is a container and adds no result row.

Deleting a child from a multi-document packet keeps its siblings and packet original. Deleting the packet removes the group. Deleting an upload shown as one normal document also removes its hidden parent and original.

Installation and Workspace settings control original retention. Without retention, successful working files are removed. Failed files normally remain for seven days. Sources needed for split or template review remain until resolution. Results remain until deletion, even when their source is unavailable.

Integrations follow the submission’s `Location`, poll packets for children, and retrieve each child job’s results. A Workspace member resolves held choices in **Documents** before integration processing continues. See the [packet request-chain example](../api/overview.md#follow-the-packet-and-child-request-chain).
