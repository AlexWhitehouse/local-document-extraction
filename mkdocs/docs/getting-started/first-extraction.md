# Your first extraction

## 1. Connect a model

As a Workspace owner or admin, open **Workspaces → Model gateway → Set up**. Enter these values:

- **Gateway URL:** The address of an OpenAI-compatible service or local model server.
- **Model name:** The model to use.
- **Gateway API key:** The service credential. This differs from the Workspace API key that scripts use to access this app.

Select a model that accepts images. Without **Direct PDF input**, the app sends PDF pages as images. Enable **Direct PDF input** or **Structured output** only if the model supports them.

Select **Test connection** to verify that the model replies to a short text message. This test does not verify PDF or image support.

## 2. Choose or create a template

Use the example invoice template or create one on **Templates**. Give each field a name, extraction instructions, and a data type.

## 3. Upload a document

1. Open **Documents**.
2. Select the template.
3. Upload a PNG, JPEG, WebP, or PDF file.

The default file limit is 10 MiB. The app shows the current limit.

## 4. Review the results

By default, each upload creates a job. Its state changes from `queued` to `processing`, then to `completed` or `failed`. Open a completed document to inspect extracted fields and evidence. Select multiple documents to export an Excel workbook.

For automatic template selection, add tags and useful descriptions to templates. Then select **Automatic — select by tags** in the upload modal.

Owners and admins can enable **Smart splitting** below **Model gateway** on the Workspace page. Splitting identifies separate documents within PDFs. A PDF resolved as one document opens directly in its results. Multiple documents appear in a packet. See [Document extraction](../usage/document-extraction.md) for the full procedure.

## Good to know

- Verify important values. AI models can make errors.
- The app sends documents and field instructions to the configured model gateway. Select a local model if the data must remain on your machine. For remote processing, select a provider with a suitable data policy.
- Originals remain available if retention was enabled for the upload. Otherwise, the app removes successful working files. Sources needed for split or template review remain until resolution. Extracted results remain until deletion.
- You can edit templates as documents change. Existing jobs retain their original template version.
