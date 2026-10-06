# PDFium as the only PDF engine

Status: implemented. Supersedes ADR-0012's guarded pdf-lib inspector and the PDF.js
rendering kept for previews, blank-page checks and the API's own model calls.

The application used three PDF engines: pdf-lib for upload inspection and some page
copies, PDF.js for previews, blank-page checks and Template-assistance/evaluation
rendering (inside the API process), and PDFium for Go processing. A file one engine
accepted could fail in another, the inspector patched pdf-lib internals and pinned one
unmaintained release, and inspection was the largest CPU cost after the API itself.

## Decision

* `document-extraction-pdf serve` is the only PDF engine. The Bun API spawns the same
  binary for `inspect`, `preview`, `blank`, `render` and `materialize`; requests carry a
  private path or inline bytes. pdf-lib, PDF.js and `@napi-rs/canvas` are no longer
  production dependencies; pdf-lib and canvas remain development dependencies for
  test fixtures and benchmarks.
* Inspection opens the document and reads every page's size from its page dictionary.
  PDFium parses lazily, so content and streams outside the page tree are never
  decoded. Malformed files, cyclic page trees and invalid page sizes are rejected as
  `invalid_pdf_source_file`; more than 10,000 pages is `pdf_source_file_limit_exceeded`.
* Parser-level budgets are replaced by process bounds. Inspectors stop at 256 MiB of
  sampled resident memory during an operation, and the five-second deadline still
  applies; either maps to `pdf_source_file_limit_exceeded`. Page-operation workers stop
  at 1 GiB. Every worker samples its own resident size: Linux preserves getrusage's
  peak across execve, so a worker spawned by a large API process would otherwise
  start above its ceiling.
* Blank verification keeps PDF.js's conservative rule: any text character other than
  whitespace, any annotation, or any non-white pixel means the page is not blank.
* Previews and the API's model calls use the processor's rendering: 2× scale, 2000 px
  edge limit, lossless PNG, maximum compression only when the payload limit requires it.

## Consequences

* A hostile page tree must now be decoded before it is rejected, up to the memory
  ceiling, rather than refused by a parser budget. Structures outside the page tree
  that the old parser rejected (oversized metadata streams, xref and object-stream
  counts, nested arrays, large tokens) are admitted without being decoded. A page
  whose content is a decompression bomb is admitted; drawing it stops at the worker
  ceiling, and copying it keeps the content encoded.
* Previews change pixels slightly and now match what models receive.
* Matched single 30-second runs on six vCPUs (96 permits, zero-delay simulated provider):

| Scenario | ADR-0024 Documents/s | This decision Documents/s |
| --- | ---: | ---: |
| Inline PDF, explicit Template | 108.9 | 122.4 |
| Inline PDF, split + automatic Template | 99.5 | 99.1 |
| Rendered pages, split + automatic Template | 68.0 | 63.4 |

Inspection CPU fell from about 0.96 to 0.18 cores at the higher rate. The split and
rendered scenarios do not inspect more per Document and are within run-to-run
variation; the Bun API (about 1.2 cores) and rendering remain their limits. All runs
passed stage-count and result validation with no failed Documents.
