# Errors

Every error has the same shape:

```json
{
  "error": {
    "code": "invalid_json",
    "message": "Request body must be valid JSON"
  }
}
```

Check both the HTTP status and `error.code` in your code. The `message` is for people to read, and may change.

| Status | Usually means |
| --- | --- |
| `400` | Something in the request is invalid. |
| `401` | No Workspace API key was sent. |
| `403` | The API key is wrong, or you don't have access to that Workspace. |
| `404` | The route or resource doesn't exist. |
| `409` | The request conflicts with the current state, for example the Workspace has no model set up yet. |
| `413` | The request or export is too large. |
| `415` | Wrong content type; file uploads must be multipart form data. |
| `503` | The app is temporarily busy, starting, or stopping. Wait and retry, honouring `Retry-After`. |

A job that fails still returns `200` when you read it. Its failure is reported in the job's own `error_code` and `error_message`.

Every error code is listed in [Errors and limits](overview.md#errors-and-limits).
