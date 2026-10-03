# Evaluations

Evaluations help you choose the best setup for a kind of document. You run one or more documents through several **candidates** side by side and compare the results. Each candidate is a model plus a template. With more than one document, it's a **Batch Evaluation**: every document runs against the same candidates, and you review the results one document at a time.

There are two kinds of comparison:

- **Models:** one template, different models. Use this to find the most accurate or fastest model.
- **Template versions:** one model, different templates. Use this to check whether rewording your field instructions improves the results.

Evaluations are available in the browser to signed-in Workspace members. You can compare up to eight candidates, on as many documents as you like.

> **Runs and results are temporary.** Refreshing or closing the tab, clearing the Evaluation, or switching Workspace discards the candidates, results, and any unsaved documents and answers. Moving between pages in the same Workspace keeps them. Only documents you explicitly save to the [Evaluation library](#the-evaluation-library) are kept.

## Set up an Evaluation

Open **Evaluations**. The setup screen walks you through four steps:

1. **Documents:** choose saved documents with **Library**, upload new PDFs or images with **Upload new** (or drop them), or both. Each document shows whether it’s saved, and anything that needs attention, such as an unsaved upload or an unavailable original.
2. **What to compare:** models or template versions.
3. **Template:** pick a saved template, or an earlier version of one.
4. **Candidates:**
   - When comparing models, list the models to try. The Workspace's model comes first, and models already used in this Workspace are suggested.
   - When comparing templates, pick the versions to compare. They all use the Workspace's model. If you pick just one version, you get two copies so you can edit one.

Click **Start and run** to run every candidate on every document straight away.

## Read the results

Results appear in a table with one column per candidate, filled in as each candidate finishes. With several documents, use the centered **Previous** and **Next** controls to move between documents. **Document 1 of x** shows your position; field filters sit on the left of that same toolbar. The top of each column shows:

- **Accuracy:** how many of the fields you have checked it got right (see [Check accuracy](#check-accuracy)).
- **Table cells:** how many table cells matched.
- The candidate's status, and a button to run it again.

The best candidate is marked **Best**. Ties are broken by table-cell matches, then by speed.

Click any answer to open the inspector. It shows the full answer, how it was scored, how table columns were matched up, and what the other candidates answered.

Use the filters to show only the fields where candidates disagree, fields with a wrong answer, or fields you haven't checked yet.

## Change candidates

Each candidate's **⋯** menu lets you change its settings, see run details, edit its template, duplicate it, remove it, or **Save as new Template**.

- **Add candidate** copies the last candidate's settings, without its results.
- In a template comparison, you can swap a candidate's template for another template or version.
- Template editing uses the same editor as the Templates page.
- You can keep editing while candidates are running. Each run uses the settings it started with, and edited candidates are marked as needing another run.

**Save as new Template** opens the candidate's template in the editor. Nothing is saved until you click Save. It creates a new template and never changes the original. Your answers and results aren't included.

## Check accuracy

Candidates are only scored once you tell the Evaluation what the correct answers are. These are called **expected answers**, and they're optional.

- Type a correct answer into the **Expected** column, or pick a candidate's answer with **Use as expected answer**.
- **More options** and **Review as expected answer** open the full editor, where you can also turn on **Exact match**.

Answers are compared like this:

| Type | How answers are compared |
| --- | --- |
| Text | Ignores capitals, punctuation, and extra spaces, unless **Exact match** is on. |
| Number | Must be exactly equal; there is no rounding tolerance. |
| Yes/No | "yes"/"no" and "true"/"false" are treated the same. |
| Date | Must represent the same calendar day. |

Expected date entry defaults to **DD/MM/YYYY**. Use **Date format** to switch to **MM/DD/YYYY**; the editor shows the interpreted day before you verify. ISO dates (**YYYY-MM-DD**) and written month names also work. Verified dates are saved as ISO dates so their meaning stays the same when reused. Candidate dates use day/month/year when a numeric date could be read either way, so **08/09/1871** matches **1871-09-08**. Impossible calendar dates are rejected with an error beside the input.

Saying a value is *absent from the document* is different from leaving it unchecked. An "absent" answer never matches an error or an unreadable result.

Expected answers live in the browser tab, like the rest of the Evaluation, unless you save the document to the library.

### Tables

For a table field, the editor shows one row at a time, using the template's column names and types. A new table starts with one empty row. Reviewing a candidate's table copies in all of its rows.

Each cell can have an **Expected value**, be **Not present in document**, or use **Ignore for scoring**. Not present expects an empty cell in an extracted row and counts toward accuracy. Ignored cells are excluded from accuracy and difference highlighting. These choices apply only to the selected row's cell and are kept when you save its expected answers to the library. A row identifier must still have a value; otherwise choose a different identifier or match by position.

Before checking a table, choose how rows are matched: by a column that uniquely identifies each row (such as an invoice line number), or by position. If some rows are missing that column, or have the same value in it, the table isn't scored until you fix them. Missing and extra rows are reported separately.

**Compare all tables** shows the expected rows and every candidate's rows together, grouped by row, stacked, or side by side. Cells that differ from the expected answer are highlighted. Before you've entered expected rows, cells are compared with the most common answer across candidates. You can show only the rows that differ.

Free-form lists and nested objects are shown side by side for you to compare by eye, but aren't scored.

## The Evaluation library

The library keeps documents and their expected answers so anyone in the Workspace can reuse them. It never keeps candidates, results, scores, or run history.

- **Saving is always your choice.** A new upload stays in the tab until you choose **Save to library…** and give it a name. You can save with some or none of the answers checked and finish later; saving never marks an answer as checked. Saving needs the Workspace to keep original documents (see [Configuration](configuration.md)); without that, you can still evaluate uploads in the tab.
- **Saved documents bring a working copy.** Choosing a saved document copies its answers into this Evaluation. Editing them only affects this Evaluation, marked **answer changes not saved**, until you choose **Update saved answers…**. You always see the changes before they're saved. If someone else changed the saved answers since you loaded them, you see their version, yours, and the one you started from, and choose **Use saved version** or **Replace with mine**. Nothing is merged automatically.
- **Answers follow fields by name and type.** A saved answer is reused for a field with the same name and type. If a field's type changed, it shows **Needs review** until you check it again. Saved answers that the template doesn't ask for stay visible and count toward coverage.
- **Link renamed fields yourself.** If a field was renamed (say **Total** became **Invoice total**), use **Renamed? Link it to** beside the saved answer in the comparison table. Only fields of the same type that have no checked answer of their own are offered. A link applies to that document for this Evaluation only. It doesn't change the saved answers, and **Unlink** undoes it. Names are never matched up automatically.
- **Manage library** opens a centered modal where any Workspace member can rename or delete saved documents. Long names and details use ellipses with their full text available on hover; the document list scrolls when needed. Deleting removes the document and its answers for everyone. Evaluations that already show its results keep them, but it can't run again. A saved document's file can't be replaced; save a corrected file as a new document.
- If a saved original can't be read right now, that document is skipped when running and the others still run. **Clear Evaluation** lists any unsaved uploads or answer changes before it clears.

## How runs behave

- **Run all** runs every candidate on every document. Evaluations share processing capacity with normal extractions and do not appear in your Documents list.
- Each candidate's **▶** runs it on the document currently shown. A result that's already running can't be started again.
- If the app is busy, some candidates may not start. Run those candidates again when capacity is available.
- If a rerun fails, the previous successful result is kept and labelled **Previous result**.
- If you lose your connection, rerun the affected candidates yourself.
- A running candidate can't be cancelled. Running candidates uses your configured model provider and may incur charges.
- Result details are kept in encrypted browser storage while the Evaluation is open, so large batches don't fill memory. If the browser runs out of space, new documents pause and you can **Retry storage** or clear the Evaluation. Results whose details couldn't be kept are marked unavailable and cannot be scored until rerun.
