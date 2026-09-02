# Decide how Model gateway compatibility is validated

Type: grilling
Status: resolved
Parent: ../map.md
Blocked by: 02, 04

## Question

Should **Workspace model configuration** be accepted after structural validation alone, or should setup include an explicit Model gateway connectivity and compatibility check?

Resolve whether testing is automatic or user-triggered; which endpoint and minimal request may be called; how credentials are protected; how model availability and PDF/structured-output/managed-file capabilities are represented; whether an unreachable gateway blocks saving; and how validation failures are presented without turning transient gateway availability into configuration loss.

## Answer

Saving **Workspace model configuration** remains a structural persistence operation. `PUT` never contacts the **Model gateway**, and gateway reachability is not an invariant of saved configuration. An unreachable or rejected gateway therefore never blocks saving, erases configuration, changes capability declarations, or marks the configuration invalid.

### Explicit connection test

Offer an optional, user-triggered **Model gateway connection test** from the Workspace frontend. The session-only owner/admin endpoint is:

`POST /v1/workspaces/:workspaceId/model-configuration/test`

It evaluates the complete current form draft without persisting it. Use the same structural validation and role boundary as configuration writes. The draft contains `gateway_url`, `model_name`, `sequential_calls`, `supports_pdf_input`, `supports_structured_output`, and the write-only `credential` when supplied. There is no managed-file field.

For a blank configuration or one whose credential is unavailable, the draft must supply a non-empty credential. When editing a configuration whose stored credential is usable, the draft may omit `credential`; doing so requires `If-Match` with the current configured resource ETag before the backend decrypts and reuses that credential. Missing or stale conditions use the existing `428 precondition_required` and `412 precondition_failed` errors. When the draft supplies its own credential, no configuration precondition is required because the test reads no stored secret and mutates no state.

Draft credential material remains only in request memory for the outbound call. It is never persisted, echoed, added to test results, returned in errors, or written to logs, analytics, diagnostics, or live updates. The test response uses `Cache-Control: no-store`.

### One minimal gateway request

The backend derives the same `chat/completions` URL that extraction uses and makes exactly one request with `Content-Type: application/json` and the credential as its bearer token:

```json
{
  "model": "<draft model_name>",
  "messages": [
    { "role": "user", "content": "Reply with OK." }
  ]
}
```

Do not add a model-list request, PDF or image fixture, `response_format`, file upload, temperature, streaming, or another provider-specific option. Do not retry. Use a fixed 30-second timeout. The probe passes only when the gateway returns HTTP 2xx, valid JSON, and non-empty assistant content readable through the same supported response-content shapes as extraction; it does not require an exact `OK` response.

Authenticated Model gateway requests do not follow redirects. A `3xx` fails both the connection test and normal extraction rather than risking credential forwarding or allowing the tested and processing paths to diverge. HTTP and private/loopback gateway URLs remain supported for local gateways.

### Meaning and presentation

The result is a **connection test**, not compatibility certification, health monitoring, or capability discovery. It establishes only that the supplied URL, credential, and model accepted one basic chat invocation at that moment. Native-PDF and structured-output flags remain unverified owner declarations; sequential calls is a behaviour setting rather than a tested capability.

Managed-file upload is removed from the product contract rather than declared or tested. Workspace configuration and UI expose no managed-file flag, and processing must not call `/files` or infer managed-file behavior from Azure/model-name prefixes or legacy environment settings.

A pass returns only `200 { "status": "passed" }`. Test failure bodies use the standard product error envelope and never contain raw gateway response content:

- Gateway `3xx` or `4xx`: `422 model_gateway_test_rejected`, with only the numeric `gateway_status` as safe detail.
- Gateway `408`, `429`, `5xx`, or network/DNS failure: `503 model_gateway_test_unavailable`.
- Probe timeout: `504 model_gateway_test_timeout`.
- Gateway `2xx` with invalid JSON or no readable assistant content: `502 model_gateway_test_invalid_response`.

The frontend translates stable codes into useful messages without displaying upstream bodies. A passed or failed result is transient page state tied to the exact draft; changing any draft field clears it. Do not persist `validated`, `last_tested_at`, connection health, gateway status, or capability status on **Workspace model configuration**.
