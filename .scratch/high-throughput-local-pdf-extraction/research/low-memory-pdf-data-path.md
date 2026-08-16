# Low-memory PDF data path

Research date: 2026-08-16

## Recommendation

Use the original PDF throughout, but remove byte-oriented interfaces from both ends of the durable Source file lifecycle:

1. Parse the incoming multipart body incrementally into a unique temporary file while enforcing the request and `document`-part limits. The current Bun `Request.formData()` path does not expose an individual part stream.
2. After the upload is complete, load the temporary PDF once for the required submission-time page count, then atomically promote it to the durable Source file location before creating the queued Extraction job. This keeps the public multipart contract and the existing accept/reject semantics.
3. In the runner, pass a lazy `Bun.file(sourcePath)` to a LiteLLM managed-file upload, send the returned `file_id` in the existing single `/chat/completions` request, and delete the remote file in `finally`. Do not read or base64-encode the local PDF.
4. Gate step 3 on an administrator confirming that the active `gpt-5.6-luna` model group has `supports_pdf_input: true` and that managed files are enabled for that alias. The current local setting is an assertion, not gateway proof. Keep inline base64 as a temporary compatibility fallback with sharply bounded concurrency; use page rendering only when the selected model genuinely lacks PDF input.

This is a decision record, not a production implementation. The file-ID path preserves the current prompt and one-request extraction semantics because only the representation of the same original PDF changes.

## Evidence from the current implementation

The active stored configuration (secret omitted) selects gateway `https://litellm.t3m.uk`, model alias `gpt-5.6-luna`, concurrent model calls, and `supports_pdf_input: true`. The stored configuration overrides the `.env` model. On 2026-08-16, authenticated read-only probes showed the alias in `/v1/models` and a live `/v1/files` route, but `/model_group/info` returned `403`. Those observations do **not** reveal the underlying provider, prove PDF support, or prove that LiteLLM managed files and their database are enabled. No file was uploaded during this research.

The application path is:

