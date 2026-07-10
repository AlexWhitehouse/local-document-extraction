# Templates

Templates describe the structured data returned from a Document. A Template has a name, optional description, and 1 to 50 fields.

Supported field data types are `string`, `number`, `boolean`, `date`, `object`, `array`, and `array<object>`. Field names become stable generated IDs. Duplicate names and IDs are rejected.

`object` and `array<object>` fields may define a table schema. A Template may have one table-shaped field, and that table can have at most 20 columns.
