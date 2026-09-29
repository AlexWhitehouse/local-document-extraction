# Your first extraction

## 1. Connect a model

As a Workspace owner or admin, open **Workspaces → Model gateway → Set up** and enter:

- **Gateway URL:** the address of an OpenAI-compatible service or local model server.
- **Model name:** the model to use.
- **Gateway API key:** the key for that service. This is different from the Workspace API key your own scripts use to call this app.

Pick a model that accepts images. Unless you turn on **Direct PDF input**, PDF pages are sent to the model as images. Only turn on **Direct PDF input** or **Structured output** if your model supports them.

**Test connection** sends a short text message to check the model answers. It doesn't check PDF or image support.

## 2. Choose or create a template

Use the example invoice template, or open **Templates** and create your own. Give each field a name, a description of what to extract, and a data type.

## 3. Upload a document

Open **Documents**, pick the template, and upload a PNG, JPEG, WebP, or PDF file. Files can be up to 10 MiB by default; the app shows the current limit.

## 4. Review the results

Each upload becomes a job that moves from `queued` to `processing`, and then to `completed` or `failed`. Open a completed job to see each extracted field and the evidence behind it. Select several jobs to export them to an Excel workbook.

## Good to know

- Always check important values. AI models can make mistakes.
- Documents and your field instructions are sent to the model gateway you configured. Choose a local model if they must not leave your machine, or a remote provider whose data policy suits you.
- Uploaded files are deleted once a job succeeds. Extracted results stay until you delete them.
- Templates can be edited at any time as your documents change. Existing jobs keep the template version they were run with.
