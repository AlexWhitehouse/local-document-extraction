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

The app marks the best candidate **Best**. It resolves accuracy ties by table-cell matches, then cost when both runs report their full cost, then speed. Candidates that remain tied are not marked.

Select an answer to open the inspector. The inspector shows the full answer, scoring details, table-column alignment, and other candidates’ answers.

Use filters to show disagreements, incorrect answers, or fields that you have not verified.

## Change candidates

Open a candidate’s **⋯** menu to change settings, inspect run details, or edit its template. You can also duplicate or remove the candidate, or select **Save as new Template**.

- **Add candidate** copies the last candidate’s settings without results.
- In a template comparison, you can replace a candidate’s template with another template or version.
- Template editing uses the same editor as the Templates page.
- You can edit candidates during a run. Each run uses its initial settings. Edited candidates show that another run is necessary.

In a model comparison, Workspace owners and admins can select **Use for extraction…** on the **Best** candidate or in any model candidate’s menu. See [Use a model for extraction](#use-a-model-for-extraction).

**Save as new Template** opens the candidate’s template in the editor. Select **Save** to create a new template. This action keeps the original template unchanged and excludes expected answers and results.

Select **Ask assistant** in a candidate’s **⋯** menu to open the [Template assistant](template-assistant.md) beside the evaluation. It works on that candidate’s template, never on the saved template. After you apply proposed changes, choose what to do with them:

- **Test changes** runs them on a copy of the candidate. See [Improve failing fields](#improve-failing-fields).
- **Apply to candidate** changes the candidate’s template. Run the candidate again to test it.
- In a model comparison every candidate shares one template, so **Apply to template** changes it for all of them.

## Improve failing fields

When a candidate gets verified fields wrong on the open document, its **⋯** menu offers **Improve failing fields**. It opens the Assistant beside the evaluation, on the candidate’s template. The request names the failing fields, and the candidate’s results on every document are attached as evidence. Only fields with verified expected answers are included. See [Evaluation results](template-assistant.md#evaluation-results) for what is sent.

After you apply proposed changes in the Assistant, select **Test changes**:

1. The app adds a copy of the candidate with the edited template, right after the original. The original candidate and its results don’t change.
2. The copy runs on the documents the original has results for, the same way **Run** does.
3. **Test changes** above the matrix compares the original with the copy. It shows overall and per-field accuracy before and after, and marks each as **Improved**, **Regressed** or **Unchanged**. Only documents where both have results are compared. Runs that didn’t finish are listed.
4. Select **Keep copy** to keep both candidates, or **Remove copy** to remove the copy and its results. You can undo the removal from its toast.

**Test changes** is available when comparing template versions. In a model comparison all candidates share one template, so apply the changes and run again instead. A copy needs a free candidate slot. With eight candidates, the Assistant explains that you need to remove one first.

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

### Accept all answers from a candidate

To verify a document quickly, open a candidate’s **⋯** menu and select **Accept all answers…**. In a Batch Evaluation, **Accept answers for every document…** applies the same step to each document that has a result from that candidate. The confirmation shows how many answers it sets, how many verified answers already match, and how many it skips.

- Accepted answers become verified expected answers, because you accept them explicitly.
- A **Not found** answer becomes **Not in document**.
- Verified answers that differ from the candidate’s answer are kept and listed. To replace them, select the **Overwrite** checkbox.
- Errors, unreadable values, and tables with rows are skipped and listed for review. Tables need a row-matching choice, so review them in the table editor. A table that is **Not found** is accepted as **Not in document**.
- Ambiguous numeric dates are read day first, as candidates are scored, and stored as ISO dates.
- Fields that are not automatically scored are not affected.

The action changes the working copy only, and **Undo** in the notification restores the previous answers. Answers you edited since then are kept. For library documents, select **Update saved answers…** to save the changes.

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

Select **Review template changes** or the **Template changes** filter to find changed fields, fields without saved answers, and saved fields no longer requested. Field type changes show the old and new types. Name changes are also identified. Changes to field or column instructions keep saved answers verified and scored without confirmation and do not appear in this review.

Changed table columns also show **Needs review**, with **Review updated table** opening the candidate’s column names and types. The editor carries forward existing rows, compatible values, cell states, and row matching. Clear conversions between text, numbers, and Yes/No are filled in for review; dates retain their date-format controls. Values that cannot be converted still need correction.

The editor lists added, removed, renamed, reordered, and retyped columns. Added columns need values, explicit absence, or **Ignore for scoring**. If a renamed column no longer matches automatically, use **Renamed column? Reuse previous answers** to copy its previous values and cell states across all rows. Removed columns leave the expected table only when you verify it. If the row identifier was removed, link its renamed replacement, choose another column, or match by row position. When candidates use different schemas, **Expected answer Template** selects which one to verify; each choice keeps its own draft while the editor is open. Candidates differing only in instructions share one choice. Reviewing a candidate’s answer starts with that candidate’s schema and values.

Cancel leaves the existing answers unchanged. Verification updates the working copy; **Update saved answers…** is still required to update the shared library. New top-level fields start unverified, and removed fields keep their saved answers for reuse with other templates. Use **Remove expected answer** on an unrequested field to remove it from the working copy; saving that removal to the library remains explicit.

Link renamed fields manually. For example, if **Total** becomes **Invoice total**, select **Renamed? Link it to** beside the saved answer. Eligible fields have the same type and no verified answer of their own. The link applies only to this document in this Evaluation. It does not change saved answers. Select **Unlink** to remove it; the app never infers renamed-field links.

Select **Manage library** to open the centered management modal. Any Workspace member can edit, rename, or delete saved documents. **Edit** opens the matrix with the document’s saved fields and Expected answers, with no models selected or running. No model configuration is required. Long names and details use ellipses; hover to read the full text. The document list scrolls when necessary.

To use an updated Template, select **Choose Template/version**, choose the Template, and leave **Field version** at **Current** or choose an older version. **Use Template version** loads those fields into the document’s draft and shows the selected version above the matrix. Existing answers remain available, with differences highlighted for review. **Edit Template → Save Template** updates the selected Workspace Template and immediately uses its new field version here. The editable name excludes the displayed version label. Without a selected Template, **Apply changes** edits only this document’s field draft. Verify affected answers in the matrix, then use **Update saved answers…** to review and save changes to the shared library. Choosing or saving a Template does not run a model or update saved answers by itself. **Back to Evaluation** keeps the working copy and field draft in this tab.

Deletion removes the document and its answers for everyone. Evaluations that already show its results keep them, but cannot run that document again. You cannot replace a saved file. Save a corrected file as a new document.

If a saved original is temporarily unreadable, runs skip that document and continue with the others. **Clear Evaluation** lists unsaved uploads and answer changes before clearing them.

## Use a model for extraction

In a model comparison, Workspace owners and admins can make a candidate’s model the Workspace extraction model. Select **Use for extraction…** on the **Best** candidate, or in any model candidate’s **⋯** menu. Members don’t see this action.

The confirmation shows the current extraction model and the new one. The new model keeps the candidate’s **Direct PDF input** and **Structured output** settings. The gateway URL, API key, call setting, and any separate Template assistant or classification models stay unchanged. Roles without their own model follow the new extraction model. After the change, a notification links to the model settings.

The action is unavailable, with the reason shown in the menu, when:

- the Model gateway isn’t set up, or its saved API key can’t be read
- the candidate hasn’t run with its current model and input settings
- the model is already the extraction model with the same settings

Changing Workspace model settings ends runs in open evaluations. To run candidates again, start a new evaluation.

## How runs behave

- **Run all** runs all candidates on all documents. Evaluations share capacity with normal extractions and do not appear in Documents.
- A candidate’s **▶** control runs it on the current document. You cannot start a second run for a result that is already running.
- If the app is busy, some candidates cannot start. Run them again when capacity is available.
- If a rerun fails, the last successful result remains as **Previous result**.
- After a connection failure, rerun the affected candidates manually.
- You cannot cancel a running candidate. Runs use the configured model provider and can incur charges.

The Evaluation keeps result details in encrypted browser storage to limit memory use for large batches. If storage is full, new documents pause. Select **Retry storage** or clear the Evaluation. Results with unsaved details show as unavailable. Rerun them before scoring.
