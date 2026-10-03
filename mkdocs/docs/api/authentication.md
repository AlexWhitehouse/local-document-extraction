# API keys

Scripts and applications authenticate with a **Workspace API key**.

1. An owner or admin opens the Workspace page and generates (or rotates) the key.
2. Copy it straight away. It's only shown once.
3. Send it with every request:

```http
Authorization: Bearer <workspace_api_key>
```

The key belongs to one Workspace, so you don't need to say which Workspace a request is for. Treat it like a password. Rotating the key stops the old one working.

An API key can manage templates and tags, generate template drafts from samples, submit documents, read processing settings, read and delete jobs or packets, and export job results.

Manage [accounts, members, invitations, and model settings](../usage/accounts-and-workspaces.md) in the browser. Open **Templates → Assistant** for [help with a draft](../usage/templates.md#explain-problems-and-propose-focused-edits), or **Documents** to [review a held document](../usage/document-extraction.md#progress-and-review).

This key is separate from the model gateway credential, which the app uses to call your AI model.

See [Authentication and setup](overview.md#authentication-and-setup) in the full specification.
