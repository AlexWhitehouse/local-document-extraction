# Document extraction

## Upload and select a template

Open **Upload Document**, choose a template, and add one or more PDF, PNG, JPEG, or WebP files. Each file is submitted separately. The upload modal shows the current file-size limit.

To choose a template automatically, select **Automatic — select by tags**, then check one or more **Template tags**. The picker shows the templates carrying any selected tag. Add and manage tags on the Templates page first. The model uses each candidate's name and description to choose a suitable template; it does not compare every candidate's extraction fields. An explicit template choice always takes precedence and is used for every document found within that file.

Uploads use the Workspace's document-processing settings. The browser submits all pages; API clients can supply a PDF `pages` selection. There are no upload-specific splitting or blank-page overrides.

## Smart splitting

An owner or admin can enable **Smart splitting** under **Workspaces → Document processing**, below Model gateway. It finds logical documents within a PDF and extracts each separately. Multiple pages can belong to the same document. Image uploads remain single documents. Splitting and optional **Exclude blank pages** are both off by default; blank exclusion only applies while splitting is enabled. Nonblank covers are kept, and excluded pages retain their original page numbers and reasons.

A one-page PDF and a multi-page PDF resolved as one document appear as a normal document in the list and open directly into results. If pages were excluded, their reasons remain visible. Files containing multiple documents show a packet overview with progress, original-page groups, and a tab for each child document. A packet that still needs boundary review also keeps its overview. Deleting children from a multi-document packet does not turn it into a single-document view.

Smart splitting runs even when you choose a specific template. Every resulting document then uses that pinned template version. With Automatic selection, each resulting document chooses independently from templates matching the supplied tags.

## Progress and review

Extraction runs in the background. The browser updates progress automatically. Each logical document has an extraction job:

| State | Meaning |
| --- | --- |
| `queued` | Waiting for classification or extraction. A temporary processing failure may return a job here for a bounded retry. |
| `processing` | Being read by the extraction model. |
| `awaiting_template` | Automatic selection could not establish a suitable template. Choose one to continue using the existing source. |
| `completed` | Finished. Results are saved before the job is marked completed. |
| `failed` | Could not be completed. The job shows an error code and message. |

Packet progress moves through split analysis, creation of child documents, and extraction. Clear decisions proceed automatically. Split analysis and each template selection can make one initial assessment and up to two targeted reassessments. Manual review is the last resort when those assessments cannot resolve the choice or no further automatic attempt can help.

For **Review needed**, use original-page previews to assign every page to exactly one document group or exclude it with a reason, then choose **Confirm plan and extract**. Pages keep their original order. If another user changes the plan, reload it before confirming. An all-blank PDF completes as **No documents to extract** only when blank exclusion is enabled and every selected page is independently verified blank.

## Results, originals, and deletion

Open a completed document to see extracted values, confidence, and evidence. When an original was retained, choose **Side by side** to view it beside the results or **Download** to save it. A split child's source contains only its assigned pages. The packet overview's original download includes the whole uploaded PDF, including excluded pages.

Use **Export** for completed documents, including children of a packet. A packet is a container and contributes no extra result row. Deleting a child from a multi-document packet leaves its siblings and packet original intact. Deleting the packet removes the whole group. Deleting an upload presented as one normal document also removes its hidden parent and original.

Original retention depends on the installation and Workspace settings. Without retention, successful working files are cleaned up; failed files normally remain for seven days. Sources needed for split or template review stay available until resolution. Results remain until deleted, even if a source is unavailable.

Scripts follow the submission's `Location`, poll packets to discover children, and retrieve results from each child's job endpoint. API keys cannot confirm split plans or choose templates for held documents; a signed-in Workspace member performs those review actions in the frontend before the integration continues. See the [packet request-chain example](../api/overview.md#follow-the-packet-and-child-request-chain).
