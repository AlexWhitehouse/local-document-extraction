# Templates

A template defines the data to extract from a document. It has a name, optional description, optional tags, and 1 to 50 fields. Each field has a name, extraction instructions, and a data type.

## Organize templates with tags

1. Select **Tags** beside the Template description.
2. Search for an existing Workspace tag, or enter a name and select **Create**.
3. Select the required tags. To remove a tag from the draft, select it again.
4. Save the template to persist tags and associations.

Leaving an unsaved draft creates no tags. All users who can edit Workspace templates share its tags.

The app converts names to lowercase, removes surrounding whitespace, and collapses repeated spaces. Thus ` INVOICE ` becomes `invoice`. Case variants refer to the same tag. Names can include spaces and punctuation, but require a non-whitespace character. Control characters are prohibited. Limits are 64 characters per normalized name and 50 tags per template.

Open **Manage tags** to rename or delete shared tags. Renaming changes all uses of the tag. Another tag’s name cannot be reused. Deleting removes all associations. These actions save separately from the current Template draft.

Deselecting a tag removes only its template association, and only after you save. Unused tags remain until deletion, including after their last template is deleted. Tag changes do not create field versions or change historical extraction results.

For automatic selection, use **Automatic — select by tags** during upload. In the API, omit `template_id` and supply a nonempty `template_tags` array. The candidate pool contains all templates matching **any** supplied tag. The model selects from candidate names and descriptions. Write descriptions that distinguish similar templates.

An explicit Template ID takes priority. Unknown tags do not create tags or expand the candidate pool. Unresolved choices require manual selection. See [Document extraction](document-extraction.md).

## Field types

| Type | Use for |
| --- | --- |
| `string` | Text |
| `number` | Amounts and quantities |
| `boolean` | Yes/no questions |
| `date` | Dates, returned as `DD/MM/YYYY` |
| `object` | A group of related values |
| `array` | A list of values |
| `array<object>` | A table, such as invoice line items |

The app derives each field ID from its name. Field names must be unique. `object` and `array<object>` fields can define table columns. A template permits only one such field, with at most 20 columns.

## Explain problems and propose focused edits

The editor shows validation problems beside affected inputs. Select a problem to focus its input. Validation works without a model and also applies in the Evaluation Template editor.

On **Templates**, select **Assistant**, then **Explain issues** or **Propose edits**. Enter your request. Optionally attach a sample or select a completed Extraction job. Submit the request to the configured Workspace model.

The panel suggests requests from the open Template. Select a suggestion to fill the request. Without a model, suggestions use application validation. Submitted assistance requests require a configured model.

Review the reasons and before/after values for proposed changes. Include field IDs and column keys affected by renames. Select the required change groups. Dependent changes apply together, and the combined draft must be valid. Select **Apply** to update the draft once, then **Save** to persist it. Editing or leaving the draft invalidates old proposals.

Selected jobs supply historical Template versions and results. To include a retained original, select it explicitly. Alternatively, upload a separate sample. Each request permits one binary source. Result-only requests work without an original. A separate sample is not assumed to be the result’s source.

Results are model output, not verified answers. Suggestions do not establish improved accuracy. Assistance does not run extraction, change historical results, create Expected answers, or keep chat history. Closing the Assistant clears temporary evidence and cancels pending work. Sign in to use suggestions, evidence selection, and assistance in the frontend.

## Generate a template from a sample

With a Workspace model configured, use a sample to propose a template:

1. Select the magic icon on **Create Template**. The rest of the button starts an empty template.
2. Upload one PDF, PNG, JPEG, or WebP within the normal upload limit.
3. Optionally enter instructions for the proposed template.
4. If the editor has unsaved changes, confirm their replacement.
5. Review the **unsaved draft** and make necessary changes.
6. Select **Save new template** or **Save changes**.

Generation has these behaviors:

- An invalid proposal receives corrective feedback and at most three further attempts.
- An unreachable model stops generation immediately. You can try again.
- Cancellation, failure, navigation away, or a Workspace switch leaves the editor unchanged.
- The app deletes the sample after generation. It creates no Document or job.
