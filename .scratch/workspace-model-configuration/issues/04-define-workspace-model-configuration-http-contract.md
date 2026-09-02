# Define the Workspace model configuration HTTP contract

Type: grilling
Status: resolved
Parent: ../map.md
Blocked by: 01, 02, 03

## Question

What Workspace-scoped HTTP contract should expose configuration readiness and let authorised Workspace owners/admins create, replace, rotate, or clear **Workspace model configuration**?

Resolve route shape, Workspace resolution and policy checks, member-visible readiness, owner/admin-visible non-secret fields, write-only credential semantics, atomic request/response shapes, revision-based conditional updates, validation and conflict errors, the exact pre-side-effect `409 workspace_model_not_configured` and `503 workspace_model_configuration_unavailable` responses, and whether configuration changes require **Workspace context invalidation** or another consistency signal.

## Answer

Expose one session-only Workspace product resource at:

`/v1/workspaces/:workspaceId/model-configuration`

The backend resolves `:workspaceId`, requires an authenticated user session and accepted **Workspace membership**, then opens the authoritative Workspace product-store lease. Presenting only a **Workspace API key** is not authentication for this resource and returns `401 unauthorized`. A signed-in non-member receives `403 forbidden`. Accepted members may read readiness; only Workspace owners/admins may create, replace, rotate, or clear configuration. A member mutation receives `403 insufficient_workspace_role`.

### Reads

`GET` always returns `200` for an authorised accepted member:

- An absent configuration returns `{ "configured": false }` to every role.
- A configured resource returns `{ "configured": true }` to an ordinary member, including when the stored credential is unreadable; members learn presence, not credential health or configuration details.
- A configured owner/admin response contains `configured`, `gateway_url`, `model_name`, `credential_status`, the native-PDF and structured-output capability declarations, the sequential-call behaviour setting, the numeric `revision`, `created_at`, and `updated_at`. `credential_status` is `configured` or `unavailable`; there is no redundant `has_credential` field and credential material is never returned.

Only the configured owner/admin representation includes an HTTP `ETag` derived from the configuration revision. Blank and member-redacted reads do not expose an ETag. Every response from this resource uses `Cache-Control: no-store`; the ETag is a mutation concurrency token, not a browser cache validator, and conditional `GET`/`304` behaviour is not part of this contract.

### Creates and replacements

`PUT` accepts the complete non-secret representation plus a write-only `credential` field:

```json
{
  "gateway_url": "https://gateway.example/v1",
  "model_name": "provider/model",
  "credential": "write-only; required on create, optional on replacement",
  "sequential_calls": false,
  "supports_pdf_input": false,
  "supports_structured_output": false
}
```

Creation requires `If-None-Match: *`, all fields, and a non-empty credential. It returns `201` with the configured owner/admin representation and its new ETag. Replacement and credential rotation require `If-Match` with the current ETag, require every non-secret field, and return `200` with the replacement representation and new ETag. Credential omission preserves the existing credential only while `credential_status` is `configured`; if it is `unavailable`, replacement must supply a new credential. Supplying a credential replaces it atomically with the non-secret fields. The API does not expose `PATCH`.

Malformed JSON, an invalid shape, or structural field validation failure returns the standard product error envelope with `400 invalid_workspace_model_configuration`. Error bodies, logs, analytics, and diagnostics never include the submitted credential.

### Clear

`DELETE` requires `If-Match` with the current configured resource ETag and returns `204` with no body after clearing the complete configuration. Missing configuration has no mutation ETag. If another actor changed or already cleared the resource, the delete returns `412 precondition_failed`; repeated clearing is deliberately not treated as idempotent success.

### Preconditions and admission failures

All errors use `{ "error": { "code": "...", "message": "..." } }`. Missing `If-Match` or `If-None-Match` on a mutation returns `428 precondition_required`. A stale ETag, creation when configuration already exists, replacement when it does not exist, or otherwise failed condition returns `412 precondition_failed`.

After Workspace authorisation and the product-store lease but before request-body parsing, Source-file persistence, or Extraction-job creation, Document admission returns:

- `409 workspace_model_not_configured` when configuration is absent.
- `503 workspace_model_configuration_unavailable` when configuration exists but its credential cannot be decrypted.

The `503` has no `Retry-After` because owner/admin repair is required. Both failures use the standard product error envelope and create no submission side effects.

### Consistency

After a successful `PUT` or `DELETE` commits, publish the existing **Workspace context invalidation** signal with reason `model_configuration_changed`. The event contains no configuration fields, credential data, or secret-derived data. The initiating SPA client uses the mutation response directly; other open clients refetch this resource. Do not denormalise configuration readiness into **Workspace control data** or `/v1/workspaces` responses.
