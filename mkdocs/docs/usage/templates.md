# Templates

Templates describe the structured data returned from a Document. A Template has a name, optional description, and 1 to 50 fields.

Supported field data types are `string`, `number`, `boolean`, `date`, `object`, `array`, and `array<object>`. Field names become stable generated IDs. Duplicate names and IDs are rejected.

`object` and `array<object>` fields may define a table schema. A Template may have one table-shaped field, and that table can have at most 20 columns.

## Generate from a sample

The **Create Template** button has two areas: select the text to start a manual Template, or its magic icon to generate a new Template. The **Auto generate** action in the editor replaces the current draft instead.

Upload one PDF, PNG, JPEG, or WebP sample. The existing upload size limit applies. Optionally describe what the template should capture. Cancelling the magic action leaves the current editor untouched.

Generation uses the current Workspace's configured model. Configure the model on the Workspace page first. If the editor contains unsaved changes, confirm that successful generation will replace them.

The model receives the supported template rules. Invalid proposals receive validation feedback, with up to three corrective retries after the first attempt. Connection failures stop immediately and allow a manual retry.

A successful proposal replaces the name, description, and fields in the editor as an **unsaved draft**. Review it, make any changes, then select **Save new template** or **Save changes**. Failure or cancellation preserves the previous editor content. Leaving the template or changing Workspaces cancels generation.

The app deletes its temporary sample copy when generation succeeds, fails, or is cancelled. Samples do not appear in Document history or create Extraction jobs.
