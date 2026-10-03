# Document Extraction

Document Extraction converts PDFs and images to structured data. Define the required fields in a **template**, then upload documents. Your selected AI model extracts the field values. Review results in the browser, export them to Excel, or retrieve them through the API.

The app runs on your computer at `http://127.0.0.1:8787`. It stores accounts, templates, and results locally. It sends documents only to the Workspace’s configured model gateway. Select a local model to keep extraction local.

## What you can do

- Create Workspaces and invite members.
- Define templates with typed fields and at most one table per template.
- Organize templates with tags and select templates automatically for each document.
- Split PDFs into logical documents and optionally exclude verified blank pages.
- Upload PNG, JPEG, WebP, and PDF documents and monitor extraction.
- Review results and export them to Excel.
- Compare models and template versions in the browser with a reusable Evaluation library.
- Automate template management, document processing, and result retrieval with a Workspace API key.

## Where to start

- To use the app, read [Start using the app](getting-started/index.md), then run [your first extraction](getting-started/first-extraction.md).
- To write a script or integration, use the [API specification](api/overview.md).
