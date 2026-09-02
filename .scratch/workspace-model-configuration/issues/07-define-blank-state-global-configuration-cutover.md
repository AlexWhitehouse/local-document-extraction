# Define the blank-state cutover from global model settings

Type: grilling
Status: resolved
Parent: ../map.md
Blocked by: 01, 02, 03

## Question

How should the implementation remove the app-wide Model gateway settings while guaranteeing that every existing and future **Workspace** is blank until explicitly configured?

Resolve treatment of `.local/data/model-gateway.json`, `MODEL_GATEWAY_URL`, `AI_MODEL`, `LITELLM_KEY`, `MODEL_GATEWAY_USE_MANAGED_FILES`, Azure/model-prefix managed-file inference, and built-in defaults; safe disposal or non-use of legacy credentials; idempotent schema/data migration; startup and rollback behaviour; profile-menu removal; documentation and environment-surface cleanup; and how the decision supersedes the relevant parts of ADR 0004.

## Comments

### Initial inspection

- `backend/src/localModelSettings.ts` reads `<stateDirectory>/data/model-gateway.json` at startup, overlays saved settings onto environment configuration, and writes `api_key` directly into owner-only JSON without encryption. No actual local settings or environment-secret contents were inspected.
- `backend/src/server.ts` creates that app-wide settings object and supplies its configuration provider to the extraction runner. `backend/src/consumer/modelGateway.ts` also contains built-in gateway and model fallbacks.
- ADR 0004 explicitly documents the global file/environment/default precedence. The already-agreed Workspace-only authority supersedes that policy; this ticket will define the cutover and retirement details, not reopen whether Workspaces inherit configuration.

### Agreed: legacy settings disposal

The user agreed to remove the app-owned legacy settings file after successful cutover initialization, without importing or automatically archiving its contents. The subsequent no-rollback decision removes any requirement to retain or prepare a rollback copy. This remains a planning decision; no legacy file has been removed.

### Agreed: cleanup failure handling

The current server creates its app-wide settings object before runner recovery and before becoming ready. The migration command initializes control/auth state; Workspace product stores remain lazy. Legacy-file cleanup must be separated from resolving usable Workspace configuration.

The user agreed: if deleting the retired settings file fails, continue startup with Workspace-only configuration, emit a secret-free warning, and retry cleanup at the next startup. Never read or use the retired file. Cleanup failure is not a configuration fallback or a reason to block application startup.

### Agreed: retired environment settings

Inspection found environment configuration entering both `localModelSettings.ts` and the runner's default configuration path. `consumer/modelGateway.ts` also supplies built-in endpoint/model/route fallbacks and capability defaults. Removing only the profile settings file would therefore not enforce the already-agreed Workspace-only authority.

The user agreed to this environment retirement policy:

- Stop using `MODEL_GATEWAY_URL`, `AI_MODEL`, `LITELLM_KEY`, `MODEL_GATEWAY_ROUTE_LABEL`, `MODEL_GATEWAY_SEQUENTIAL_CALLS`, `MODEL_SUPPORTS_PDF_INPUT`, `MODEL_SUPPORTS_STRUCTURED_OUTPUT`, and `MODEL_GATEWAY_USE_MANAGED_FILES` as runtime configuration. Remove the retired defaults and managed-file inference as already agreed.
- If retired variables are present, ignore them and emit one consolidated warning per startup listing variable names only, never values. Their presence does not block startup.
- Leave operator-owned `.env` files untouched. Update tracked examples and documentation to direct gateway setup to the Workspace page and explain manual removal of retired settings.
- Keep machine-wide operational controls, such as the extraction request timeout, retry settings, capacity, and retention, supported separately from Workspace model configuration.

### Agreed: schema migration strategy

`localWorkspaceProductStore.ts` already initializes or opens each product database lazily and applies numbered migrations in an immediate transaction, recorded in `product_schema_version`. The resolved authority decision keeps absent product databases lazy and treats configuration absence as the unconfigured state.

The user agreed: add configuration storage through an additive, versioned migration when each Workspace product database next opens. Insert no default configuration rows, import no global settings, and perform no bulk Workspace reset. Reopening stores, restarting, or rerunning migration must preserve configuration explicitly saved after upgrade and leave existing Templates, Documents, and results intact. The blank-state guarantee applies to Workspaces arriving from the old global configuration model, not to clearing subsequently configured Workspaces.

### Agreed: no rollback support

The existing backup instructions in `backend/README.md` require the server to be stopped while copying local state. Old application code still resolves global settings and environment/default fallbacks, so running it against upgraded state would not preserve the Workspace-only authority boundary.

