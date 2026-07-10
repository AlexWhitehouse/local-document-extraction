# Document Extraction

Document extraction is asynchronous. Select a Template, submit a supported Source file, and receive a queued job ID. The local runner persists results before it marks a job `completed`.

Supported MIME types are `image/png`, `image/jpeg`, `image/webp`, and `application/pdf`. Source files are kept only while processing needs them and removed after successful cleanup.

Job states are `queued`, `processing`, `completed`, and `failed`. The browser receives lifecycle updates and revalidates job data; API clients poll job detail.
