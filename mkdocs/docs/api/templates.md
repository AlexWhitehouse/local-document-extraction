# Templates API

```http
GET    /v1/templates                  # list templates
POST   /v1/templates                  # create a template
GET    /v1/templates/{template_id}    # read a template and its fields
PATCH  /v1/templates/{template_id}    # update a template
DELETE /v1/templates/{template_id}    # delete a template
POST   /v1/templates/generate         # propose a template from a sample document
```

Create and update requests are JSON with a `name`, an optional `description`, and `fields`. Every field needs a `name`, a `description`, and a `data_type`.

`POST /v1/templates/generate` takes a sample `document` and optional `instructions` as multipart form data, and returns a proposed template **without saving it**. Review it, then save it with `POST /v1/templates`. It needs the Workspace to have a model set up.

The full request and response formats, limits, and error codes are in the [Templates section](overview.md#templates) of the specification.