The user rejected the proposed rollback policy: "No rollback needed." This cutover is forward-only. Do not add a supported rollback procedure, downgrade migration, dual-write compatibility, or a rollback-backup prerequisite. Running old application code against upgraded state is unsupported. Existing backup/restore requirements for current-version authoritative local state remain unchanged; they are not a promise of downgrade compatibility.

### Agreed: retiring the old settings interface

The current global API is `GET`/`PATCH /v1/settings/model`, called by the profile menu's model-settings controller. The application's unmatched-route response is `404` with `{error:{code:"not_found",message:"Route not found"}}`.

The user agreed: remove the global route and let calls receive the ordinary `404 not_found` response, with no redirect, alias, or compatibility shim to the Workspace resource. Remove the old profile-menu Model settings UI and controller when the approved Workspace-page setup ships. A stale browser must refresh to load the new UI; it cannot continue changing global settings.

### Final shared-understanding check

The user confirmed the complete cutover contract after reviewing the final summary. This ticket is resolved.

- Apply the existing [Extraction-job configuration semantics](03-decide-extraction-job-configuration-semantics.md) during upgrade recovery as well: recovered or queued work fails terminally if its next attempt finds no Workspace configuration. The schema migration itself does not reset jobs or delete product data. There is no cutover-specific waiting queue, grandfathered global configuration, or automatic restart after setup.
- During later implementation, update tracked setup documentation and examples together with the code. Explain blank Workspace setup, retired environment variables and the old endpoint, cleanup warnings, and the forward-only upgrade. Mark the global configuration/defaults/profile-settings and managed-file portions of ADR 0004 as superseded by the Workspace-owned contract. Preserve its unaffected OpenAI-compatible transport, runner/lifecycle separation, retry, and non-secret operational-metadata decisions.
- No production code, runtime state, operator environment files, or ADRs have been changed by this planning ticket.

## Answer

The cutover is **forward-only and Workspace-owned**. No existing or new Workspace inherits the legacy global settings, environment-backed gateway configuration, or built-in gateway/model defaults. Configuration is absent until explicitly saved through the authorised Workspace UI.

Add configuration storage through an additive, versioned migration when each Workspace product database next opens. Do not create placeholder configuration rows, bulk-initialise missing product databases, import global settings, or reset Workspace data. Reopening a store, restarting, and rerunning migrations preserve subsequently saved Workspace configuration and existing Templates, Documents, and results.

After successful cutover initialization, remove only the app-owned legacy `<stateDirectory>/data/model-gateway.json` file, without reading, importing, or automatically archiving its contents. A missing file is already clean. If removal fails, continue startup using Workspace-only configuration, emit a secret-free warning, and retry cleanup on the next startup. The retired file is never a runtime source, including when cleanup fails.

Retire `MODEL_GATEWAY_URL`, `AI_MODEL`, `LITELLM_KEY`, `MODEL_GATEWAY_ROUTE_LABEL`, `MODEL_GATEWAY_SEQUENTIAL_CALLS`, `MODEL_SUPPORTS_PDF_INPUT`, `MODEL_SUPPORTS_STRUCTURED_OUTPUT`, and `MODEL_GATEWAY_USE_MANAGED_FILES` as runtime configuration. If present, ignore them and issue one consolidated warning per startup containing names only, never values. Leave operator-owned `.env` files untouched. Machine-wide operational controls such as request timeouts, retries, capacity, and retention remain supported separately. Remove built-in gateway/model fallbacks and managed-file behavior, including Azure/model-prefix inference, rather than retaining hidden compatibility paths.

Remove the global `GET`/`PATCH /v1/settings/model` route; calls receive the ordinary `404 not_found` route response, with no redirect, alias, or compatibility shim. Remove the profile-menu Model settings UI and its controller when the approved Workspace-page setup ships. Stale browser tabs must refresh to use the new interface.

Startup and recovery use the already-resolved [Extraction-job configuration semantics](03-decide-extraction-job-configuration-semantics.md). Unconfigured submissions return `409` before Source-file or job side effects; queued, recovered, or retrying work fails terminally if its next attempt finds no configuration. There is no cutover-specific waiting queue or grandfathered global configuration. Credential-unavailable behavior remains the agreed `503`/repair contract. Schema migration does not itself reset job state or delete product data.

No supported rollback procedure, downgrade migration, dual-write compatibility, or rollback-backup prerequisite is required. Running old application code against upgraded state is unsupported. Current-version local-state backup/restore requirements remain unchanged.

Update tracked setup documentation and examples with the implementation. Mark ADR 0004's global configuration/defaults/profile-settings and managed-file decisions as superseded by the Workspace-owned contract, while preserving its unaffected OpenAI-compatible transport, runner/lifecycle separation, retry, and non-secret operational-metadata decisions. This resolution records the specification only; it performs no production implementation or legacy-state cleanup.
