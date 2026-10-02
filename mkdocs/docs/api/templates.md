# Templates API

```http
GET    /v1/templates                  # list templates
POST   /v1/templates                  # create a template
GET    /v1/templates/{template_id}    # read a template and its fields
PATCH  /v1/templates/{template_id}    # update a template
DELETE /v1/templates/{template_id}    # delete a template
POST   /v1/templates/generate         # propose a template from a sample document
POST   /v1/templates/assist           # explain or propose focused draft edits
POST   /v1/templates/assist/suggestions # suggest requests for the open draft
GET    /v1/templates/assist/evidence  # page through completed jobs for evidence
GET    /v1/templates/assist/evidence/{job_id} # historical fields and results
```

Create and update requests are JSON with a `name`, an optional `description`, and `fields`. Every field needs a `name`, a `description`, and a `data_type`.

`POST /v1/templates/generate` takes a sample `document` and optional `instructions` as multipart form data, and returns a proposed template **without saving it**. Review it, then save it with `POST /v1/templates`. It needs the Workspace to have a model set up.

`POST /v1/templates/assist` takes a multipart JSON `payload` containing the raw current draft, an explicit request and its revision identity, plus optional job evidence and one sample `document`. It returns structured diagnostics, explanations and focused change groups **without saving or extracting**. Incomplete drafts are accepted for diagnosis. The evidence endpoints read completed jobs in the authenticated Workspace, including historical Template fields after the Template has been deleted.

The full request and response formats, limits, and error codes are in the [Templates section](overview.md#templates) of the specification.
