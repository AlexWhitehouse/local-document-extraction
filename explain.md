# Prompt 1: Full Process Sequence Diagram

Use the following prompt with an AI diagramming agent:

```text
Create a clear sequence diagram for the full end-to-end process of this app.

The app is an image/document extraction system built from:
- A React/Vite frontend SPA.
- A Cloudflare Worker backend API.
- Better Auth for user authentication under /api/auth/*.
- D1 for users, sessions, workspaces, templates, jobs, and results.
- R2 for temporary uploaded source files.
- Cloudflare Queue for async job dispatch.
- Cloudflare Workflow for durable document processing.
- Workers AI using google/gemini-3-flash through AI Gateway for extraction.

Show these participants:
- User
- Frontend SPA
- Better Auth
- Cloudflare Worker API
- D1 Database
- R2 Bucket
- Jobs Queue
- Image Processing Workflow
- Workers AI / Gemini

Diagram the full happy path:
1. User opens the SPA.
2. SPA checks the Better Auth session.
3. If no session exists, user signs up or signs in.
4. Better Auth creates or validates the user session.
5. On first user creation, the backend bootstraps a workspace, owner membership, starter template, and starter fields in D1.
6. SPA loads the user profile from GET /v1/profile.
7. SPA loads workspaces from GET /v1/workspaces.
8. SPA selects a workspace.
9. SPA loads templates from GET /v1/templates using either Authorization: Bearer <api-key> or session cookie plus x-workspace-id.
10. User creates or edits a template.
11. Worker validates and stores the template and versioned fields in D1.
12. User uploads a document to POST /v1/extract with multipart/form-data, template_id, file, and options.
13. Worker authenticates the workspace.
14. Worker validates content type, file type, file size, template_id, template status, and template fields.
15. Worker stores the uploaded source file in R2.
16. Worker creates a D1 job with status queued.
17. Worker sends a message to the Jobs Queue.
18. Worker returns 202 Accepted with job_id and queued status.
19. SPA adds the queued job locally and starts polling GET /v1/jobs/:id.
20. Queue consumer receives the message.
21. Queue consumer claims the job by changing status from queued to workflow_started.
22. Queue consumer starts a Cloudflare Workflow instance.
23. Workflow claims the job by changing status to processing.
24. Workflow loads the exact template version fields from D1.
25. Workflow reads the uploaded source file from R2.
26. Workflow sends the document bytes and extraction prompt to Workers AI / Gemini.
27. Gemini returns JSON extraction results.
28. Workflow parses the JSON.
29. Workflow normalizes results against the template fields.
30. Workflow upserts job_results in D1.
31. Workflow marks the job completed in D1.
32. Workflow deletes the source file from R2 and records image_deleted_at.
33. SPA polling sees the completed job.
34. SPA renders extracted fields to the user.

Also show key alternate branches in the sequence diagram:
- API key auth is tried before session auth for workspace-scoped API calls.
- Session auth for workspace-scoped routes requires x-workspace-id and membership verification.
- If the D1 job insert fails after R2 upload, the Worker deletes the R2 object and returns an internal error.
- If the queue message is duplicated, only the first consumer claims the job; later consumers acknowledge and stop.
- If Workers AI fails or returns invalid JSON, the workflow marks the job retryable_failed and rethrows for retry handling.
- If the R2 source file is missing, the workflow marks the job failed with missing_image.
- If cleanup fails after successful processing, the job remains completed and the cleanup error is only logged.

Use Mermaid sequenceDiagram syntax unless another format is requested. Keep the diagram readable by grouping auth, template setup, upload, queue dispatch, workflow processing, and polling/result rendering into logical sections.
```

# Prompt 2: Full App Flow Chart With Happy And Unhappy Paths

Use the following prompt with an AI diagramming agent:

