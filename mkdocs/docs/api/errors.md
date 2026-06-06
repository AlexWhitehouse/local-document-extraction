# Errors

API errors use a consistent JSON envelope:

```json
{
  "error": {
    "code": "invalid_json",
    "message": "Request body must be valid JSON"
  }
}
```

## Common Status Codes

| Status | Meaning |
| --- | --- |
| `400` | Invalid request body, query parameter, cursor, or missing required input. |
| `401` | Authentication required, missing API key, or invalid API key. |
| `402` | Plan, billing, Credit, page, API access, or product limit prevents the action. |
| `403` | The API key is not allowed to perform this action. |
| `404` | Route or resource not found. |
| `405` | Method not allowed for the route. |
| `409` | Conflict with current Workspace, billing, invitation, or ownership state. |
| `410` | Expired invitation. |
| `415` | Unsupported request content type. |
| `500` | Unexpected service error. |
| `502` | A required external service did not complete successfully. |

## Common Error Codes

| Code | Typical Cause |
| --- | --- |
| `unauthorized` | Missing or invalid API key. |
| `forbidden` | The API key is valid, but the Workspace or plan does not allow the action. |
| `invalid_json` | JSON body could not be parsed. |
| `invalid_fields` | Template fields failed validation. |
| `invalid_document` | Missing or unsupported Document upload. |
| `source_file_too_large` | Uploaded Document exceeds the configured byte limit. |
| `invalid_cursor` | Pagination cursor could not be decoded. |
| `api_access_entitlement_inactive` | Workspace plan does not include API access. |
| `template_limit_exceeded` | Workspace has reached the active plan Template limit. |
| `template_field_limit_exceeded` | Template has too many top-level fields for the active plan. |
| `member_limit_exceeded` | Workspace has reached or exceeded the active plan member limit. |
| `workspace_billing_unpaid` | Unpaid billing blocks the requested action. |

## Client Handling

Clients should branch on both HTTP status and `error.code`. Status indicates the broad failure class; `error.code` is stable enough to choose user-facing copy or retry behavior.