| Stage | Current implementation | Ownership and lifetime | Peak contributor |
| --- | --- | --- | --- |
| Multipart decode | [`validation.ts:379-418`](../../../backend/src/lib/validation.ts#L379) awaits `request.formData()` and receives a `File`. | `FormData`/`File` remain reachable through validation and submission. Bun does not document a per-part stream from this interface. | One materialized `File` of size `S`; whether Bun keeps its backing in heap or temporary storage is implementation detail. |
| Submission inspection | [`localApplication.ts:568-584`](../../../backend/src/localApplication.ts#L568) calls `source.arrayBuffer()`, then page-counts and writes the Source file. | The `File` and returned `ArrayBuffer` overlap until the handler returns. | `Blob.arrayBuffer()` is documented to copy, so this adds `S`. `PDFDocument.load` parses the complete byte array and adds unquantified parser objects. |
| Durable write | [`localSourceFileStore.ts:34-47`](../../../backend/src/localSourceFileStore.ts#L34) creates a `Uint8Array` view and calls `writeFile`. | The durable file then outlives the request. | The view is negligible; native write staging is not quantified. |
| Runner read | [`localExtractionRunner.ts:164-192`](../../../backend/src/localExtractionRunner.ts#L164) reads the complete file, then [`localExtractionRunner.ts:352-355`](../../../backend/src/localExtractionRunner.ts#L352) copies it into a new `ArrayBuffer`. | Both representations remain reachable through the gateway call. | `2S` before model preparation. |
| Active PDF transfer | [`modelGateway.ts:77-91`](../../../backend/src/consumer/modelGateway.ts#L77) uploads only model names beginning `azure/` or `azure_ai/`; [`modelGateway.ts:355-386`](../../../backend/src/consumer/modelGateway.ts#L355) therefore inlines the active alias as a base64 data URL. [`modelGateway.ts:528-537`](../../../backend/src/consumer/modelGateway.ts#L528) then `JSON.stringify`s the whole request. | Source bytes, base64 value, JSON body, and possibly encoded request bytes overlap. [`modelGateway.ts:752-762`](../../../backend/src/consumer/modelGateway.ts#L752) also constructs an intermediate binary string. | Base64 is `4 × ceil(S/3)` bytes. Reachable representations are about `4.67S` before fetch encoding; a conservative upper estimate is `8.67S` if JavaScriptCore uses two-byte strings and fetch stages UTF-8 bytes. |
| Image fallback | When PDF support is disabled, [`pdfPageRenderer.ts:17-61`](../../../backend/src/consumer/pdfPageRenderer.ts#L17) renders every page, retains every PNG, and only then maps all PNGs to base64. | All encoded pages and their base64/JSON forms survive through the single completion call. | One 2048×2048 RGBA canvas can be about 16 MiB. Total rendered data is not bounded by compressed input size and may greatly exceed `S`. |
| Cleanup | [`localExtractionRunner.ts:197-225`](../../../backend/src/localExtractionRunner.ts#L197) completes the job before deleting the local Source file. [`modelGateway.ts:100-116`](../../../backend/src/consumer/modelGateway.ts#L100) deletes an uploaded gateway file in `finally`. | Failed processing retains the local Source file for inspection; successful processing removes it. | Cleanup does not reduce request peak, but prevents retained-byte growth after success. |

The page-count implementation is inherently whole-file today: [`sourceFilePageCount.ts:11-17`](../../../backend/src/lib/sourceFilePageCount.ts#L11) calls `PDFDocument.load`, whose [official source converts the supplied `ArrayBuffer`/`Uint8Array` and parses the document](https://github.com/Hopding/pdf-lib/blob/master/src/api/PDFDocument.ts). The domain decision also requires the count at submission time ([`backend/CONTEXT.md:341-343`](../../../backend/CONTEXT.md#L341)), so page counting cannot simply move into background processing.

## Why the recommended path is supported

### Inbound and filesystem path

Bun documents `Bun.file(path)` as a lazy `Blob`, and `Bun.write` as accepting `Blob`, `ArrayBuffer`, typed arrays, or `Response` using the fastest available syscall ([Bun file I/O](https://bun.sh/docs/runtime/file-io)). Bun's stream documentation describes streams as the way to avoid loading all data at once ([Bun streams](https://bun.sh/docs/runtime/streams)). Conversely, Bun documents that `Blob.arrayBuffer()` copies contents ([Bun binary data](https://bun.sh/docs/runtime/binary-data)), and its FormData helpers consume a stream into a `FormData` result ([Bun utilities](https://bun.sh/docs/runtime/utils)). The official upload guide also uses `request.formData()` and then writes the resulting `File`; it does not provide a streaming part interface ([Bun file uploads](https://bun.sh/guides/http/file-uploads)).

Therefore the low-memory admission path requires an incremental multipart parser over `request.body`, not another call to a Bun FormData conversion helper. It should stream only the `document` part to a temporary file with bounded parser buffers; keep the small text fields bounded in memory; reject duplicate/unknown large parts; enforce both total body and part byte counts during streaming; and delete the temporary file on parse error, limit violation, invalid MIME, disconnect, or page-count failure. After validation, an atomic rename makes the Source file durable. A header-only `Content-Length` check is useful early rejection but cannot replace the streaming byte counter.

The page count still needs one `S`-sized read with the present pdf-lib implementation. Perform it after multipart streaming has finished so the parser does not retain another full representation. This reduces admission from at least the overlapping `File + ArrayBuffer` (`~2S`, excluding parser objects) to `~S + bounded chunks + parser objects`.

### Outbound Model gateway path

LiteLLM's current PDF-input contract supports a `file` content part using either a URL/file ID or base64 data and documents PDF-capable provider families ([LiteLLM PDF input](https://docs.litellm.ai/docs/completion/document_understanding)). The same primary documentation says `/model_group/info` is the check for a model group's `supports_pdf_input`; it also permits that flag to be set manually, which is why the application's local Boolean cannot prove provider capability.

LiteLLM managed files accept a PDF with `purpose=user_data` plus `target_model_names`, then allow the returned file ID in `/chat/completions` across providers ([LiteLLM managed files](https://docs.litellm.ai/docs/proxy/litellm_managed_files)). That matches the existing adapter's upload fields and file content part. However, managed files are currently a beta LiteLLM Enterprise feature and require the LiteLLM proxy plus a PostgreSQL database. The gateway owner must therefore verify/enable this mode for `gpt-5.6-luna`; the existence of `/v1/files` alone is insufficient.

The runner should give `FormData` a lazy `Bun.file(sourcePath, { type: "application/pdf" })` instead of an `ArrayBuffer`-backed `Blob`. Bun documents that large file uploads may use `sendfile` only under specific conditions and otherwise fall back to reading the file into memory; HTTPS is specifically less favorable ([Bun fetch implementation details](https://bun.sh/docs/runtime/networking/fetch)). Because the active gateway is HTTPS, the estimate below allows one full upload buffer and does not claim zero-copy transport. Even so, this avoids the explicit runner copy, intermediate binary string, base64 expansion, and full JSON copy.

An externally hosted URL is not recommended: the authoritative Source file is local and intentionally not public. Provider-specific file uploads are also inferior to LiteLLM managed files here because the active alias hides the provider and may route across providers.

## Peak-memory estimates

Let `S` be compressed PDF size. These are byte-representation estimates, not measurements. They exclude runtime baseline, pdf-lib/PDF.js parser objects, TLS internals, response JSON, and allocator fragmentation.

- Current active inline path: approximately `4.67S–8.67S` in the runner. The low end counts the file read (`S`), runner copy (`S`), one-byte base64 (`1.33S`), and one-byte JSON body (`1.33S`). The high end permits two-byte JavaScript strings and an additional UTF-8 request buffer. The temporary binary string creates a separate `~S–2S` spike during base64 conversion, but normally does not overlap the later JSON peak.
- Recommended managed-file path: conservatively `1S–2S` during HTTPS upload when `Bun.file` falls back to user-space reads; the subsequent file-ID completion body is small. Kernel/TLS behavior must be measured on the target machine.
- Base64's exact payload expansion follows the 24-bit to four-character encoding in [RFC 4648 section 4](https://www.rfc-editor.org/rfc/rfc4648.html#section-4): `4 × ceil(S/3)`, about 33.3% before the data-URL prefix and JSON framing.

| PDF size | Workload share | Current inline per job | Recommended upload per job |
| ---: | ---: | ---: | ---: |
| 2 MiB | common (about 90% are at most this size) | 9.3–17.3 MiB | 2–4 MiB |
| 5 MiB | less common | 23.3–43.3 MiB | 5–10 MiB |
| 10 MiB | maximum | 46.7–86.7 MiB | 10–20 MiB |

For the maximum-size case, plausible bounded internal processing concurrency gives:

| Concurrent 10 MiB jobs | Current inline | Recommended upload |
| ---: | ---: | ---: |
| 4 | 187–347 MiB | 40–80 MiB |
| 8 | 373–693 MiB | 80–160 MiB |
| 16 | 747–1,387 MiB | 160–320 MiB |

These figures are hypotheses for the target-machine prototype, not safe concurrency limits. The current page-rendering fallback cannot be expressed as a multiple of input `S`: it retains every PNG and can add a 16 MiB canvas while rendering each page. It must stay outside the normal PDF path. If compatibility requires it, first release each PNG after converting that page and bound fallback concurrency; request batching or result merging should not ship until a prototype proves that it preserves the existing single-result behavior.

## Cleanup, retries, and failure rules

Inbound temporary files must be deleted on every pre-acceptance exit: client abort, malformed multipart input, byte-limit breach, unsupported MIME type, invalid PDF/page count, missing template, durable job rejection, and scheduling failure. Promotion should be atomic and happen only after page count and template validation succeed. Once accepted, keep the existing rules: delete after durable completion, delete after scheduling failure, retain on terminal processing failure, and erase residual files on Workspace deletion ([`backend/CONTEXT.md:360-366`](../../../backend/CONTEXT.md#L360)).

The PRD's failed-Source-file rule requires an idempotent retention sweep to delete terminal-failure files after seven days; the present implementation retains them indefinitely. That sweep is related work, not part of this data-path implementation.

For gateway files, upload once per processing attempt and delete in `finally` after either success, timeout, cancellation, invalid response, or retryable failure. The current adapter already follows this structure, but deletion failure is only logged. Production hardening should make cleanup failure observable and reconcile orphaned managed-file IDs without delaying local job completion. A retry starts with a new upload from the authoritative local Source file.

## Compatibility order and verification gates

1. **Preferred:** LiteLLM managed file ID for the original PDF, after `/model_group/info` confirms PDF support for the active alias and an authenticated disposable-file integration test confirms upload, completion, and delete.
2. **Temporary fallback:** existing inline original-PDF data URL, with a dedicated low concurrency limit. It preserves behavior but has the quantified expansion above.
3. **Last resort:** render pages only for a model confirmed not to accept PDFs. Bound this path separately; do not silently use it after a managed-file configuration error, because that would hide a gateway fault and radically change memory cost.

Before rollout, the target-machine prototype should record resident-set-size deltas at admission, page count, upload, completion, retry, abort, and cleanup for 2/5/10 MiB fixtures at concurrency 1/4/8/16. It should also assert identical prompt text and normalized extraction results between inline-PDF and file-ID requests for the same fixture set.

## Primary sources

- [Bun: file I/O](https://bun.sh/docs/runtime/file-io)
- [Bun: binary data](https://bun.sh/docs/runtime/binary-data)
- [Bun: streams](https://bun.sh/docs/runtime/streams)
- [Bun: fetch](https://bun.sh/docs/runtime/networking/fetch)
- [Bun: file uploads with FormData](https://bun.sh/guides/http/file-uploads)
- [LiteLLM: using PDF input](https://docs.litellm.ai/docs/completion/document_understanding)
- [LiteLLM: managed files](https://docs.litellm.ai/docs/proxy/litellm_managed_files)
- [pdf-lib: `PDFDocument.load` source](https://github.com/Hopding/pdf-lib/blob/master/src/api/PDFDocument.ts)
- [PDF.js input contract](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
- [RFC 4648 section 4](https://www.rfc-editor.org/rfc/rfc4648.html#section-4)
