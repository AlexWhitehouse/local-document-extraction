# Temporary Evaluation Result Cache

A Batch Evaluation has no fixed document limit. Keeping every candidate's full output in page memory would therefore use unbounded memory. Detailed results use an encrypted browser cache for the lifetime of the open Evaluation.

This is an explicit exception to the earlier rule that Evaluations use no browser storage. It adds no saved runs, history, or restoration after refresh. It does not change how users view retained originals. See [Retained Source Files](0013-retained-source-files.md).

## Decision

- **Scope.** `frontend/src/features/evaluations/resultCache.js` stores result details in the IndexedDB database `evaluation-result-cache`. Each live Evaluation gets a new random namespace. This cache is separate from the Documents page's completed-job cache.
- **Encryption.** Each Evaluation creates a new non-extractable AES-GCM 256 key with `crypto.subtle.generateKey`. The key exists only in page memory. It is never serialized or derived from session or Workspace identity. Each write uses a new 96-bit IV: 64 random bits and a 32-bit counter. An IV never repeats under the same key. The namespace and record ID are authenticated data. Encryption covers the complete record, including raw output, tested fields, and normalized values.
- **What stays in memory.** React state keeps pair status, tested-input snapshots, timings, usage, and compact score counts for each pair. The Batch summary therefore does not load details. Only the open document's details are decrypted. This active set is limited to 24 pairs or 8 MiB, with at most 16 MiB of pending writes. Each pair keeps its current result and at most one previous successful result.
- **Retained means committed.** Details count as retained only after their IndexedDB transaction completes. Failed reads or writes, quota errors, and eviction pause new document operations. The affected details become unavailable and are excluded from complete comparisons and Best. Other results remain available. The user can select **Retry storage** or **Clear Evaluation**. Summaries do not silently continue without their details.
- **Rescoring.** Expected-answer or column-alignment changes recompute scores without model calls. Rescoring handles one pair at a time and reads stored details as needed. It ignores stale score generations.
- **Lifetime.** Clear, sign-out, access loss, Workspace switch, and `pagehide` immediately detach the key and plaintext. This includes entry to the back/forward cache. These events invalidate pending work, then asynchronously delete only that Evaluation's namespace. Restoration from the back/forward cache starts an empty Evaluation. Same-document navigation and normal backgrounding preserve the Evaluation. Refresh, crash, and duplicated or reopened tabs cannot decrypt remaining data.
- **No cross-tab cleanup.** A tab deletes only its own namespace. It never clears the shared database or removes other namespaces by age. A silent tab can be frozen rather than closed.

## Consequences

- Encrypted data from a crashed tab remains until browser eviction and uses browser storage capacity. If this causes a write failure, the browser shows the same explicit storage error.
- This design protects results from later page loads and other tabs. It does not protect against malicious code in the live page. It cannot guarantee immediate physical erasure or forensic removal from memory.
- Browser capacity limits how much of a very large batch can be kept. It does not impose a document-count limit.
