# PDFium subsets, warm inspectors and deferred permits

Status: implemented. Supersedes ADR-0023's statement that materialization is unchanged.

After ADR-0023 the host ran out of CPU before the Bun event loop saturated: at
96 inline Documents/s the API used about 1.1 cores, while the pdf-lib upload
inspectors used 1.3 and, with splitting, the pdf-lib subset workers another 0.75.
More throughput therefore required removing CPU work, not moving it between runtimes.

## Decision

* `document-extraction-pdf serve` also materializes subset PDFs with PDFium
  (`FPDF_ImportPagesByIndex`, `FPDF_SaveAsCopy`), in a separate pool with the existing
  20-second deadline, recycling and watchdog. Group rules match the pdf-lib materializer:
  unique in-range pages, ascending order, no page in two groups, at most 100 groups,
  32 MiB per artifact and 64 MiB per operation. The Bun subset worker no longer serves Go.
* A PDF-input model whose selection is every page in order receives the original
  file. Split assessment previously re-saved the whole packet for every round.
* Upload inspectors recycle after 2,048 Documents or 4 GiB of input instead of
  128 Documents or 256 MiB. A worker start costs about half a CPU-second of Bun startup and
  JIT warm-up; recycling was the inspector's main cost. Per-document parser limits,
  the 128 MiB sampled RSS threshold, deadlines and idle expiry are unchanged.
* Go no longer makes a `capacity/resume` call after each model response. The next
  adapter call carries `X-Resume-Capacity`, and the adapter waits for the permit before
  running it, so validation and commit still hold local capacity. The response body is
  read beforehand under the response byte allowance, which bounds that memory.
* Job summaries for live updates are built only when the Workspace has a subscriber.
  Completed-job accounting is reported separately.
* Packet materialization reads one child slot instead of rebuilding the whole
  packet per child; routing reads candidate tags in one query.
* A full write batch's window timer can no longer flush the following batch early.

## Rejected

* A guarded Go upload inspector. Profiling showed recycling, not parsing, dominated;
  a rewrite of the decompression-bomb and xref guards is not justified by that cost.
* A faster PNG compressor. klauspost/compress matched Go's zlib on rendered pages.
* Folding Source cleanup into the completion commit. Marking a Source cleaned before
  deleting it would hide a failed deletion from the retention sweep.

## Consequences

Matched single 30-second runs (six vCPUs, 96 permits, 24 submitters, backlog 192,
zero-delay simulated provider) before and after:

| Scenario | Before Documents/s | After Documents/s |
| --- | ---: | ---: |
| Inline PDF, explicit Template | 95.9 | 108.9 |
| Inline PDF, split + automatic Template | 69.9 | 99.5 |
| Rendered pages, split + automatic Template | 62.0 | 68.0 |

All runs passed stage-count and result validation with no failed Documents. These are
single runs on a shared host; the rendered change is within run-to-run variation.
PDFium subsets differ byte-for-byte from pdf-lib output while keeping page content,
annotations and widget appearances; check extraction accuracy on a representative
corpus with PDF-input models.
