# LiteLLM Model Gateway For Extraction

The local extraction runner calls one operator-managed OpenAI-compatible LiteLLM endpoint. The default endpoint is `https://litellm.t3m.uk` and the default model is `claude-opus-4-7`.

## Consequences

- `MODEL_GATEWAY_URL`, `LITELLM_KEY`, `AI_MODEL`, `MODEL_GATEWAY_ROUTE_LABEL`, and `MODEL_GATEWAY_REQUEST_TIMEOUT_MS` configure model access locally.
- The runner keeps model invocation separate from persisted Extraction job lifecycle changes.
- Retryable gateway errors are retried within the runner's bounded retry policy.
- Completed jobs retain the model name and route label as operational metadata.
- PDF and image Source files use the existing OpenAI-compatible request contract.
