# API keys

Scripts and applications authenticate with a **Workspace API key**.

1. As an owner or admin, open the Workspace page.
2. Generate or rotate the key.
3. Copy the key immediately. The app shows it once.
4. Send the key with each request:

```http
Authorization: Bearer <workspace_api_key>
```

The key identifies its Workspace. Requests do not need another Workspace identifier. Keep the key secret. Rotation invalidates the previous key.

An API key permits template and tag management, template generation, document submission, and processing-setting reads. It also permits job and packet reads, deletion, and result export.

Manage [accounts, members, invitations, and model settings](../usage/accounts-and-workspaces.md) in the browser. Open **Templates → Assistant** for [draft assistance](../usage/templates.md#explain-problems-and-propose-focused-edits). Open **Documents** to [review held work](../usage/document-extraction.md#progress-and-review).

The model gateway credential is separate. The app uses that credential to call your AI model.

See [Authentication and setup](overview.md#authentication-and-setup) in the full specification.
