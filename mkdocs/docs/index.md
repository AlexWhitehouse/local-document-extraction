# Document Extraction

Document Extraction turns PDFs and images into structured data. You describe the fields you want in a **template**, upload documents, and the app uses an AI model you choose to fill in those fields. Results can be reviewed in the browser, exported to Excel, or collected by your own scripts through the API.

The app runs on your own computer at `http://127.0.0.1:8787`. Your accounts, templates, and results are stored locally. Documents are sent only to the model gateway each Workspace is set up to use, so extraction stays local too if you choose a local model.

## What you can do

- Create Workspaces and invite other people to them.
- Define templates with typed fields, including one table per template.
- Organize templates with tags and select a suitable template automatically for each document.
- Split PDF packets into logical documents, with optional verified blank-page exclusion.
- Upload PNG, JPEG, WebP, and PDF documents and track their extraction.
- Review results and export them to Excel.
- Compare models and template versions across documents, with a reusable Evaluation library.
- Automate template management, document processing, and result retrieval with a Workspace API key.

## Where to start

- New here? [Start using the app](getting-started/index.md), then run your [first extraction](getting-started/first-extraction.md).
- Writing a script or integration? Go to the [API specification](api/overview.md).
