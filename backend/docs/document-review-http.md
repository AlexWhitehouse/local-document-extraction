# Document review frontend HTTP contract

This is a contributor reference for last-resort review in the Studio frontend. Both mutations require a signed-in user session, accepted Workspace membership selected by `x-workspace-id`, and the normal trusted-Origin checks. Workspace API keys cannot resolve split plans or template choices. API integrations can observe `awaiting_review` and `awaiting_template`, but a user must resolve them in the frontend before processing resumes.

## Correct a held split plan

Read the latest packet, then submit the current `plan_revision` and the complete proposed grouping:

```http
POST /v1/packets/{packet_id}/plan
Content-Type: application/json
Cookie: <signed-in-session-cookie>
x-workspace-id: <workspace_id>
Origin: <trusted-app-origin>

{"revision":1,"groups":[{"pages":[1,2]},{"pages":[4,5]}],"exclusions":[{"page":3,"reason":"Explicitly excluded cover"}]}
```

Every selected page must be present exactly once in a nonempty group or an explicit exclusion. Noncontiguous groups are allowed and remain in original order. Manual exclusions may remove nonblank pages; client `verified_blank` flags are not trusted. Empty plans are permitted only for the independently verified all-blank outcome with the captured blank-removal setting enabled. Duplicate/out-of-scope/missing pages return `400 invalid_packet_plan` or `400 invalid_page_selection`; stale revisions and already accepted plans return `409 packet_plan_conflict`.

A successful response is the accepted packet. Committed groups and child IDs are fixed. Repeating the confirmation does not create additional children. Deleting a child leaves its tombstone, siblings, and packet intact; recovery cannot recreate it.

## Resolve a held template selection

For a job in `awaiting_template`, select any currently usable authorized Template:

```http
POST /v1/jobs/{job_id}/template
Content-Type: application/json
Cookie: <signed-in-session-cookie>
x-workspace-id: <workspace_id>
Origin: <trusted-app-origin>

{"template_id":"tpl_invoice"}
```

This pins its current version and queues extraction of the existing source. A resolved/deleted job or unavailable Template returns a conflict or not-found response; competing resolutions cannot overwrite an accepted binding. Manual resolution may deliberately choose a Template outside the original tag scope.
