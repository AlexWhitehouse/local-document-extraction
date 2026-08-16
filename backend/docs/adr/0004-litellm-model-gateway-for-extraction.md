# LiteLLM Model Gateway For Extraction

The local extraction runner calls one OpenAI-compatible model gateway endpoint. The default endpoint is `https://litellm.t3m.uk` and the default model is `claude-opus-4-7`. Signed-in local users may override the endpoint, model, and optional bearer token through the Model settings UI.

## Consequences

- `MODEL_GATEWAY_URL`, `LITELLM_KEY`, `AI_MODEL`, `MODEL_GATEWAY_ROUTE_LABEL`, `MODEL_GATEWAY_REQUEST_TIMEOUT_MS`, and `EXTRACTION_RETRY_DELAY_MS` configure model access and retry timing locally.
- UI model settings persist in the local state directory, take precedence over endpoint/model/token environment defaults, and are resolved for each extraction attempt without a restart.
- The bearer token is returned to the UI only as a configured/not-configured flag and the local settings file uses owner-only permissions.
- The runner keeps model invocation separate from persisted Extraction job lifecycle changes.
- Retryable gateway errors are retried within the runner's bounded retry policy after the configured durable retry delay.
- Completed jobs retain the model name and route label as operational metadata.
- Image Source files and compatibility-mode PDFs use the existing inline OpenAI-compatible request contract.
- A verified PDF-capable model alias may opt into LiteLLM managed-file upload with `MODEL_GATEWAY_USE_MANAGED_FILES`; the runner passes a lazy local `Blob`, submits the returned file ID, and deletes the remote file in `finally`.
- Managed-file upload remains disabled for aliases whose gateway capability has not been verified; configuration failures do not silently switch to page rendering.
