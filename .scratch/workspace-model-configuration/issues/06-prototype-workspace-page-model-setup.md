# Prototype Model gateway setup on the Workspace page

Type: prototype
Status: resolved
Parent: ../map.md
Blocked by: 04, 05

## Question

What Workspace-page experience makes blank, configured, invalid, and editing states of **Workspace model configuration** clear without exposing its credential or crowding Workspace membership and API-key management?

Create a cheap prototype covering owner/admin setup and replacement, ordinary-member readiness, capability declarations, credential write-only behaviour, clearing/rotation, the optional transient **Model gateway connection test** and its feedback, the disabled or blocked Document submission state, and recovery from `workspace_model_not_configured`. Decide whether the experience should be an inline card, expandable section, or Workspace-scoped modal launched from the page.

## Prototype review

Verdict: B — Expandable section, without the separate submission-readiness banner, approved by the user after reviewing the refinement ("Yep much better").

- Primary source: throwaway branch `codex/prototype-workspace-model-setup`, commit `f6120f711d8f1083e5f4a5cac450110cddbd8e10`.
- [Prototype guide and run command](/tmp/local-extraction-model-ui.uYqgs7/frontend/src/features/workspaces/PROTOTYPE-model-gateway.md). From that branch, run `bun run prototype:workspace-model`.
- [Local review entry point](http://127.0.0.1:5173/__prototype/start) starts a disposable session while the prototype runner is active. Variants share the existing Workspace page at `/?variant=A`, `B`, and `C`.
- Compare **Inline setup**, **Expandable section**, and **Workspace modal** using the floating switcher. Scenario controls expose owner/member, blank/configured/unavailable, concurrent-edit, loading, and test-result states. Gateway actions are in-memory simulations; no real credentials or gateway calls are used.
- Browser review covered blank-field validation, a test using an undisplayed saved-key state, failed testing without blocking saving, unreadable-key replacement requirements, clear confirmation, and member-redacted rendering. Desktop and normal panel widths were inspected. The prototype build and `git diff --check` pass; no production implementation or tests were added.

The selected expandable section keeps configuration status inside its header while leaving membership and external-client Workspace API access compact. The separate readiness banner above it has been removed; upload gating is unchanged. Browser verification confirmed the banner is absent, the blank Workspace still has Upload Document disabled, and the setup section still expands. A and C remain available only as reference variations.

## Answer

Use **B — Expandable section** on the existing Workspace page. Keep the configuration-status badge inside the section header and omit the separate submission-readiness banner above it. The user chose B, requested the banner's removal, and approved the refined result.

The captured prototype is the visual and interaction reference: owners/admins expand setup or management in place; gateway URL, model name, and write-only credential appear in the editor, with capability and call-behaviour options in a nested expandable group. Ordinary members receive status-only presentation. Workspace API access and membership management remain separate from outbound Model gateway setup.

This layout decision does not change the already-resolved configuration lifecycle, admission rules, [HTTP contract](04-define-workspace-model-configuration-http-contract.md), or [connection-test contract](05-decide-gateway-compatibility-validation.md). The simulated states demonstrate those contracts; they are not production implementations or new backend behavior.

The primary source and verification evidence are recorded above. Keep all prototype variants and review controls on the throwaway branch. Implement the selected design properly during the later implementation phase; this planning ticket makes no production changes.
