# Temporary Evaluation Result Cache

A Batch Evaluation has no fixed document limit, so holding every candidate's full output in page memory is not bounded. Detailed results therefore go to an encrypted browser cache that lives exactly as long as the open Evaluation. This is an explicit exception to the earlier rule that Evaluations use no browser storage. It adds no saved runs, history or refresh restoration, and it does not change how retained originals are viewed (see [Retained Source Files](0013-retained-source-files.md)).

## Decision

- **Scope.** `frontend/src/features/evaluations/resultCache.js` stores result details in the IndexedDB database `evaluation-result-cache` under a fresh random namespace for each live Evaluation. It is separate from the Documents page's completed-job cache.
- **Encryption.** Each Evaluation generates a new non-extractable AES-GCM 256 key with `crypto.subtle.generateKey`. The key exists only in page memory and is never serialized or derived from session or Workspace identity. Every write uses a new 96-bit IV (64 random bits plus a 32-bit counter, so none repeat under a key), and the namespace and record id are bound as authenticated data. The whole detail record is encrypted: raw output, tested fields and normalized values.
- **What stays in memory.** Pair status, tested-input snapshots, timings, usage and compact per-pair score counts stay in React state, so the Batch summary never loads details. Only the open document's details are decrypted, into a bounded hot set (24 pairs or 8 MiB), with at most 16 MiB of pending writes. A pair keeps at most its current result and one previous successful result.
- **Retained means committed.** A detail counts as retained only after its IndexedDB transaction completes. A failed write or read, a quota error or eviction pauses new document operations, marks the affected details unavailable (excluded from complete comparisons and Best), keeps everything else, and shows an explicit **Retry storage** or **Clear Evaluation** choice. Summaries never silently continue without their details.
- **Rescoring.** Editing Expected answers or column alignments recomputes scores without model calls, one pair at a time, reading cold details as needed. Stale score generations are ignored.
- **Lifetime.** Clear, sign-out, access loss, Workspace switch and `pagehide` (including entry to the back/forward cache) detach the key and plaintext at once, invalidate pending work, then asynchronously delete only that Evaluation's namespace. A page restored from the back/forward cache starts an empty Evaluation. Same-document navigation and ordinary backgrounding keep the Evaluation. Refresh, crash and duplicated or reopened tabs cannot decrypt anything left behind.
- **No cross-tab cleanup.** A tab deletes only its own namespace. It never clears the shared database or removes other namespaces by age, because a silent tab may be frozen rather than gone.

## Consequences

- Ciphertext left by a crashed tab stays until the browser evicts it, and counts against browser storage. If that causes a write failure, the user gets the same explicit storage error.
- This protects results from later page loads and other tabs. It does not protect against malicious code running in the live page, and it cannot guarantee immediate physical erasure or forensic removal from memory.
- Browser capacity is a real limit on how much of a very large batch can be kept, but it is not a document-count limit.
