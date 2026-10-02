# Templates

A template describes the data you want from a document: a name, an optional description, and between 1 and 50 fields. Each field has a name, a description telling the model what to look for, and a data type.

## Field types

| Type | Use for |
| --- | --- |
| `string` | Text |
| `number` | Amounts, quantities |
| `boolean` | Yes/no questions |
| `date` | Dates (returned as `DD/MM/YYYY`) |
| `object` | A group of related values |
| `array` | A list of values |
| `array<object>` | A table, such as invoice line items |

Each field gets an ID made from its name, so field names must be unique. `object` and `array<object>` fields can define table columns. A template can have only one of them, with at most 20 columns.

## Explain problems and propose focused edits

The editor explains validation problems beside the affected input and can focus each problem. These checks work without a model and are also available in Evaluation Template editing.

On **Templates**, select **Assistant**, then **Explain issues** or **Propose edits**. Describe your request, optionally attach a sample or a completed Extraction job, and submit it. While you compose a request, the panel suggests requests based on the open Template, using the Workspace model. Select a suggestion to fill in the request. Without a configured model, suggestions come from the app’s own checks. The Workspace needs a model configured for submitted assistance requests.

Review the rationale and every before/after value, including field IDs and column keys affected by renames. Select the change groups you want. Dependencies apply together and the full selected draft must be valid. **Apply** changes the current draft once; **Save** persists it separately. Editing or leaving the draft invalidates old proposals.

Selected jobs supply their historical Template version and results. Choose the retained original explicitly to send it, or upload a separate sample; only one binary source is allowed. Result-only requests are supported when an original is unavailable. A separate sample is not assumed to match the result. Results are model output, not verified answers, and suggestions do not establish improved accuracy.

Assistance does not run extraction, modify historical results, create Expected answers, or save a chat history. Closing the Assistant clears its temporary evidence and cancels pending work.

## Generate a template from a sample

Instead of writing fields by hand, you can let the model propose a template from an example document. The Workspace needs a model set up first.

1. On the **Create Template** button, click the magic icon. The rest of the button starts an empty template.
2. Upload one PDF, PNG, JPEG, or WebP sample, within the normal upload limit.
3. Optionally, describe what the template should capture.
4. If the editor has unsaved changes, confirm that you're happy for them to be replaced.

The result is an **unsaved draft**. Review it, make any changes, then click **Save new template** or **Save changes**.

Behind the scenes:

- If the model's proposal isn't a valid template, it's told what was wrong and gets up to three more tries.
- If the model can't be reached, generation stops straight away and you can try again.
- Cancelling, failing, leaving the template, or switching Workspace leaves your editor as it was.
- The sample is deleted when generation finishes. It doesn't appear in your documents or create a job.
