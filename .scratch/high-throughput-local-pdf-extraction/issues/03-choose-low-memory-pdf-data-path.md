# Which PDF ingestion and model-transfer path minimizes peak memory?

Category: research
Status: completed
Labels: wayfinder:research, completed
Assignee: research_pdf_data_path

## Parent

../PRD.md

## Decision question

Which implementation of multipart PDF ingestion, durable Source file persistence, PDF preparation, and remote Model gateway submission minimizes byte copies and peak memory without changing the public request contract or extraction result behavior?

## Why this is unresolved

The current route materializes the multipart `File` as an `ArrayBuffer`, performs PDF inspection, and writes the Source file. The runner later reads the complete file again. Some gateway paths render every PDF page and retain all PNG buffers; inline model requests can also create base64 strings and JSON copies. Under concurrent load, those representations can multiply the memory cost of a 2-10 MB PDF.

The most efficient path depends on current Bun multipart/file streaming behavior and on what the configured LiteLLM/Gemini-compatible gateway actually accepts. A direct PDF upload may be much cheaper than page rendering, but only if the gateway contract and model support it reliably.

## Research brief

- Trace every materialization and copy from HTTP request through local Source file storage, page counting/rendering, Model gateway request construction, and cleanup.
- Use current official Bun APIs to determine which multipart and filesystem operations can stream and which force full materialization.
- Establish the active LiteLLM/model request contract from application configuration and official provider/LiteLLM documentation; compare inline PDF data, file upload/reference, and per-page image rendering.
- Determine whether the supported model can receive the original PDF directly and whether doing so preserves current prompt/result semantics.
- Quantify base64/JSON expansion, canvas/page-render buffers, `ArrayBuffer` copies, and worst-case per-job peak memory for the agreed workload mix.
- Consider incremental page processing and prompt/request batching only if direct PDF submission is unavailable or measurably worse.
- Define when successful and failed Source files are deleted under the agreed retention rules, including cleanup after aborted or rejected requests.
- Keep images working, but optimize the PDF-majority path first.

## Resolution criteria

- A byte-lifecycle diagram or table identifies ownership, lifetime, and peak-size contributors for the current and recommended paths.
- The recommended gateway transfer mode is supported by current primary documentation and the actual configured adapter contract.
- Peak-memory estimates are provided for common 2 MB, less-common 5 MB, and maximum 10 MB PDFs at plausible concurrency.
- Necessary streaming/copy-reduction changes and any compatibility fallbacks are specified.
- Cleanup and retry implications are explicit.
- Findings are captured in `../research/low-memory-pdf-data-path.md` with direct links to primary sources.

## Blocked by

None - can start immediately.

## Comments

Resolved in [`../research/low-memory-pdf-data-path.md`](../research/low-memory-pdf-data-path.md). Prefer incremental multipart-to-temp persistence plus the required page-count read, then upload the durable PDF as a lazy file to a verified LiteLLM managed-file ID; keep inline base64 as a bounded compatibility fallback and page rendering as a last resort.
