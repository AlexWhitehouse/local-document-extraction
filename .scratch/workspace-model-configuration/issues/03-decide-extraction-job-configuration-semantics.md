# Decide how configuration changes affect Extraction jobs

Type: grilling
Status: resolved
Parent: ../map.md
Blocked by: 01, 02

## Question

Which **Workspace model configuration** should an **Extraction job** use when configuration is created, replaced, rotated, or cleared between Document admission, queueing, processing, and retry attempts?

Resolve the agreed pre-side-effect `409` for unconfigured submission; whether queued jobs bind to a version or resolve the latest configuration per attempt; what happens to queued, in-flight, recovered, and retrying jobs after configuration changes; how an unreadable encrypted credential affects admission and accepted jobs; which failures are deterministic versus retryable; and which non-secret model/route metadata remains on the job.

## Answer

Document admission checks **Workspace model configuration** immediately after Workspace authorisation and acquisition of the Workspace product-store lease. This check precedes multipart parsing, Template validation, temporary-file creation, Source-file persistence, and Extraction-job creation. An absent configuration therefore returns HTTP `409` with `workspace_model_not_configured` before submission side effects, even when the unparsed request body would also be invalid. A present configuration whose credential cannot be decrypted returns HTTP `503` with `workspace_model_configuration_unavailable` at the same boundary.

An **Extraction job** does not bind to or copy a configuration at submission. Each processing attempt resolves the latest complete configuration from the same leased Workspace product store immediately after claiming the job and before reading or transferring its Source file. That attempt keeps its captured configuration revision for its full duration. Later configuration replacement or credential rotation does not alter or cancel the attempt, and a successful response remains valid for completion even if configuration changed while the request was in flight.

Configuration changes do not wake, reschedule, or restart queued retry work. Existing durable `next_retry_at` timing remains authoritative. When the next normally scheduled attempt starts, it resolves the latest configuration and can therefore use a corrected gateway, model, credential, or capability declaration.

Explicitly clearing configuration is a stop for work that has not begun its next attempt. A queued, recovered, or retrying job that finds no configuration fails terminally with `workspace_model_not_configured`; it is not paused indefinitely and does not enter Model gateway retries. A job whose credential cannot be decrypted likewise fails terminally with `workspace_model_configuration_unavailable`. Configuration absence and local decryption failures do not consume the gateway retry budget or generate a gateway outcome.

Gateway HTTP `408`, `429`, `5xx` responses, network failures, and timeouts use the existing bounded durable retry policy. Authentication, permission, invalid-model, unsupported-request, and other deterministic gateway `4xx` responses fail terminally. A retry always gets the opportunity to use the latest Workspace configuration at its scheduled attempt boundary.

The Extraction-job record retains only the configuration revision, model name, and route label used by the latest or terminal attempt. It does not retain the credential, ciphertext, full gateway URL, a configuration snapshot, or permanent per-attempt history. Configuration-related terminal failures retain their Source file through the ordinary failed-job retention window and cleanup policy.
