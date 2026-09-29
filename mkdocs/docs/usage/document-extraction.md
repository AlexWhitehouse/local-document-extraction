# Document extraction

Extraction runs in the background. When you upload a document, the app creates a **job** and returns straight away. The job moves through these states:

| State | Meaning |
| --- | --- |
| `queued` | Waiting its turn. A job that failed temporarily and will be retried also goes back to `queued`. |
| `processing` | Being read by the model. |
| `completed` | Finished. Results are saved before a job is marked completed. |
| `failed` | Couldn't be completed. The job shows an error code and message. |

Supported files are PNG, JPEG, WebP, and PDF. The uploaded file is kept only while it's needed: it's deleted once the job succeeds, or after a retention period (seven days by default) if it fails.

The browser updates job status automatically. Scripts using the API check the job instead; see [Extraction jobs](../api/extraction-jobs.md).
