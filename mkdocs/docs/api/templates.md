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

Create requests are JSON with a `name`, optional `description` and `tags`, and `fields`. Update requests supply only the properties to change. Every field needs a `name`, a `description`, and a `data_type`.

`tags` is an array of tag names, for example `["invoice", "finance"]`. Saving creates any unknown tags in the Workspace and replaces the template's associations. Omit `tags` on update to keep existing associations, or send `[]` to clear them. Names are lowercased, trimmed, deduplicated, and have repeated whitespace collapsed; nonempty names may use spaces and punctuation, but cannot contain control characters. Use at most 50 names, each no longer than 64 characters after normalization. Template reads include sorted `tags`; tag-only updates do not create a field version.

The shared [tag management endpoints](overview.md#manage-template-tags) list, rename, and delete tags across the Workspace. Removing a tag from one template does not delete the shared tag.

`POST /v1/templates/generate` takes a sample `document` and optional `instructions` as multipart form data, and returns a proposed template **without saving it**. Review it, then save it with `POST /v1/templates`. It needs the Workspace to have a model set up.

The full request and response formats, limits, and error codes are in the [Templates section](overview.md#templates) of the specification.