```text
Create a full application flow chart for this image/document extraction app. Include all major processes, decision points, happy paths, and unhappy paths.

The app has these main areas:
- Authentication and session handling.
- Workspace creation, selection, invitations, user management, deletion, and API key rotation.
- Template creation, listing, reading, updating, versioning, and soft deletion.
- Document upload and extraction job creation.
- Queue dispatch and workflow processing.
- AI extraction and result normalization.
- Job polling, completed results, retry, and deletion.
- Frontend state and request behavior.

Use these core components:
- React/Vite frontend SPA.
- Cloudflare Worker API.
- Better Auth at /api/auth/*.
- D1 database.
- R2 bucket.
- Cloudflare Queue.
- Cloudflare Workflow.
- Workers AI / Gemini through AI Gateway.

Include this top-level routing logic:
1. /api/auth/* goes to Better Auth.
2. GET /v1/health is public.
3. Session-only routes use requireSession().
4. GET or HEAD requests outside /v1/* serve frontend assets.
5. Workspace-scoped /v1 routes use authenticate().
6. Unknown routes return 404 not_found.

Include auth flow decisions:
- Frontend uses Better Auth sessions for normal UI usage.
- External clients can use Authorization: Bearer <workspace-api-key>.
- authenticate() tries API key auth first.
- If API key is valid, workspace is identified directly and session auth is skipped.
- If no valid API key exists, a Better Auth session is required.
- Session workspace calls require x-workspace-id.
- The backend verifies the session user is a member of that workspace.
- Missing auth returns 401 unauthorized.
- Missing workspace header returns 400 missing_workspace.
- Non-member workspace access returns 403 forbidden.

Include signup/signin flow:
- Email signup or Google sign-in creates or links a Better Auth user.
- Better Auth creates a session.
- On new user creation, the backend creates one default workspace, owner membership, starter invoice template, and starter fields.
- Frontend then loads profile, workspaces, templates, and jobs.
- Unhappy paths: missing credentials, duplicate email, invalid origin, bad credentials, Google OAuth misconfiguration, user cancels Google consent, bootstrap/database failure.

Include workspace management flow:
- List workspaces.
- Create workspace and return plaintext API key once.
- Update workspace name or limits if actor is owner/admin.
- Delete workspace only if actor is owner and it is not their only workspace.
- Rotate API key if actor is owner/admin; old key stops working.
- Invite users if actor is owner/admin.
- Accept invitation only when pending, not expired, and email matches the signed-in user.
- Manage users: remove users, make admin, transfer ownership.
- Unhappy paths: no session, not a member, insufficient role, invalid input, duplicate invite, expired invite, target user missing, trying to remove owner directly, trying to delete the last workspace.

Include template flow:
- Create template with name, description, and 1 to 50 fields.
- Validate field names, descriptions, data types, required flags, and duplicates.
- Store template as version 1.
- List only non-deleted templates in the authenticated workspace.
- Get one template with fields for current_version.
- Update metadata without changing version.
- Update fields by incrementing current_version and inserting new versioned field rows.
- Soft-delete templates by setting status=deleted and deleted_at.
- Unhappy paths: invalid JSON, missing name, invalid fields, unsupported data type, duplicate field name/id, template not found, deleted template, wrong workspace, empty patch.

Include document upload and job creation flow:
- Client sends POST /v1/extract as multipart/form-data.
- Required template_id must refer to a saved active template.
- File field may be named image, file, or document.
- Allowed MIME types: image/png, image/jpeg, image/webp, application/pdf.
- File size limit comes from workspace max_image_bytes, then MAX_IMAGE_BYTES, then default 10 MB.
- Worker validates request, template, fields, file type, file size, and options JSON.
- Worker writes source file to R2.
- Worker inserts D1 job with status queued.
- Worker sends queue message.
- Worker returns 202 Accepted with job_id.
- Frontend adds queued item, optionally creates local preview, selects it, and polls GET /v1/jobs/:id.
- Unhappy paths: unsupported media type, inline fields supplied, missing template_id, missing file, unsupported MIME type, file too large, inactive/deleted/missing template, template with no fields, invalid options JSON, D1 insert failure after R2 upload, queue send failure.

Include queue and workflow flow:
- Queue consumer receives job message.
- It loads the job.
- If job is missing, it acknowledges and stops.
- It claims only queued/retryable_failed/failed jobs by setting status workflow_started.
- If claim affects zero rows, another process already claimed it, so it acknowledges and stops.
- It creates a Workflow instance.
- If workflow creation fails, job becomes retryable_failed and the queue retries.
- Workflow loads job, claims it as processing, loads template fields, reads source from R2, calls Workers AI, normalizes results, stores job_results, marks job completed, and deletes the R2 source.
- Happy status path: queued -> workflow_started -> processing -> completed.
- Retryable failure path: queued -> workflow_started -> processing -> retryable_failed.
- Permanent failure path: queued -> workflow_started -> processing -> failed.
- Manual retry path: failed or retryable_failed -> queued -> workflow_started -> processing -> completed, failed, or retryable_failed.

Include AI extraction and normalization flow:
- Workflow sends a strict extraction prompt and document bytes to google/gemini-3-flash.
- Model should return JSON with results containing field_id, status, answer, confidence, and evidence.
- Backend parses JSON and requires a results array.
- Backend uses the template fields as the source of truth.
- Backend emits exactly one result per template field.
- Missing model fields become status not_found and answer null.
- Status is normalized to ok, not_found, invalid_type, unreadable, or error.
- Answers are validated or coerced based on field data type: string, number, boolean, date, object, array, array<object>.
- Invalid values become invalid_type.
- Extra model fields are ignored.
- Stored results include answer_json, normalized_value, confidence, and evidence_text.
- Unhappy paths: AI call failure, invalid JSON, missing results array, type validation failure, missing R2 source, unexpected processing error, cleanup failure after completion.

Include job lifecycle flow:
- GET /v1/jobs lists jobs for the authenticated workspace.
- GET /v1/jobs/:id returns queued/processing/failed metadata while not completed.
- Completed jobs include normalized results joined to the saved template version fields.
- POST /v1/jobs/:id/retry is allowed only for failed or retryable_failed jobs when the source file still exists.
- DELETE /v1/jobs/:id deletes job_results, job row, and source R2 object if present.
- Unhappy paths: job not found or wrong workspace, retry requested for completed/processing job, retry source already deleted, race condition during retry, deleting a job while queue/workflow is still running.

Include frontend behavior:
- Auth state comes from Better Auth useSession().
- Workspace selection is persisted in localStorage key imageextraction.workspace.v1.
- API base defaults to /v1.
- Auth base defaults to /api/auth.
- Frontend prefers API key auth when an API key is present.
- Otherwise, if a session and workspace are present, it sends x-workspace-id.
- All fetches send credentials: include.
- On non-2xx responses, frontend shows the backend error message.
- Upload UI builds FormData with template_id, file, and options, then polls until terminal status.

Use Mermaid flowchart syntax unless another format is requested. Organize the output into subgraphs for Auth, Workspace, Templates, Upload, Queue, Workflow, AI Normalization, Jobs, and Frontend State. Use decision diamonds for validation and authorization checks. Label unhappy branches with HTTP status and error code where known.
```
