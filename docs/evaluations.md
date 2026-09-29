# Evaluations

Evaluations help you choose the best setup for a kind of document. You run the same document through several **candidates** side by side and compare the results. Each candidate is a model plus a template.

There are two kinds of comparison:

- **Models:** one template, different models. Use this to find the most accurate or fastest model.
- **Template versions:** one model, different templates. Use this to check whether rewording your field instructions improves the results.

You can compare up to eight candidates. Any member of a Workspace can use Evaluations.

> **Evaluations are temporary.** Nothing is saved. Refreshing or closing the tab, clearing the Evaluation, or switching Workspace discards the document, candidates, answers, and results. Moving between pages in the same Workspace keeps them.

## Set up an Evaluation

Open **Evaluations**. The setup screen walks you through four steps:

1. **Document:** upload the PDF or image to test with.
2. **What to compare:** models or template versions.
3. **Template:** pick a saved template, or an earlier version of one.
4. **Candidates:**
   - When comparing models, list the models to try. The Workspace's model comes first, and models already used in this Workspace are suggested.
   - When comparing templates, pick the versions to compare. They all use the Workspace's model. If you pick just one version, you get two copies so you can edit one.

Click **Start and run** to send every candidate for extraction straight away.

## Read the results

Results appear in a table with one column per candidate, filled in as each candidate finishes. The top of each column shows:

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
| Date | Must be the same calendar day, written unambiguously. |

Saying a value is *absent from the document* is different from leaving it unchecked. An "absent" answer never matches an error or an unreadable result.

Expected answers only live in the browser tab, like the rest of the Evaluation.

### Tables

For a table field, the editor shows one row at a time, using the template's column names and types. A new table starts with one empty row. Reviewing a candidate's table copies in all of its rows.

Before checking a table, choose how rows are matched: by a column that uniquely identifies each row (such as an invoice line number), or by position. If some rows are missing that column, or have the same value in it, the table isn't scored until you fix them. Missing and extra rows are reported separately.

**Compare all tables** shows the expected rows and every candidate's rows together, grouped by row, stacked, or side by side. Cells that differ from the expected answer are highlighted. Before you've entered expected rows, cells are compared with the most common answer across candidates. You can show only the rows that differ.

Free-form lists and nested objects are shown side by side for you to compare by eye, but aren't scored.

## How runs behave

- **Run all** uploads the document once and sends every candidate to the same extraction queue that normal documents use. Evaluations don't get a separate pool, and they don't appear in your Documents list.
- If the queue is full, only the affected candidates are rejected.
- If a rerun fails, the previous successful result is kept.
- If you lose your connection, rerun the affected candidates yourself.
- A submitted candidate can't be cancelled, and model requests may cost money with your provider.

## For developers

How Evaluations fit into the backend:

- **Access.** `localEvaluations.ts` only accepts browser sessions: API keys are rejected, even alongside a cookie. Model credentials and gateway addresses never leave the server. A submission made against an out-of-date revision of the Workspace's model settings is rejected, while work already running keeps the settings it started with.
- **Scheduling.** Candidates go through `localExtractionQueue.ts` as temporary tasks, sharing the same concurrency, Workspace fairness, sequential-call, and retry rules as documents (`extractionRetryPolicy.ts`). Instead of being deferred like documents, a temporary task is either accepted or rejected immediately.
- **Extraction.** Candidates reuse `runExtraction` and `normalizeModelResults`. Original field values are kept, within limits, so the browser can do strict matching. Token counts are shown only when the gateway reports them.
- **Delivery.** Each run streams progress and results back to the tab that started it as NDJSON. Nothing is broadcast to other tabs, stored, or replayed. If delivery fails, queued and retrying work stops; model requests already sent finish within their deadline and the results are discarded.
- **Limits.**
  - Upload metadata is capped at 1 MiB, on top of the usual file, PDF, and memory limits.
  - The upload itself must finish within 60 seconds or the gateway timeout, whichever is longer.
  - The whole submission must finish within four gateway timeouts plus two minutes, with a minimum of one minute. That covers queueing, preparation, three attempts, and retry delays. A model asking the app to retry too far in the future fails the candidate.
- **Cleanup.** Uploads live in the private `temporary/evaluations` folder and are deleted when the last candidate finishes. Leftover files are retried at startup and every 30 seconds. The browser shows cleanup as pending until deletion is confirmed.
- **Cancellation.** Clearing the Evaluation, switching Workspace, or losing the session stops queued work and ignores late results.

Backend integration tests cover eight candidates, queue and retry rejection, duplicate uploads, configuration snapshots, access isolation, revocation, historical template reads, cleanup, and disconnects. Frontend tests cover scoring and table-alignment edge cases, ranking, setup, expected answers, filters, the table comparison, editing, and saving. `e2e/evaluationJourney.spec.ts` sets up, runs, and scores a model comparison in a real browser using a fake model gateway.
