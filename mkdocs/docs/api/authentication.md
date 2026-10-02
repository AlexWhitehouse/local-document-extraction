# API keys

Scripts and applications authenticate with a **Workspace API key**.

1. An owner or admin opens the Workspace page and generates (or rotates) the key.
2. Copy it straight away. It's only shown once.
3. Send it with every request:

```http
Authorization: Bearer <workspace_api_key>
```

The key belongs to one Workspace, so you don't need to say which Workspace a request is for. Treat it like a password. Rotating the key stops the old one working.

An API key can manage templates and tags, generate template drafts from samples, submit documents, read and delete jobs or packets, and export job results. It can't manage accounts, members, invitations, or model settings, open live updates, use the Template assistant, or resolve held template/split decisions. A signed-in Workspace member handles those review decisions in the frontend.

This key is separate from the model gateway credential, which the app uses to call your AI model.

See [Authentication and setup](overview.md#authentication-and-setup) in the full specification.
