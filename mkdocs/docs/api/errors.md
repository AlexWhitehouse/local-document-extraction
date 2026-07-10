# Errors

Errors use a consistent envelope:

```json
{
  "error": {
    "code": "invalid_json",
    "message": "Request body must be valid JSON"
  }
}
```

Common statuses are `400` for invalid input, `401` for missing authentication, `403` for unauthorized Workspace access, `404` for missing routes or resources, `415` for unsupported content type, and `500` for unexpected local errors.

Client code should branch on both the HTTP status and `error.code`.
