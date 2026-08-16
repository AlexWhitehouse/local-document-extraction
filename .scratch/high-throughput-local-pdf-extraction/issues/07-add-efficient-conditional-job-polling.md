# Add efficient conditional individual job polling

Category: enhancement
Status: completed
Labels: completed

## Parent

../PRD.md

## What to build

Split the point-read store interface into a lightweight visible snapshot and completed-result hydration. Add weak opaque `ETag`, `If-None-Match`/`304`, `Location`, `Retry-After`, and private revalidation headers exactly as specified by the polling research. Update the frontend request adapter/fallback scheduler without making WebSocket live updates less preferred.

## Acceptance criteria

- Legacy clients still receive the existing `200` JSON shape.
- Matching authorized validators return bodyless `304` before result hydration.
- Queued/processing/failed reads do not query result rows; completed changed reads do.
- Submission and polling responses carry the researched additive headers and cache policy.
- The client uses one in-flight request, capped jittered backoff, abort support, and terminal stop.
- Authorization, deletion, validator parsing, and overload semantics have focused tests.

## Blocked by

- Own Workspace SQLite connections for the process lifetime.

## Resolution

Implemented lightweight job summaries, deferred completed-result hydration, weak opaque validators, authorized `304`, `Location`, `Retry-After`, cache policy, and single-flight jittered client polling. Backend and frontend protocol tests cover the contract.
