# Use bounded PDF file-ID transfer to the Model gateway

Category: enhancement
Status: completed
Labels: completed

## Parent

../PRD.md

## What to build

Teach the Model gateway adapter to upload a lazy local PDF file and submit its managed `file_id`, then delete the remote file in `finally`. Gate this route on verified LiteLLM/model capability. Keep inline PDF base64 under a strict byte/concurrency limit and page rendering under a separate last-resort limit.

## Acceptance criteria

- The managed-file path does not read/base64/JSON-copy the complete PDF in application code.
- Capability/configuration failure cannot silently fall into page rendering.
- Upload, completion, retry, abort, timeout, and delete behavior is observable and tested through the gateway interface.
- Inline and rendered fallbacks have separate bounded capacity and preserve result behavior.
- A disposable authenticated gateway probe or operator check verifies support before enabling the path.

## Blocked by

- Build the durable bounded Extraction work pump.
- Stream and bound multipart Source file admission.

## Resolution

Implemented lazy `Bun.file` handoff, managed upload/file-ID completion, and remote deletion in `finally`, with deterministic/retryable status classification and tests. The opaque active alias remains on the bounded inline compatibility path until an operator verifies gateway support and sets `MODEL_GATEWAY_USE_MANAGED_FILES`; no unverified upload was performed.
