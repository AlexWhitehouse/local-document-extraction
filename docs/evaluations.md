# Evaluations

Use Evaluations in the browser to compare extraction settings for a document type. Each **candidate** combines a model and a template. A **Batch Evaluation** runs multiple documents against the same candidates. Review its results one document at a time.

Select one of these comparison types:

- **Models:** Use one template with different models to compare accuracy and speed.
- **Template versions:** Use one model with different templates to assess changes to field instructions.

Signed-in Workspace members can compare up to eight candidates. There is no limit on the number of documents.

> **Runs and results are temporary.** Refreshing or closing the tab, clearing the Evaluation, or switching Workspace discards candidates, results, and unsaved documents and answers. Navigation within the same Workspace keeps them. Only documents explicitly saved to the [Evaluation library](#the-evaluation-library) persist.

## Set up an Evaluation

Open **Evaluations** and complete the four setup steps:

1. **Documents:** Select saved documents with **Library**, add files with **Upload new**, or use both. You can also drop PDFs or images. Each document shows its saved status and problems, such as an unsaved upload or unavailable original.
2. **What to compare:** Select models or template versions.
3. **Template:** Select a saved template or an earlier version.
4. **Candidates:** Select the models or template versions to compare.

For model comparisons, the Workspace model appears first. The app also suggests models previously used in the Workspace.

For template comparisons, all candidates use the Workspace model. If you select one version, the app creates two copies so you can edit one.

Select **Start and run** to run all candidates on all documents.

## Read the results

The results table has one column per candidate. Each column fills when its candidate finishes. For multiple documents, use the centered **Previous** and **Next** controls. **Document 1 of x** shows your position. Field filters appear on the left of the same toolbar.

Each candidate column shows:

- **Accuracy:** The proportion of verified fields with correct answers. See [Check accuracy](#check-accuracy).
- **Table cells:** The number of matching table cells.
- The candidate status and a control to run it again.

The app marks the best candidate **Best**. It resolves ties by table-cell matches, then speed.

Select an answer to open the inspector. The inspector shows the full answer, scoring details, table-column alignment, and other candidates’ answers.

Use filters to show disagreements, incorrect answers, or fields that you have not verified.

## Change candidates

Open a candidate’s **⋯** menu to change settings, inspect run details, or edit its template. You can also duplicate or remove the candidate, or select **Save as new Template**.

- **Add candidate** copies the last candidate’s settings without results.
- In a template comparison, you can replace a candidate’s template with another template or version.
- Template editing uses the same editor as the Templates page.
- You can edit candidates during a run. Each run uses its initial settings. Edited candidates show that another run is necessary.

**Save as new Template** opens the candidate’s template in the editor. Select **Save** to create a new template. This action keeps the original template unchanged and excludes expected answers and results.

## Check accuracy

Scoring requires **expected answers** that you verify as correct. Expected answers are optional.

1. Enter an answer in the **Expected** column, or select **Use as expected answer** on a candidate’s answer.
2. For the full editor, select **More options** or **Review as expected answer**.
3. Enable **Exact match** in the editor when necessary.

The app compares answers with these rules:

| Type | Comparison rule |
| --- | --- |
| Text | Ignore case, punctuation, and extra spaces unless **Exact match** is enabled. |
| Number | Require exact equality. No rounding tolerance applies. |
| Yes/No | Treat "yes"/"no" and "true"/"false" as equivalent. |
| Date | Require the same calendar day. |

Expected dates default to **DD/MM/YYYY**. Use **Date format** to select **MM/DD/YYYY**. The editor shows the interpreted day before verification. It also accepts ISO dates (**YYYY-MM-DD**) and written month names. It stores verified dates as ISO dates to preserve their meaning during reuse.

Candidates use day/month/year for ambiguous numeric dates. Thus **08/09/1871** matches **1871-09-08**. Invalid calendar dates produce an error beside the input.

An answer marked *absent from the document* differs from an unchecked answer. Absence never matches an error or an unreadable result.

Expected answers remain in the browser tab unless you save the document to the library.

### Tables

The table editor shows one row at a time, with the template’s column names and types. A new table has one empty row. Reviewing a candidate table copies all its rows.

Each cell has one of three scoring states:

- **Expected value:** Compare the extracted cell with the verified value.
- **Not present in document:** Require an empty cell in an extracted row. This state counts toward accuracy.
- **Ignore for scoring:** Exclude the cell from accuracy and difference highlighting.

The state applies only to the selected cell in the selected row. Saving expected answers to the library preserves these states. A row identifier must still have a value. Otherwise, select another identifier or match rows by position.

Before you verify a table, select how to match rows. Use a column with a unique value for each row, such as an invoice line number, or match by position. Missing or duplicate identifiers prevent scoring until you correct them. The app reports missing and extra rows separately.

**Compare all tables** shows expected rows and all candidate rows together. Select grouped, stacked, or side-by-side views. Highlighted cells differ from expected answers. Without expected rows, the app compares cells with the most common candidate answer. You can filter the view to rows with differences.

Free-form lists and nested objects appear side by side for visual comparison. The app does not score them.

## The Evaluation library

The library stores documents and expected answers for all Workspace members. It does not store candidates, results, scores, or run history.

To save an upload, select **Save to library…** and enter a name. You can save with some or no verified answers and continue later. Saving does not verify answers automatically. Library saving requires original-document retention for the Workspace; see [Configuration](configuration.md). Without retention, you can still evaluate uploads in the tab.

A saved document supplies a working copy of its answers. Edits affect the current Evaluation and show **answer changes not saved**. Select **Update saved answers…** to preview and save changes. If another user changed the saved answers, the app shows the saved version, your version, and the original version. Select **Use saved version** or **Replace with mine**. The app does not merge answers automatically.

Saved answers match fields by name and type. A changed field type shows **Needs review** until you verify the answer again. Answers for fields absent from the template remain visible and count toward coverage.

Select **Review template changes** or the **Template changes** filter to find changed fields, fields without saved answers, and saved fields no longer requested. Field type changes show the old and new types. Name and instruction changes are also identified.

Changed table columns also show **Needs review**, with **Review updated table** opening the candidate’s column names and types. The editor carries forward existing rows, compatible values, cell states, and row matching. Clear conversions between text, numbers, and Yes/No are filled in for review; dates retain their date-format controls. Values that cannot be converted still need correction.

The editor lists added, removed, renamed, reordered, and retyped columns, plus changes to column instructions. Added columns need values, explicit absence, or **Ignore for scoring**. If a renamed column no longer matches automatically, use **Renamed column? Reuse previous answers** to copy its previous values and cell states across all rows. Removed columns leave the expected table only when you verify it. If the row identifier was removed, link its renamed replacement, choose another column, or match by row position. When candidates use different schemas, **Expected answer Template** selects which one to verify; each choice keeps its own draft while the editor is open. Reviewing a candidate’s answer starts with that candidate’s schema and values.

Cancel leaves the existing answers unchanged. Verification updates the working copy; **Update saved answers…** is still required to update the shared library. New top-level fields start unverified, and removed fields keep their saved answers for reuse with other templates. Use **Remove expected answer** on an unrequested field to remove it from the working copy; saving that removal to the library remains explicit.

Link renamed fields manually. For example, if **Total** becomes **Invoice total**, select **Renamed? Link it to** beside the saved answer. Eligible fields have the same type and no verified answer of their own. The link applies only to this document in this Evaluation. It does not change saved answers. Select **Unlink** to remove it; the app never infers renamed-field links.

Select **Manage library** to open the centered management modal. Any Workspace member can edit, rename, or delete saved documents. **Edit** opens the matrix with the document’s saved fields and Expected answers, with no models selected or running. No model configuration is required. Use **Edit Template** to revise its field draft, verify answers in the matrix, and **Update saved answers…** to review and save changes to the shared library. **Back to Evaluation** keeps the working copy and field draft in this tab. Long names and details use ellipses; hover to read the full text. The document list scrolls when necessary.

Deletion removes the document and its answers for everyone. Evaluations that already show its results keep them, but cannot run that document again. You cannot replace a saved file. Save a corrected file as a new document.

If a saved original is temporarily unreadable, runs skip that document and continue with the others. **Clear Evaluation** lists unsaved uploads and answer changes before clearing them.

## How runs behave

- **Run all** runs all candidates on all documents. Evaluations share capacity with normal extractions and do not appear in Documents.
- A candidate’s **▶** control runs it on the current document. You cannot start a second run for a result that is already running.
- If the app is busy, some candidates cannot start. Run them again when capacity is available.
- If a rerun fails, the last successful result remains as **Previous result**.
- After a connection failure, rerun the affected candidates manually.
- You cannot cancel a running candidate. Runs use the configured model provider and can incur charges.

The Evaluation keeps result details in encrypted browser storage to limit memory use for large batches. If storage is full, new documents pause. Select **Retry storage** or clear the Evaluation. Results with unsaved details show as unavailable. Rerun them before scoring.
