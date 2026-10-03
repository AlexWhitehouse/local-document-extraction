# Templates API

```http
GET    /v1/templates                  # list templates
POST   /v1/templates                  # create a template
GET    /v1/templates/{template_id}    # read a template and its fields
PATCH  /v1/templates/{template_id}    # update a template
DELETE /v1/templates/{template_id}    # delete a template
GET    /v1/template-tags              # list shared tags, including unused tags
PATCH  /v1/template-tags/{tag_id}      # rename a shared tag
DELETE /v1/template-tags/{tag_id}      # delete a shared tag and all associations
POST   /v1/templates/generate         # propose a template from a sample document
```

Create requests use JSON with `name`, `fields`, and optional `description` and `tags`. Update requests supply only changed properties. Each field requires `name`, `description`, and `data_type`.

`tags` is an array of names, such as `["invoice", "finance"]`. Saving creates unknown Workspace tags and replaces the template’s associations. Omit `tags` during an update to preserve associations. Send `[]` to clear them.

The app converts names to lowercase, trims whitespace, collapses repeated whitespace, and removes duplicates. Names must be nonempty and can include spaces and punctuation. Control characters are prohibited. Supply at most 50 names, each with at most 64 characters after normalization. Template reads return sorted `tags`. Tag-only updates do not create field versions.

The [tag management endpoints](overview.md#manage-template-tags) list, rename, and delete shared tags. Removing a template association does not delete the shared tag.

`POST /v1/templates/generate` accepts a sample `document` and optional `instructions` as multipart form data. It requires a configured Workspace model. The response contains an **unsaved** template proposal. Review it, then save it with `POST /v1/templates`.

See [Templates](overview.md#templates) for request and response schemas, limits, and error codes.
