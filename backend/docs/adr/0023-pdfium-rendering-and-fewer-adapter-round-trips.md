# PDFium rendering and fewer adapter round trips

Status: implemented. Supersedes the renderer in ADR-0021 and ADR-0022's statement
that rendering uses PDF.js workers. Upload admission and materialization are unchanged.
Materialization later moved to PDFium in [ADR-0024](0024-cpu-work-removal-pdfium-subsets-and-deferred-permits.md).

When a model cannot accept PDFs, the Go processor renders pages before the model
call. After ADR-0022 that work still ran in PDF.js under Bun subprocesses, and its
lossless PNG encoding in JavaScript dominated the cost. Every stage also made several
synchronous callbacks into the single Bun event loop, which the inline-PDF benchmark
showed was already saturated at about one core.

## Decision

* Rendering runs in `document-extraction-pdf`, a Go process that loads PDFium with
  purego. Both Go binaries still build with `CGO_ENABLED=0` for all four release
  targets. PDFium is not thread-safe, and a hostile PDF can crash native code, so each
  renderer is a separate process with the existing frame protocol, deadline, idle
  expiry and recycling. A 1 GiB peak-RSS watchdog ends a process during an operation.
* The pinned PDFium build comes from pdfium-binaries and is verified by SHA-256.
  Source builds download it once; release archives bundle each platform's library
  and its third-party licenses.
* Pages render over white at up to 2× scale with each edge capped at 2000 px, which
  providers require in requests with more than 20 images. The PDF.js preview renderer
  uses the same cap. Annotations and form-field appearances are drawn. Output is
  lossless 8-bit gray when every pixel is gray, otherwise RGB, as unfiltered scanlines
  with fast DEFLATE. Maximum compression is the fallback above the payload limit.
  Each page's encoding overlaps the next page's rasterization.
* Documents longer than eight pages render in ordered, parallel eight-page chunks.
* The adapter claims each stage with one `next` call. The extraction claim and its
  model record share one commit. Recording a model call's receipt releases the local
  permit for the provider wait. Go tracks whether the permit is held: resources are
  tried first, only real waits release it, and it is reacquired only before reading
  a response.
* Sequential Workspaces serialize provider calls, not local preparation.
* Byte budgets grant waiters in FIFO order. Unknown-length responses start with
  1 MiB of credit and grow as they are read, rather than reserving the full limit.

## Rejected

* WebAssembly PDFium avoids a native library but rendered the benchmark page about
  ten times slower than native PDFium, and slower than PDF.js.
* MuPDF is faster than PDF.js but AGPL-licensed.
* PDFium as the upload inspector. It accepts decompression bombs, oversized xrefs,
  deep nesting and cyclic page trees that the guarded pdf-lib inspector rejects with
  `pdf_source_file_limit_exceeded` or `invalid_pdf_source_file`. Upload admission
  keeps that contract.
* Caching the credential key in memory. Removing or replacing the key file must make
  credentials unavailable at once, and re-reading it costs only a few system calls.

## Consequences

On a matched six-vCPU benchmark, rendered extraction rose from 17.6 to 44.9
Documents/s and split + automatic Template from 27.9 to 56.4. Scanned pages rose
from 2.4 to 16.9 and from 2.1 to 26.5. Peak process-tree RSS fell by about a third.
See the [Go processor README](../../../backend-go/README.md#pdfium-rendering-verification).

Rendered pixels differ from PDF.js output, as with any renderer change. Geometry,
page order, annotations and form values are preserved, but extraction accuracy
should be checked on a representative corpus. Builds now need network access once
per PDFium version, or `PDFIUM_LIBRARY`/`GO_PDF_WORKER_BINARY` overrides.
`GO_PDF_OVERLAP` and `GO_PDF_PNG_ENCODER` no longer exist.
