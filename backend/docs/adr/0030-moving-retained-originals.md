# Moving retained originals

Issue 101 lets Workspace owners and admins move every retained original of their Workspace into its current location. This follows [Workspace-owned Source storage](0029-workspace-owned-source-storage.md), where a changed location only affected new uploads.

## Decision

- **Target.** A move copies originals into the destination new uploads use: the Workspace bucket, or the installation bucket without one. Moving into installation `local` storage is not supported; job rows would need a new local key as well as a cleared object key.
- **Scope.** Job, packet, packet child and Evaluation library originals. Each owner moves on its own. Jobs and packets move only once they have completed or failed, because processing may still read the original. A packet child's slot copy of its key follows the child.
- **Keys.** Keys contain the destination's prefix, so every move writes a new key. Product rows still hold only the key.
- **Protocol per original.** (1) Read the original fully, within the 32 MiB upload limit, and hash it. (2) In one control-database transaction, insert a `source_object_move_items` row and a `preparing` manifest entry for the new key, with the owner and size. (3) PUT the copy as a single request, read it back and compare its size and SHA-256. (4) Compare-and-swap the owner's reference from the old key, or the local file, to the new key, in the product database. The swap also requires the owner to still be settled. (5) Settle the item.
- **Settling.** Settling re-reads the owner. If the owner references the new key, the new entry is linked, the old entry becomes `deleting` 10 minutes later so reads already in progress can finish, and a library entry's local file is deleted. Otherwise the new entry is released. The old entry is released too if the owner no longer references it. Keys are unique to one owner, so an unreferenced key has no other user. Unreadable product data leaves the item for a later attempt. The live path and crash recovery use the same code. Every item present at the start of a mover sweep was interrupted, because items exist only while a sweep runs.
- **Recovery boundary.** Stale-upload recovery skips manifest entries that have a move item. Without that, recovery could release a copy just before the swap made it the owner's original.
- **Local originals.** A job's local original keeps its local key; setting the object key lets existing retention cleanup remove the local working copy. A library entry drops its local key in the swap, and the move deletes the file.
- **Job record.** `source_object_moves` in the control database holds one running move per Workspace, with its target, cursor, pass, counters and pause state. `source_object_move_failures` lists originals that cannot move (missing, over 32 MiB, failed verification); they are not retried in that move. Only the latest move is kept, and starting another replaces its report.
- **Passes and outages.** Busy originals, unlinked entries and unreachable source buckets are counted as waiting. Up to six passes retry them with growing delays. A source bucket that fails is skipped for the rest of the pass. An unreachable target pauses the whole move with backoff and keeps the cursor. A changed target, unreadable target keys or a deleted Workspace stop the move.
- **Isolation.** The mover has its own limits: two concurrent originals per destination and four overall, separate from download read slots and submission admission. Moves of different Workspaces run concurrently.
- **Sizes.** Manifest entries now record `byte_size` for new uploads and moved copies. Location summaries report originals per destination from linked entries, and local originals from product data. Older entries report unknown size.
- **API.** `GET|POST|DELETE /v1/workspaces/:id/source-storage/move`, session-only and limited to owners and admins. MCP does not offer moves.

## Consequences

- Moving off the installation bucket empties its `installation` manifest entries, so the startup guard then allows `SOURCE_STORAGE_S3_*` to change. Emptied retired Workspace destinations are pruned by existing cleanup.
- Data passes through the server, so providers may charge egress. Memory per original is bounded by twice the 32 MiB limit, times four concurrent originals.
- Versioned or Object Lock source buckets keep old versions after the move's deletes, as for any deletion.
- Reading back and hashing every copy doubles target reads. Provider checksums vary across S3-compatible services, so they are not relied on.
- No installation-wide CLI move yet. Moves start separately, never automatically after a location change.
