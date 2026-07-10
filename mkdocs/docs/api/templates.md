# Templates API

Use a Workspace API key with Template routes.

```http
GET /v1/templates
POST /v1/templates
GET /v1/templates/{template_id}
PATCH /v1/templates/{template_id}
DELETE /v1/templates/{template_id}
```

Create and update payloads use JSON with `name`, optional `description`, and `fields`. Every field needs a name, description, and supported `data_type`.
