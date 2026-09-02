# Define the Workspace model configuration and credential lifecycle

Type: grilling
Status: resolved
Parent: ../map.md
Blocked by: 01

## Question

What lifecycle and invariants should govern complete, blank, updated, and cleared **Workspace model configuration**?

Resolve atomic replacement of gateway URL, model name, credential, and capability options; write-only credential handling; clearing and rotation; concurrent edits; safe persistence at rest; redaction; secret-bearing backup/export handling; validation boundaries; explicit capability defaults; and what configuration details ordinary members versus owners/admins may read.

## Answer

**Workspace model configuration** is complete or absent. Creating it requires an absolute HTTP(S) gateway URL, a non-empty model name, a non-empty **Model gateway credential**, and explicit boolean capability/behaviour settings. The gateway URL may include a base path such as `/v1` but not embedded credentials, a query, or a fragment. Values are trimmed and bounded before persistence. Structural validation does not contact the gateway; connectivity and compatibility validation are resolved separately by **Decide how Model gateway compatibility is validated**.

The credential is write-only and recoverable only inside the backend for outbound Model gateway processing. An owner/admin update may omit it to preserve the current encrypted value. Supplying a new non-empty value replaces it atomically with the other submitted configuration changes. Clearing is a separate explicit whole-configuration action; the system never persists a partial URL/model/credential state or interprets a nullable credential field as an accidental partial clear.

Every configuration has a non-secret revision. Replacement and clearing target the revision last read and reject stale mutations rather than silently overwriting another owner/admin's changes. Successful mutations advance the revision and update non-secret timestamps.

Credentials are encrypted at rest using versioned authenticated encryption, a dedicated random machine-local secret, and a fresh nonce for every credential write. The encryption context binds the ciphertext to its Workspace and envelope version so ciphertext cannot be transplanted silently. The machine secret is not reused from Better Auth or another application purpose, is created idempotently with owner-only permissions, and is never logged or returned. Product-database files and sidecars retain owner-only permissions as an additional control.

A full local-state backup intended to be restorable preserves both encrypted credentials and the machine secret and is classified as secret-bearing. Workspace exports, job exports, support bundles, diagnostics, logs, analytics, live updates, API responses, and fixtures omit credential plaintext and ciphertext entirely.

Workspace owners/admins may read the gateway URL, model name, capability/behaviour flags, revision, timestamps, and a boolean credential-presence indicator. Ordinary members may read only whether the Workspace is configured. No caller can retrieve saved credential material; replacement requires supplying a new value.

New configuration defaults native PDF input and structured output to unsupported/off until deliberately declared. Sequential Model gateway calls are opt-in and therefore default off. Managed-file upload is not part of Workspace configuration and is not exposed by this product contract.

If a stored credential cannot be decrypted because the machine secret is missing, changed, or invalid, the record is preserved and is not treated as absent configuration. Document submission and other operations that require the credential return HTTP `503` with `workspace_model_configuration_unavailable`. Authorised non-secret reads, full replacement with a new credential, and clearing remain available so the Workspace can be repaired.
