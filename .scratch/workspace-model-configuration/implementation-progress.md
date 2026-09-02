# Workspace model configuration implementation

Goal: implement the [approved handoff](issues/09-define-implementation-sequence-and-handoff-slices.md) in the current worktree as one coordinated change.

## Implementation and evidence

- [x] Workspace-owned, lazy, atomic configuration storage; encrypted credentials; revision and repair semantics.
- [x] Session-only configuration HTTP resource, conditional mutations, role redaction, and transient single-request connection test.
- [x] Pre-body admission checks and per-attempt Workspace configuration; no global fallback or managed files; safe job metadata and retries.
- [x] Production Workspace UI B, write-only keys, role visibility, transient test feedback, invalidation, and profile setup removal.
- [x] Legacy cleanup, environment retirement, documentation/ADR updates, and existing fixture migration.
- [x] Focused local safety tests.
- [x] `bun run ci:quality`.
- [x] `bun run test:e2e`.
- [x] Implemented-UI walkthrough: setup, key replacement, clear, member visibility, and no redundant banner.
- [x] Final requirement-by-requirement audit against the decision tickets.

Real gateway processing is reserved for the user's manual confirmation. No new gateway/concurrency suite is required. Development state must be disposable; do not read or modify the operator's `.local` state or `.env` secrets.

## Existing changes to preserve

At implementation start, `backend/CONTEXT.md` contains the prior planning/domain edits, and this planning directory is untracked. No production implementation changes existed.

## Final verification — 2026-09-03

- `bun run ci:quality`: passed. Typechecking, lint, 226 backend tests, the separate runtime smoke test, 238 frontend tests, frontend coverage gate, and production build all passed.
- Frontend coverage: lines 83.74%, functions 84.89%, branches 76.14%; checked baselines unchanged.
- `bun run test:e2e`: passed. Three evidence-sanitization checks and all four existing browser journeys passed (24.2 seconds).
- `git diff --check`: passed.
- Existing smoke/browser fixtures now save explicit Workspace configuration through the authenticated resource. Remaining benchmark/test setup no longer relies on retired global environment configuration. No new real-provider or concurrent gateway integration suite was added.
- Generated CI evidence remains under `.scratch/ci/`; no commit, deployment, or operator-state migration was performed.

## Implemented-UI walkthrough

Used a disposable runtime, dummy accounts/credentials, and the existing loopback fixture. Confirmed the actual built UI, not the prototype:

- The approved B section expands from its header and carries its status badge there, without a separate readiness banner.
- Clearing returns URL/model/key to blank, disables Document upload, and leaves all capability declarations unchecked.
- Setup saves independently of a connection test; the password input empties after save.
- Replacing a dummy credential also empties the password input after save; clear requires confirmation and removes the complete configuration.
- An ordinary member of a second configured Workspace sees presence and owner/admin guidance only: no URL, model, credential health, or management controls. Its HTTP representation is exactly `{ "configured": true }`.
- Inbound Workspace API key controls remain a separate section.

The review tab was closed, the disposable runtime and loopback fixture stopped cleanly, and their temporary state was removed. Operator `.local` state and `.env` files were not read or changed.

## Requirement audit

| Decision | Implementation and evidence |
| --- | --- |
| 01 — authority | Optional singleton configuration belongs to the leased Workspace product database. Reads of absent product state are lazy; no control-database/global configuration or seeded default row exists. |
| 02 — lifecycle | Complete-field validation, atomic compare-and-swap, monotonic revision across clear/recreate, write-only AES-256-GCM credentials, fresh nonces, Workspace/version binding, dedicated owner-only machine secret, unavailable-key repair and clear. Local storage/HTTP tests exercise these boundaries. Database and machine-secret backup requirements are documented; Workspace erasure removes the owning database and sidecars. Export/analytics/live-update paths do not serialize credential material. |
| 03 — processing | Admission checks configuration before body parsing, starter Template bootstrap, Source writes, or job creation. Local tests prove 409/503 with no Source/job side effects. Each claimed attempt resolves current configuration before Source reads, retains its in-flight snapshot, and records only revision/model/route metadata. Configuration failure is terminal without gateway retry/outcome; existing recovery, bounded retry, retention, and deletion regressions pass. |
| 04 — HTTP | Session-only resource with owner/admin mutation authority, member presence-only reads, write-only credentials, no-store responses, conditional create/update/delete, 428/412 handling, and secret-free invalidation. Focused HTTP tests cover role enforcement and exact representations. The removed global GET/PATCH route returns 404. |
| 05 — connection test | One transient minimal POST to the same derived `chat/completions` URL, 30-second timeout, no retries/redirects, explicit draft credential or conditional saved-credential reuse, no persistence, sanitized failure classifications. Existing transport tests also cover terminal redirects and discarded error bodies. Frontend tests cover exact-draft/late-response behavior and save independence. |
| 06 — Workspace UI | Production B implementation, blank defaults, write-only credential repair/replacement, nested explicit capabilities, stale revision reload, member visibility, separate inbound key controls, removed profile Model setup. Automated tests and the walkthrough above cover these states. Scope changes clear drafts; live updates and reconnects revalidate without falsely invalidating unchanged drafts or dropping invalidations during saves. |
| 07 — cutover | Additive lazy schema migration preserves saved configuration. Startup/migrate cleanup deletes only the retired legacy file after successful initialization, with safe retryable warnings. Retired environment warnings contain names only. Global defaults, old controller/API/settings object, and managed-file transport paths are removed; operational controls remain. READMEs and ADR 0004/0008 describe the coordinated cutover and backup boundary. |
| 08 — verification | Required focused local safety checks and both root CI commands pass; implemented-UI walkthrough complete. No real-provider claim is made. |
| 09 — handoff | All five internal slices are complete together in this worktree, without a release flag, dual write, global fallback, or rollback path. Real-gateway processing remains for the user's separate confirmation. |
