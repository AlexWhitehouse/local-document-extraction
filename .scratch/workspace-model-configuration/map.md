# Wayfinder Map: Workspace-Owned Model Gateway Configuration

Status: resolved
Labels: wayfinder:map

## Destination

Produce an implementation-ready specification for replacing the single local **Model gateway** configuration with complete, workspace-owned configuration and relocating setup from the profile menu to the Workspace page.

Every new and existing **Workspace** starts unconfigured and rejects **Document** submission with HTTP `409` until an authorised Workspace owner or admin configures its gateway URL, model name, credential, and capability options.

## Notes

- This map is planning-only. It resolves the decisions needed for a later implementation handoff; it does not carry out that implementation.
- Use **Workspace model configuration** for the Workspace-owned gateway URL, model name, write-only **Model gateway credential**, and capability options used by the **Extraction processor**.
- **Workspace model configuration** is complete or absent: gateway URL, model name, and a non-empty credential are saved atomically. Capability options are Workspace-scoped and may have explicit form defaults.
- Workspace owners and admins may create, replace, or clear the configuration. Ordinary members may run extraction and see only whether configuration is present; they may not view configuration details or credential usability, or change configuration.
- No new or existing Workspace inherits the current saved app-wide configuration, environment variables, or built-in Model gateway/model defaults. All Workspaces begin the cutover blank.
- Submission against an unconfigured Workspace is rejected before a **Source file** or **Extraction job** is persisted, using HTTP `409` with error code `workspace_model_not_configured`.
- Preserve the distinction between the **Workspace API key**, which authenticates an external client to product routes, and the **Model gateway credential**, which authenticates outbound processing to the Model gateway.
- Use the `domain-modeling` and `grilling` skills while resolving decision tickets. Use the `prototype` and `frontend-design` skills for the Workspace-page prototype ticket.
- Consult `CONTEXT-MAP.md`, the relevant Backend and Frontend context documents, and `backend/docs/adr/0004-litellm-model-gateway-for-extraction.md`. This effort intentionally revisits the app-wide defaults and overrides in that ADR.
- Secrets must never appear in public responses, logs, analytics, live-update payloads, job metadata, or prototype fixtures.

## Decisions so far

<!-- Resolved ticket pointers are appended here. Open tickets are discovered from the child issue files. -->

- [Choose the authority boundary for Workspace model configuration](issues/01-choose-workspace-model-configuration-authority.md) — Configuration is optional authoritative Workspace product data, accessed through the Workspace product-store lease and included in that data's lazy creation, backup/restore, and hard-erasure boundary.
- [Define the Workspace model configuration and credential lifecycle](issues/02-define-configuration-and-credential-lifecycle.md) — Configuration is complete, revisioned, structurally validated, and role-redacted; its write-only credential uses machine-secret encryption, explicit replacement/clearing, secret-bearing backups, and recoverable `503` failure semantics.
- [Decide how configuration changes affect Extraction jobs](issues/03-decide-extraction-job-configuration-semantics.md) — Admission fails before side effects when configuration is absent/unreadable; each attempt uses the latest configuration, in-flight work stays stable, configuration failures are terminal, and transient gateway failures retain bounded retries.
- [Define the Workspace model configuration HTTP contract](issues/04-define-workspace-model-configuration-http-contract.md) — A session-only, role-redacted Workspace product resource uses complete conditional PUTs, strict conditional DELETE, write-only credential handling, stable admission failures, no-store responses, and secret-free Workspace invalidation.
- [Decide how Model gateway compatibility is validated](issues/05-decide-gateway-compatibility-validation.md) — Saving remains structural-only; owners/admins may run one transient, secret-safe `chat/completions` connection test, while capability declarations stay unverified and managed-file behavior is removed.
- [Prototype Model gateway setup on the Workspace page](issues/06-prototype-workspace-page-model-setup.md) — Approved B's expandable section with status in its header and no separate readiness banner; the captured prototype guides later implementation.
- [Define the blank-state cutover from global model settings](issues/07-define-blank-state-global-configuration-cutover.md) — Forward-only lazy migration imports nothing, preserves subsequently saved configuration, retires legacy settings and interfaces, and treats cleanup failures as non-blocking warnings.
- [Set the implementation-ready verification contract](issues/08-set-implementation-verification-contract.md) — Require focused local safety tests, existing CI, and a brief implemented-UI walkthrough; the user confirms real gateway processing, with no new gateway/concurrency integration suite.
- [Define the implementation sequence and handoff slices](issues/09-define-implementation-sequence-and-handoff-slices.md) — Five ordered internal slices, each with contract pointers and completion evidence, ship together as one coordinated change; this ticket is the implementation handoff index.

## Not yet specified

None. All decision tickets are resolved; the implementation-ready handoff is complete. Production implementation remains a separate step.

## Out of scope

- Implementing the backend or frontend changes during this Wayfinder map.
- Changing Template semantics, extraction prompts, Extraction result shapes, or model-quality policy.
- Adding provider-specific integrations that are not expressed through the existing OpenAI-compatible Model gateway contract.
- Retaining an application-wide or environment-backed fallback configuration after cutover.
- Exposing the Model gateway credential after it has been saved.
- Rollback and downgrade support for this cutover, explicitly declined in [Define the blank-state cutover from global model settings](issues/07-define-blank-state-global-configuration-cutover.md).
- A new mandatory gateway-backed or concurrent gateway integration suite, declined in [Set the implementation-ready verification contract](issues/08-set-implementation-verification-contract.md); existing project checks remain in scope.
