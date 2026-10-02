# Templates

A template describes the data you want from a document: a name, an optional description, optional tags, and between 1 and 50 fields. Each field has a name, a description telling the model what to look for, and a data type.

## Organize templates with tags

Use **Tags** beside the description in the Template header to select one or more tags. Search the dropdown to find an existing Workspace tag, or type a new name and choose **Create**. Select a checked tag again to remove it from the draft. Save the template to persist new tags and changes to its associations; leaving an unsaved draft creates no tags.

Tags are shared by everyone who can edit templates in the Workspace. Names are displayed in lowercase, with surrounding whitespace removed and repeated spaces collapsed: ` INVOICE ` becomes `invoice`. Case variations refer to the same tag. A name can contain spaces and punctuation, must contain at least one non-whitespace character, and is limited to 64 characters after normalization. Control characters are not allowed. A template can have up to 50 tags.

Open **Manage tags** to rename or delete shared tags. Renaming changes the name everywhere the tag is used; a name already used by another tag cannot be reused. Deleting removes the tag from every template. These management actions save separately from the current Template draft. Deselecting a tag only removes its association when you save the template. Unused tags stay in the dropdown until deleted, including after deleting their last template.

Tag changes do not create a new field version or change existing extraction results. For automatic selection, choose **Automatic — select by tags** when uploading, or omit `template_id` and supply a nonempty `template_tags` array in the API. Templates matching **any** supplied tag form the complete candidate pool. The model uses the document and candidate names and descriptions to select a suitable template, so write descriptions that distinguish similar templates. An explicit Template ID takes precedence. Unknown tags do not create new tags or widen the candidate pool; unresolved choices require manual selection. See [Document extraction](document-extraction.md).

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

Assistance does not run extraction, modify historical results, create Expected answers, or save a chat history. Closing the Assistant clears its temporary evidence and cancels pending work. The Assistant, including suggestions and evidence selection, is available to signed-in Workspace members in the frontend; Workspace API keys cannot use it.

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
