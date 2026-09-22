# First Extraction

1. Sign in and complete any required account verification. In the default local mode, open the link in the server log or the installer's `mail` command output; no message is delivered to an inbox.
2. Select an accepted Workspace. A new account receives a personal Workspace and starter invoice Template.
3. As a Workspace owner or admin, open **Workspaces → Model gateway → Set up**. Save the gateway base URL, model name, and gateway credential. These are mandatory per Workspace and are separate from its inbound API key.
4. Enable direct PDF input or structured output only if supported by your model. Without direct PDF input, pages are rendered as images; select an image-capable model. The optional connection test sends only a small text prompt and does not certify PDF/image capabilities.
5. Use the starter Template, or open **Templates** and create one with field names, descriptions, and data types.
6. Open **Documents**, select the Template, and upload a PNG, JPEG, WebP, or PDF within the displayed file-size limit (10 MiB by default).
7. Wait for the queued job to reach `completed` or `failed`. Select a completed job to review extracted fields and evidence; select jobs to export an Excel workbook.

Templates are reusable and can be refined as document layouts change.

Document input and extraction instructions are sent to the configured model gateway. Choose a local endpoint for local inference or a remote provider according to your data requirements. Review important extracted values; model output can be incorrect. Completed source binaries are deleted after successful cleanup, while extracted results remain until deleted.
