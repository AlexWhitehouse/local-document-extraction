# Enforce failed Source retention and local disk reserve

Category: enhancement
Status: completed
Labels: completed

## Parent

../PRD.md

## What to build

Add an idempotent sweep that deletes Source file binaries seven days after terminal failure while retaining the failed Extraction job/error indefinitely. Add low-disk admission protection and Source/SQLite/WAL byte telemetry; never auto-delete retained Extraction results.

## Acceptance criteria

- Successful Source files still delete immediately after durable completion.
- Failed Source files remain available for seven days by default and are deleted after the window.
- Sweeps survive restart, tolerate missing files, and cannot delete live/queued/processing sources.
- Admission stops with retry guidance before configured disk reserve is breached.
- Workspace deletion and interrupted cleanup remain correct.

## Blocked by

- Stream and bound multipart Source file admission.

## Resolution

Implemented a serialized restart-safe sweep for interrupted completed cleanup and seven-day failed-source expiry, retaining durable jobs/results/errors. Admission checks a configurable disk reserve, while health diagnostics report Source, SQLite, and WAL bytes.
