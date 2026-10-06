# Overlapped rendering and Go data handoffs

Status: render overlap and Source publication barriers enabled. Go intake/result handoffs remain opt-in after benchmark regressions; alternate rasterizers remain benchmark-only.

The rollout/experiment status above is superseded by [ADR-0022](0022-go-as-the-standard-document-processor.md): Go is mandatory and the intake/result prototypes are removed. The following records the original decision.

The next throughput constraint after ADR-0020 is lossless PNG preparation. A
matched six-worker run attributes 62% of serial renderer phase elapsed time to
encoding, 33% to rasterization and 5% to loading. Its 32-operation recycling policy
also starts 19 processes for approximately 560 operations without reaching the
384 MiB RSS threshold.

Go's PDF workers now overlap one page's encoding with the following page's
rasterization. There are at most two outstanding encodes/canvases, page order is
unchanged, and total encoded-byte limits apply before publication. Cancellation,
consumer early return and errors join pending encodes before destroying the PDF.
The same PDF.js renderer, dimensions, background and lossless encoder remain.
Renderer recycling now allows 128 operations; the 64 MiB source-input and 384 MiB
sampled RSS thresholds, idle expiry and cancellation still apply. Private protocol
metrics expose cumulative phase elapsed time, page counts, starts and recycling.
Overlapped phase durations must not be added and presented as CPU utilization.

ADR-0019's execution boundary expands for bulk input and output. After Bun has
authorized the request, acquired resource admission and a Workspace lease, its
stream can be handed to an authenticated private Go intake endpoint (`GO_INTAKE=1`). This remains opt-in because the added network hop regressed the matched host benchmark. Go bounds the
multipart envelope, fields and file while spooling to a private staging directory.
The original product metadata validator and guarded PDF inspector still run.
Source promotion and the FULL-synchronous Workspace commit remain the acceptance
boundary. Neither a staged file nor a successful private intake response is an
accepted Document. Abort/failure cleans staging; supervisor restart clears orphan
staging owned by the former Go process. The public API stays on Bun, so this removes
Bun's multipart parser and file-write stream, not the initial network hop.

With `GO_RESULTS=1`, Go normalizes eligible extraction results against the claimed Template fields.
Differential fixtures cover the existing types, numeric coercion, null/missing
answers, duplicate/unknown fields and status behavior. Legacy ECMAScript dates
and escaped UTF-16 surrogate sequences use the original adapter. Invalid content
also takes the existing validation/error path, preserving usage and retry rules.

Go serializes each answer once and returns prepared rows through the private
callback. Bun validates the row contract and correspondence to the claimed fields,
then passes the serialized answers directly as bound SQLite values. Inserts are
batched in groups of at most 64 rows, with at most 576 bound parameters. Results,
lifecycle completion and usage share the existing FULL-synchronous transaction.
The response allowance stays held through commit. Prepared callbacks are limited
to 16 MiB; larger output uses the original completion path.

A tested intermediate design staged JSON result files and used SQLite json_each
for a bulk insertion. It regressed throughput on the host. That design was removed:
extra file operations and repeated JSON access inside SQLite add work for the
common small-field-count workload.

Bun continues to own SQLite transactions, authentication, Workspace rules, accepted
claims, retention, exports and live updates. Introducing a second writer with an
independent transaction authority would break the atomic result/accounting and
Workspace-deletion contracts. This decision moves byte processing and bulk result
assembly into Go without claiming the entire control/store implementation has
been ported.

The generated comparison corpus includes color/text, an embedded scan with an
overlay, rotation/cropping, form appearances, transparency and a large page.
MuPDF and Poppler are evaluated separately, with dimensions and pixel differences
recorded. Pixel differences do not establish extraction accuracy equivalence.
Neither renderer becomes a production dependency or default through this work.

The profiling audit also found that the existing Source store renamed/wrote files
without explicitly flushing their contents. Process-crash tests do not prove host
power-loss durability. All Source publication paths now sync file contents and
await directory barriers through every ancestor before returning a key for DB
acceptance. Child views flush their backing inode as well as their manifest.
Directory barriers group concurrent publications for two milliseconds, children
before parents. A later rename cannot join an already-started barrier. Failures
reject the affected publication; failed ordinary publications remove their source.
No accepted upload bypasses these barriers, regardless of the selected processor.
Host power-loss testing remains outside what a process-kill test establishes.
