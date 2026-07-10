# API Keys

Owners and admins generate or rotate a Workspace API key in the app. Copy the key immediately; the raw value is shown only once.

```http
Authorization: Bearer <workspace_api_key>
```

The key is scoped to one Workspace and may access Template, document-submission, and extraction-job routes. Keep it like a password. It cannot access account, Workspace membership, invitation, admin, or live-update routes.
