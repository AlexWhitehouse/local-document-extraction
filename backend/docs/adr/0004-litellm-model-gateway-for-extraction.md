# OpenAI-Compatible Model Gateway For Extraction

The extraction runner uses an OpenAI-compatible chat-completions transport,
separate from durable Extraction job lifecycle management. Gateway transient
errors follow the runner's bounded retry policy and durable retry schedule.

The global endpoint/model defaults, profile Model settings, plaintext settings
file, environment fallback, and managed-file upload decisions from this ADR are
superseded by [ADR-0008](0008-workspace-owned-model-configuration.md). They must
not be reintroduced as compatibility paths.

Image Source files and PDFs use inline content; PDFs without declared native
support are rendered as images. Jobs retain bounded operational model metadata,
not gateway credentials or document request payloads.
