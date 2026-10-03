# Errors

All errors use this structure:

```json
{
  "error": {
    "code": "invalid_json",
    "message": "Request body must be valid JSON"
  }
}
```

Use the HTTP status and `error.code` in application logic. The `message` provides a human-readable explanation and can change.

| Status | Usual meaning |
| --- | --- |
| `400` | The request is invalid. |
| `401` | The request has no Workspace API key. |
| `403` | The key is invalid or does not permit access to the Workspace. |
| `404` | The route or resource does not exist. |
| `409` | The request conflicts with current state. For example, the Workspace has no configured model. |
| `413` | The request or export exceeds a size limit. |
| `415` | The content type is incorrect. File uploads require multipart form data. |
| `503` | The app is busy, starting, or stopping. Wait, then retry according to `Retry-After`. |

Reading a failed job still returns `200`. Inspect its `error_code` and `error_message` for the failure.

See [Errors and limits](overview.md#errors-and-limits) for all error codes.
