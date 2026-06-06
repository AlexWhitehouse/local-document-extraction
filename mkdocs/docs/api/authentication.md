# API Keys

External systems use Workspace API keys to call the customer API.

## Generate An API Key

In the app:

1. Open the Workspace area.
2. Select the Workspace you want the external system to use.
3. Choose **Generate API Key** or **Rotate API Key**.
4. Copy the key immediately. It is shown only once.

Owners and admins can generate or rotate Workspace API keys. Rotating a key invalidates the previous key for external clients.

## Use The Key

Send the key in the `Authorization` header:

```http
Authorization: Bearer <workspace_api_key>
```

The `Authorization` header is required for all customer API routes except `GET /v1/health`.

Example:

```bash
curl https://extract.t3m.uk/v1/templates \
  -H "Authorization: Bearer wk_live_example"
```

## Scope And Access

Workspace API keys:

- Are scoped to one Workspace.
- Use that Workspace's Templates, Documents, jobs, limits, Credits, and billing state.
- Require the Workspace plan to include API access.
- Should be stored like a password or other private credential.

## Supported API Key Routes

Workspace API keys are intended for:

- Template API routes.
- Document submission.
- Extraction job listing, detail, and deletion.

Account settings, Workspace membership, invitations, and billing are managed in the app.
