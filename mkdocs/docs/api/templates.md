# Templates

Template routes use your Workspace API key. Templates created through the API appear in the same Workspace as Templates created in the app.

## List Templates

```http
GET /v1/templates
Authorization: Bearer <workspace_api_key>
```

Response:

```json
{
  "templates": [
    {
      "id": "tpl_123",
      "name": "Invoice Template",
      "description": "Extract invoice fields",
      "status": "active",
      "current_version": 1,
      "created_at": "2026-06-01T10:00:00.000Z",
      "updated_at": "2026-06-01T10:00:00.000Z"
    }
  ]
}
```

## Create Template

```http
POST /v1/templates
Authorization: Bearer <workspace_api_key>
Content-Type: application/json
```

Request:

```json
{
  "name": "Invoice Template",
  "description": "Extract invoice fields",
  "fields": [
    {
      "name": "Invoice Number",
      "description": "The invoice identifier",
      "data_type": "string"
    },
    {
      "name": "Invoice Total",
      "description": "The total amount due",
      "data_type": "number"
    }
  ]
}
```

Response status: `201 Created`.

Response:

```json
{
  "template_id": "tpl_123",
  "version": 1,
  "status": "active"
}
```

## Get Template

```http
GET /v1/templates/{template_id}
Authorization: Bearer <workspace_api_key>
```

Response:

```json
{
  "id": "tpl_123",
  "name": "Invoice Template",
  "description": "Extract invoice fields",
  "status": "active",
  "current_version": 1,
  "created_at": "2026-06-01T10:00:00.000Z",
  "updated_at": "2026-06-01T10:00:00.000Z",
  "fields": [
    {
      "id": "invoice_number",
      "name": "Invoice Number",
      "description": "The invoice identifier",
      "data_type": "string",
      "position": 0
    }
  ]
}
```

## Update Template

```http
PATCH /v1/templates/{template_id}
Authorization: Bearer <workspace_api_key>
Content-Type: application/json
```

PATCH accepts any of:

- `name`
- `description`
- `fields`

At least one field must be present.

Response:

```json
{
  "template_id": "tpl_123",
  "version": 2,
  "status": "active"
}
```

## Delete Template

```http
DELETE /v1/templates/{template_id}
Authorization: Bearer <workspace_api_key>
```

Response status: `204 No Content`.

## Validation Rules

- `name` must be a non-empty string.
- `description` may be a string or `null`.
- `fields` must contain 1 to 50 items.
- Field `name` and `description` are required.
- Field names are sanitized to letters, numbers, and spaces.
- Field IDs are generated from names.
- Duplicate field names or generated IDs are rejected.
- `data_type` must be one of `string`, `number`, `boolean`, `date`, `object`, `array`, or `array<object>`.
- Object and `array<object>` fields may include an `object_schema`.

## Object Schema

```json
{
  "name": "Line Items",
  "description": "Invoice lines in source order",
  "data_type": "array<object>",
  "object_schema": {
    "mode": "table",
    "columns": [
      {
        "heading": "Description",
        "data_type": "string",
        "description": "Line description"
      },
      {
        "heading": "Amount",
        "data_type": "number",
        "description": "Line amount"
      }
    ]
  }
}
```

Column `data_type` must be `string`, `number`, `boolean`, or `date`.
