# OpenAI-Compatible Model Gateway For Extraction

The extraction runner uses an OpenAI-compatible chat-completions transport. Durable Extraction job lifecycle management remains separate. Temporary gateway errors use the runner's bounded retry policy and durable schedule.

[ADR-0008](0008-workspace-owned-model-configuration.md) replaces the global endpoint and model defaults from this decision. It also replaces profile Model settings, the plaintext settings file, environment fallback, and managed-file uploads. Do not restore these features as compatibility options.

The runner sends image Source files and PDFs as inline content. If the model does not declare native PDF support, the runner renders PDF pages as images. Jobs keep bounded operational model metadata. They do not keep gateway credentials or document request payloads.
