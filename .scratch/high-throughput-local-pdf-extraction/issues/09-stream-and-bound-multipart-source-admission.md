# Stream and bound multipart Source file admission

Category: enhancement
Status: completed
Labels: completed

## Parent

../PRD.md

## What to build

Add one admission module that reserves count/bytes before multipart materialization, streams the `document` part into a unique temporary file with enforced limits, performs the required PDF page-count read after upload, atomically promotes valid Source files, and cleans temporary state on every exit. Define reliable unread-body behavior for overload on Bun HTTP/1.1.

## Acceptance criteria

- The existing multipart contract and successful `202` body remain compatible.
- Request, part, MIME, duplicate-field, Template, PDF, abort, and capacity failures clean temporary files.
- Common submissions do not overlap a materialized multipart `File` with another full Source byte copy.
- Admission has count/byte/disk-reserve limits and returns `503` with `Retry-After` under shared pressure.
- Keep-alive clients can retry overload responses without native empty `400` failures.
- Generated 2/5/10 MiB PDFs demonstrate bounded admission RSS.

## Blocked by

- Own Workspace SQLite connections for the process lifetime.

## Resolution

Implemented Busboy streaming with 64 KiB watermarks, bounded fields/files/parts/body bytes, unique owner-only temporary files, one required post-upload page-count read, and atomic promotion. Admission reserves count/bytes/memory/disk before parsing and stream-drains overload bodies for reliable keep-alive retries.
