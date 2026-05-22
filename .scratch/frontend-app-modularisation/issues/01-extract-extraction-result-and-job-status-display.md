# Extract Extraction Result and Job Status Display

Status: completed

## Parent

.scratch/frontend-app-modularisation/PRD.md

## What to build

Extract **Extraction job** status display and **Extraction result** rendering into the Documents feature without changing user-visible behavior. The slice should keep App as the orchestration point while making result/status presentation independently testable.

## Acceptance criteria

- [x] **Extraction job** status display renders the same queued, processing, completed, and failed states as before.
- [x] **Extraction result** display renders the same missing values, scalar answers, object answers, array answers, table answers, confidence badges, and status tones as before.
- [x] Focused component tests cover the non-trivial **Extraction result** rendering branches.
- [x] Existing App-level behavior tests continue to pass.
- [x] The frontend production build succeeds.

## Blocked by

None - can start immediately
