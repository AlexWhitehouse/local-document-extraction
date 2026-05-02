System Shape
The repo is a Cloudflare Worker API plus a Vite/React SPA.
Runtime components:

- backend/src/index.ts: single Worker router for /api/auth/_, /v1/_, queue consumer, and workflow export.
- Cloudflare bindings in backend/wrangler.jsonc: D1 DB, R2 IMAGES_BUCKET, Queue JOBS_QUEUE, Workflow IMAGE_PROCESSING_WORKFLOW, Workers AI AI, static asset binding ASSETS.
- frontend/src/App.jsx: SPA client for auth, workspace management, template management, document upload, polling, retry, and deletion.
- Better Auth handles /api/auth/\* and stores users/sessions/accounts in D1.
- D1 stores application data: workspaces, memberships, invitations, templates, template fields, jobs, and job results.
- R2 stores uploaded source files temporarily.
- Queue starts async processing.
- Workflow performs durable multi-step extraction and persistence.
  All explicit backend errors are returned as:
  {
  "error": {
  "code": "some_code",
  "message": "Human-readable message"
  }
  }
  Unexpected errors become:
  {
  "error": {
  "code": "internal_error",
  "message": "Unexpected server error"
  }
  }

---

**Top-Level Request Routing**
The Worker request path is evaluated in this order:

1. `/api/auth/*`
   Routed to Better Auth via `createAuth(env, request).handler(request)`.
2. `GET /v1/health`
   Public health check.
3. Session-only user/workspace/profile routes
   These call `requireSession()`, meaning a Better Auth session cookie is required.
4. Static frontend asset serving
   `GET` or `HEAD` requests that are not `/v1/*` are served from `env.ASSETS`.
5. Workspace-scoped API routes
   These call `authenticate()`, which accepts either workspace API key auth or Better Auth session plus `x-workspace-id`.
6. Unknown routes
   Return `404 not_found`.

---

Auth Model
There are two application auth modes.
Session auth:

- Used by the frontend.
- Better Auth stores session cookies.
- Required for profile, workspace lifecycle, invitations, workspace user management, and any workspace-scoped API call when no API key is supplied.
- For workspace-scoped routes, session auth must include x-workspace-id.
  API key auth:
- Used by external API clients.
- Sent as Authorization: Bearer <workspace-api-key>.
- API key is SHA-256 hashed and compared with workspaces.api_key_hash.
- API key auth identifies the workspace directly.
- API key auth does not identify a user.
- API key auth is accepted for templates, extraction, jobs, retry, and delete job.
- API key auth is not accepted for workspace management routes because those are routed earlier through requireSession().
  Auth precedence in authenticate():

1. Try API key first.
2. If a valid API key exists, use that workspace and skip session auth.
3. Otherwise require Better Auth session.
4. Read x-workspace-id.
5. Verify the session user is a member of that workspace.
6. Return { workspace, auth_mode, user_id }.
   Important frontend behavior:

- frontend/src/App.jsx prefers API key auth if apiKey is present.
- If no API key is present but a session exists, it sends x-workspace-id.
- All fetches use credentials: "include" so Better Auth cookies are sent.

---

Better Auth Setup
backend/src/lib/betterAuth.ts configures Better Auth with:

- appName: "imageextraction"
- D1 as database
- baseURL from BETTER_AUTH_URL or current request origin
- secret from BETTER_AUTH_SECRET or local fallback
- trusted origins from BETTER_AUTH_TRUSTED_ORIGINS plus local dev origins
- email/password enabled
- optional Google OAuth if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured
- database hook on user create
  On user creation, bootstrapUserWorkspace() runs.
  It creates:
- One workspace.
- One owner membership for the new user.
- One starter template named Example Invoice.
- Five starter fields:
  - invoice_number
  - invoice_date
  - vendor_name
  - total_amount
  - currency
    The bootstrap workspace gets an API key hash, but the plaintext API key is not exposed through the Better Auth response. A user can later create another workspace or rotate the API key to receive a visible key.

---

Auth Happy Path: Email Sign Up
Frontend call:
authClient.signUp.email({
name: "Alex",
email: "alex@example.com",
password: "correct-horse-battery"
})
Likely HTTP request to Better Auth:
POST /api/auth/sign-up/email
Content-Type: application/json
{
"name": "Alex",
"email": "alex@example.com",
"password": "correct-horse-battery"
}
Backend flow:

1. Worker sees /api/auth/\*.
2. Better Auth validates request.
3. Better Auth creates user, account, and session rows.
4. Better Auth user create hook fires.
5. bootstrapUserWorkspace() checks if the user already has a membership.
6. If none exists, it inserts workspace, owner membership, starter template, and starter fields.
7. Better Auth sets session cookie.
8. Frontend calls refetchSession().
9. Frontend calls:
   - GET /v1/workspaces
   - GET /v1/profile
   - Then template/job loading after workspace context exists.
     Session response shape is Better Auth controlled, but the frontend expects:
     {
     "user": {
     "id": "user\_...",
     "name": "Alex",
     "email": "alex@example.com"
     }
     }
     Unhappy paths:

- Missing name/email/password: frontend blocks before request.
- Duplicate email: Better Auth returns an auth error.
- Invalid origin: Better Auth may reject due to trusted origin checks.
- Hook/database failure: sign-up can fail or become a partial auth error depending on Better Auth behavior.
- If bootstrap sees an existing membership, it no-ops and does not create another workspace.

---

Auth Happy Path: Email Sign In
Frontend call:
authClient.signIn.email({
email: "alex@example.com",
password: "correct-horse-battery"
})
Likely HTTP request:
POST /api/auth/sign-in/email
Content-Type: application/json
{
"email": "alex@example.com",
"password": "correct-horse-battery"
}
Backend flow:

1. Worker delegates /api/auth/\* to Better Auth.
2. Better Auth validates credentials.
3. Better Auth creates or refreshes session.
4. Session cookie is returned.
5. Frontend refetches session.
6. Frontend loads workspaces and profile.
   Unhappy paths:

- Bad credentials: Better Auth error.
- Missing credentials: frontend blocks.
- Expired/invalid session on later /v1/\* call: backend returns 401 unauthorized.
  Example unauthorized response:
  HTTP/1.1 401 Unauthorized
  Content-Type: application/json
  {
  "error": {
  "code": "unauthorized",
  "message": "Authentication required"
  }
  }

---

Auth Happy Path: Google Sign In
Frontend call:
authClient.signIn.social({
provider: "google",
callbackURL: window.location.origin
})
Backend prerequisites:

- GOOGLE_CLIENT_ID configured.
- GOOGLE_CLIENT_SECRET configured as secret.
- Google callback URI includes /api/auth/callback/google.
  Flow:

1. Frontend asks Better Auth to start Google OAuth.
2. User is redirected to Google.
3. Google redirects back to Better Auth callback.
4. Better Auth creates/links user and account.
5. Better Auth creates session.
6. User create hook bootstraps workspace/template if it is a new user.
   Unhappy paths:

- Google provider omitted because secret is missing: social sign-in fails.
- Redirect URI not configured in Google console: Google rejects.
- User cancels consent: Better Auth returns social auth error.

---

Profile Flow
Session only.
Get profile:
GET /v1/profile
Cookie: better-auth.session_token=...
Backend flow:

1. requireSession() validates Better Auth session.
2. Query user table by session user ID.
3. Return normalized profile.
   Response:
   {
   "id": "user_123",
   "name": "Alex",
   "email": "alex@example.com",
   "email_verified": false,
   "created_at": "2026-05-02T10:00:00.000Z",
   "updated_at": "2026-05-02T10:00:00.000Z"
   }
   Update profile:
   PATCH /v1/profile
   Content-Type: application/json
   Cookie: better-auth.session_token=...
   {
   "name": "Alex Whitehouse",
   "email": "alex@example.com"
   }
   Unhappy paths:

- No session: 401 unauthorized.
- Empty patch: 400 empty_patch.
- Invalid name: 400 invalid_name.
- Invalid email: 400 invalid_email.
- Email already used: 409 email_in_use.
- User row missing: 404 not_found.

---

Workspace Data Model
Workspace tables:

- workspaces
  - id
  - api_key_hash
  - name
  - created_at
  - created_by_user_id
  - optional limits: rate_limit_per_minute, max_templates, max_fields_per_template, max_image_bytes
- workspace_memberships
  - workspace_id
  - user_id
  - role: owner, admin, or member
  - created_at
- workspace_invitations
  - id
  - workspace_id
  - email
  - role: admin or member
  - status: pending, accepted, cancelled, expired
  - inviter and accepter user IDs
  - timestamps and expiry
    Workspace authorization rules:
- Owner:
  - Can update workspace.
  - Can delete workspace unless it is their only workspace.
  - Can invite users.
  - Can list users.
  - Can remove non-owner users.
  - Can make users admin.
  - Can transfer ownership.
  - Can rotate API key.
- Admin:
  - Can update workspace.
  - Can invite users.
  - Can list users.
  - Can remove member users only.
  - Can rotate API key.
- Member:
  - Can access workspace-scoped core API.
  - Cannot update workspace settings, invite users, manage users, delete workspace, or rotate API key.

---

Workspace Create Happy Path
Request:
POST /v1/workspaces
Content-Type: application/json
Cookie: better-auth.session_token=...
{
"name": "Claims Processing",
"max_image_bytes": 10485760
}
Backend flow:

1. Router matches POST /v1/workspaces.
2. requireSession() validates session.
3. Body is parsed as JSON.
4. name is validated if supplied.
5. max_image_bytes is validated if supplied.
6. Generate:
   - workspace\_<uuid>
   - key\_<uuid>
7. Hash API key with SHA-256.
8. Insert workspaces.
9. Insert owner workspace_memberships.
10. Return workspace metadata and plaintext API key once.
    Response:
    HTTP/1.1 201 Created
    {
    "workspace_id": "workspace_abc123",
    "api_key": "key_secretplaintext",
    "name": "Claims Processing",
    "role": "owner",
    "created_at": "2026-05-02T10:00:00.000Z",
    "max_image_bytes": 10485760
    }
    Unhappy paths:

- No session: 401 unauthorized.
- Invalid JSON: 400 invalid_json.
- Empty name: 400 invalid_name.
- Non-positive or non-integer max_image_bytes: 400 invalid_max_image_bytes.
- D1 insert failure: 500 internal_error.

---

List Workspaces Happy Path
Request:
GET /v1/workspaces
Cookie: better-auth.session_token=...
Backend flow:

1. Validate session.
2. Query workspaces joined through memberships for the user.
3. Order by newest workspace first.
   Response:
   {
   "workspaces": [
   {
   "id": "workspace_abc123",
   "name": "Claims Processing",
   "created_at": "2026-05-02T10:00:00.000Z",
   "max_image_bytes": 10485760,
   "role": "owner"
   }
   ]
   }

---

Update Workspace Happy Path
Request:
PATCH /v1/workspaces/workspace_abc123
Content-Type: application/json
Cookie: better-auth.session_token=...
{
"name": "Claims Processing Production"
}
Backend flow:

1. Validate session.
2. Read workspace ID from path.
3. Check membership role.
4. Require owner/admin.
5. Validate new name.
6. Update workspace name.
7. Return updated workspace ID/name.
   Response:
   {
   "workspace_id": "workspace_abc123",
   "name": "Claims Processing Production"
   }
   Unhappy paths:

- No session: 401 unauthorized.
- Not a member: 403 forbidden.
- Member role: 403 forbidden.
- Empty name: 400 invalid_name.

---

Delete Workspace Happy Path
Request:
DELETE /v1/workspaces/workspace_abc123
Cookie: better-auth.session_token=...
Backend flow:

1. Validate session.
2. Check membership.
3. Require owner.
4. Count how many workspaces the user belongs to.
5. If count is greater than 1, delete workspace.
6. Cascading foreign keys remove memberships/invitations where configured.
   Response:
   {
   "ok": true,
   "workspace_id": "workspace_abc123"
   }
   Unhappy paths:

- Not member: 403 forbidden.
- Not owner: 403 forbidden.
- User only has one workspace: 409 last_workspace.

---

Workspace API Key Rotation
Request:
POST /v1/workspaces/workspace_abc123/api-key
Cookie: better-auth.session_token=...
Backend flow:

1. Validate session.
2. Check membership.
3. Require owner/admin.
4. Generate new plaintext key.
5. Hash key with SHA-256.
6. Replace workspaces.api_key_hash.
7. Return plaintext key once.
   Response:
   {
   "workspace_id": "workspace_abc123",
   "api_key": "key_newplaintext",
   "rotated_at": "2026-05-02T10:05:00.000Z"
   }
   Unhappy paths:

- Not owner/admin: 403 forbidden.
- Old API key immediately stops working because only one hash is stored.

---

Workspace Invitations
Create invitation:
POST /v1/workspaces/workspace_abc123/invitations
Content-Type: application/json
Cookie: better-auth.session_token=...
{
"email": "teammate@example.com",
"role": "member"
}
Backend flow:

1. Validate inviter session.
2. Check inviter membership.
3. Require owner/admin.
4. Validate email.
5. Role defaults to member unless valid admin or member.
6. Check no existing pending invite for same workspace/email.
7. Create invitation expiring in 7 days.
8. Return invitation.
   Response:
   HTTP/1.1 201 Created
   {
   "invitation_id": "invite_abc123",
   "workspace_id": "workspace_abc123",
   "email": "teammate@example.com",
   "role": "member",
   "status": "pending",
   "expires_at": "2026-05-09T10:00:00.000Z"
   }
   List invitations for current user:
   GET /v1/invitations
   Cookie: better-auth.session_token=...
   Response:
   {
   "invitations": [
   {
   "id": "invite_abc123",
   "workspace_id": "workspace_abc123",
   "workspace_name": "Claims Processing",
   "email": "teammate@example.com",
   "role": "member",
   "status": "pending",
   "created_at": "2026-05-02T10:00:00.000Z",
   "expires_at": "2026-05-09T10:00:00.000Z"
   }
   ]
   }
   Accept invitation:
   POST /v1/invitations/invite_abc123/accept
   Cookie: better-auth.session_token=...
   Backend flow:
9. Validate session.
10. Load invitation.
11. Require status = pending.
12. Require invitation email equals session user email.
13. If expired, mark expired and return 410 invite_expired.
14. Insert or update membership with invited role.
15. Mark invitation accepted.
16. Return workspace and role.
    Response:
    {
    "ok": true,
    "workspace_id": "workspace_abc123",
    "role": "member"
    }
    Unhappy paths:

- Existing pending invite: 409 invite_exists.
- Invitation not found or no longer pending: 404 not_found.
- Different email: 403 forbidden.
- Expired invitation: 410 invite_expired.

---

Workspace User Management
List workspace users:
GET /v1/workspaces/workspace_abc123/users
Cookie: better-auth.session_token=...
Response:
{
"users": [
{
"user_id": "user_owner",
"name": "Alex",
"email": "alex@example.com",
"role": "owner",
"created_at": "2026-05-02T10:00:00.000Z"
},
{
"user_id": "user_member",
"name": "Taylor",
"email": "taylor@example.com",
"role": "member",
"created_at": "2026-05-02T10:10:00.000Z"
}
]
}
Apply action:
POST /v1/workspaces/workspace_abc123/users/user_member
Content-Type: application/json
Cookie: better-auth.session_token=...
{
"action": "make_admin"
}
Supported actions:

- remove_user
- make_admin
- make_owner
  Owner transfer flow:

1. Existing owner is demoted to admin.
2. Target user is promoted to owner.
3. workspaces.created_by_user_id is set to target user.
   Unhappy paths:

- Actor not member: 403 forbidden.
- Actor member role: 403 forbidden.
- Admin trying to promote/transfer: 403 forbidden.
- Admin trying to remove owner/admin: 403 forbidden.
- Target not member: 404 not_found.
- Invalid action: 400 invalid_action.
- Removing owner directly: 409 owner_transfer_required.

---

Workspace-Scoped API Auth Examples
Session workspace-scoped request:
GET /v1/templates
Cookie: better-auth.session_token=...
x-workspace-id: workspace_abc123
API key workspace-scoped request:
GET /v1/templates
Authorization: Bearer key_secretplaintext
Missing workspace header with session auth:
GET /v1/templates
Cookie: better-auth.session_token=...
Response:
HTTP/1.1 400 Bad Request
{
"error": {
"code": "missing_workspace",
"message": "Missing workspace context (x-workspace-id header)"
}
}
Session user not in workspace:
HTTP/1.1 403 Forbidden
{
"error": {
"code": "forbidden",
"message": "You do not have access to this workspace"
}
}
Invalid API key:
HTTP/1.1 401 Unauthorized
{
"error": {
"code": "unauthorized",
"message": "Invalid API key"
}
}

---

Template Data Model
Tables:

- templates
  - id
  - workspace_id
  - name
  - description
  - status: active, archived, deleted
  - current_version
  - timestamps
  - deleted_at
- template_fields
  - template_id
  - version
  - field_id
  - name
  - description
  - data_type
  - required
  - position
    Template versioning behavior:
- Creating a template creates version 1.
- Updating only name/description keeps the same version.
- Updating fields increments current_version.
- New fields are inserted for the new version.
- Old field versions remain for historical jobs.
- Jobs store template_id and template_version, so job result rendering uses the version active at upload time.
- Delete is soft delete: status = deleted, deleted_at set.
  Allowed field data types:
  string
  number
  boolean
  date
  object
  array
  array<object>
  Field normalization:
- Field name is sanitized to letters, numbers, and spaces.
- Field ID is generated from name, lowercased with spaces converted to underscores.
- Duplicate field IDs or names are rejected.
- Each template must have 1 to 50 fields.
- Each field needs name, description, valid data type.
- Object/table metadata can be embedded in descriptions using special markers.

---

Template Create Happy Path
Request:
POST /v1/templates
Authorization: Bearer key_secretplaintext
Content-Type: application/json
{
"name": "Invoice Extraction",
"description": "Extract standard invoice details",
"fields": [
{
"name": "Invoice Number",
"description": "Unique invoice identifier",
"data_type": "string",
"required": true
},
{
"name": "Total Amount",
"description": "Total amount due",
"data_type": "number",
"required": true
},
{
"name": "Invoice Date",
"description": "Date shown on the invoice",
"data_type": "date",
"required": false
}
]
}
Backend flow:

1. Authenticate workspace.
2. Parse JSON.
3. Validate template payload.
4. Generate tpl\_<uuid>.
5. Insert template with current_version = 1.
6. Insert each field with position index.
7. Return template ID and version.
   Response:
   HTTP/1.1 201 Created
   {
   "template_id": "tpl_abc123",
   "version": 1,
   "status": "active"
   }
   Unhappy paths:

- Invalid JSON: 400 invalid_json.
- Missing name: 400 invalid_name.
- Missing fields: 400 invalid_fields.
- Empty fields array: 400 invalid_fields.
- More than 50 fields: 400 invalid_fields.
- Missing field name: 400 invalid_fields.
- Missing field description: 400 invalid_fields.
- Unsupported data type: 400 invalid_fields.
- Duplicate field ID/name: 400 invalid_fields.

---

Template List Happy Path
Request:
GET /v1/templates
Authorization: Bearer key_secretplaintext
Response:
{
"templates": [
{
"id": "tpl_abc123",
"name": "Invoice Extraction",
"description": "Extract standard invoice details",
"status": "active",
"current_version": 1,
"created_at": "2026-05-02T10:00:00.000Z",
"updated_at": "2026-05-02T10:00:00.000Z"
}
]
}
Only non-deleted templates in the authenticated workspace are returned.

---

Template Get Happy Path
Request:
GET /v1/templates/tpl_abc123
Authorization: Bearer key_secretplaintext
Response:
{
"id": "tpl_abc123",
"name": "Invoice Extraction",
"description": "Extract standard invoice details",
"status": "active",
"current_version": 1,
"created_at": "2026-05-02T10:00:00.000Z",
"updated_at": "2026-05-02T10:00:00.000Z",
"fields": [
{
"id": "invoice_number",
"name": "Invoice Number",
"description": "Unique invoice identifier",
"data_type": "string",
"required": true,
"position": 0
}
]
}
Unhappy path:
{
"error": {
"code": "not_found",
"message": "Template not found"
}
}

---

Template Update Happy Path
Request with field change:
PATCH /v1/templates/tpl_abc123
Authorization: Bearer key_secretplaintext
Content-Type: application/json
{
"name": "Invoice Extraction v2",
"description": "Extract invoice header and totals",
"fields": [
{
"name": "Invoice Number",
"description": "Unique invoice identifier",
"data_type": "string",
"required": true
},
{
"name": "Currency",
"description": "Currency code used for invoice totals",
"data_type": "string",
"required": false
}
]
}
Backend flow:

1. Authenticate workspace.
2. Load existing non-deleted template in workspace.
3. Validate patch.
4. Because fields is present, increment version from 1 to 2.
5. Update template metadata/current version.
6. Insert new versioned field rows.
7. Return new version.
   Response:
   {
   "template_id": "tpl_abc123",
   "version": 2,
   "status": "active"
   }
   Request without field change:
   {
   "name": "Invoice Extraction Renamed"
   }
   In that case, current_version does not increment.
   Unhappy paths:

- Empty patch: 400 empty_patch.
- Template missing/deleted/wrong workspace: 404 not_found.
- Same validation errors as create for any supplied fields.

---

Template Delete Happy Path
Request:
DELETE /v1/templates/tpl_abc123
Authorization: Bearer key_secretplaintext
Backend flow:

1. Authenticate workspace.
2. Update matching non-deleted template:
   - status = deleted
   - deleted_at = now
   - updated_at = now
3. Return no body.
   Response:
   HTTP/1.1 204 No Content
   Unhappy path:

- Missing/wrong workspace/already deleted: 404 not_found.

---

Document Upload and Extraction: Happy Path
This is the core async flow.
Client upload request:
POST /v1/extract
Authorization: Bearer key_secretplaintext
Content-Type: multipart/form-data; boundary=...
--boundary
Content-Disposition: form-data; name="template_id"
tpl_abc123
--boundary
Content-Disposition: form-data; name="image"; filename="invoice.pdf"
Content-Type: application/pdf
<binary>
--boundary
Content-Disposition: form-data; name="options"
{"include_confidence":true,"include_evidence":true}
--boundary--
The file part can be named:

- image
- file
- document
  Allowed MIME types:
- image/png
- image/jpeg
- image/webp
- application/pdf
  Default max file size:
- Workspace-specific workspaces.max_image_bytes, if present.
- Otherwise MAX_IMAGE_BYTES.
- Otherwise 10 _ 1024 _ 1024.
  Backend upload flow in createExtractionJob():

1. Authenticate workspace.
2. Validate request is multipart/form-data.
3. Reject inline fields; extraction must use a saved template.
4. Validate template_id.
5. Validate uploaded file exists.
6. Validate MIME type.
7. Validate file size.
8. Parse optional options JSON.
9. Load template by template_id and workspace.
10. Require template exists, is active, and not deleted.
11. Read template current_version.
12. Verify that version has at least one field.
13. Generate job\_<uuid>.
14. Determine extension from MIME:

- PNG -> .png
- JPEG -> .jpg
- WEBP -> .webp
- PDF -> .pdf

15. Build R2 key:
    workspaces/{workspace_id}/jobs/{job_id}/source.{ext}
16. Read uploaded file bytes.
17. Put source bytes in R2 with content type metadata.
18. Insert D1 job row:

- status = queued
- workspace_id
- template_id
- template_version
- image_r2_key
- image_mime_type
- image_name
- timestamps

19. If DB insert fails, delete the R2 object to avoid orphaned source file.
20. Send queue message:
    {
    "job_id": "job_abc123",
    "attempt": 1,
    "workspace_id": "workspace_abc123",
    "template_id": "tpl_abc123",
    "template_version": 2,
    "image_r2_key": "workspaces/workspace_abc123/jobs/job_abc123/source.pdf",
    "enqueued_at": "2026-05-02T10:00:00.000Z"
    }
21. Return 202 Accepted.
    Response:
    HTTP/1.1 202 Accepted
    {
    "job_id": "job_abc123",
    "status": "queued",
    "image_name": "invoice.pdf",
    "template_id": "tpl_abc123",
    "template_version": 2
    }
    Frontend behavior after upload:
22. Adds optimistic queued document state.
23. Stores local preview URL for images.
24. Selects the queued document.
25. Polls GET /v1/jobs/:id every second when selected status is queued/processing.
26. Manual extraction flow polls up to 30 times with 2 second delay.

---

Document Upload Unhappy Paths
Invalid content type:
HTTP/1.1 415 Unsupported Media Type
{
"error": {
"code": "unsupported_media_type",
"message": "Use multipart/form-data"
}
}
Inline fields supplied:
{
"error": {
"code": "inline_fields_forbidden",
"message": "Inline fields are not allowed"
}
}
Missing template:
{
"error": {
"code": "invalid_template_id",
"message": "template_id is required"
}
}
Missing file:
{
"error": {
"code": "invalid_image",
"message": "image, file, or document is required"
}
}
Unsupported MIME:
{
"error": {
"code": "invalid_image",
"message": "Unsupported file MIME type: text/plain"
}
}
File too large:
{
"error": {
"code": "image_too_large",
"message": "File exceeds max size of 10485760 bytes"
}
}
Template missing/deleted/inactive:
{
"error": {
"code": "template_not_found",
"message": "Template not found"
}
}
Template has no fields:
{
"error": {
"code": "template_invalid",
"message": "Template has no fields"
}
}
Invalid options:
{
"error": {
"code": "invalid_options",
"message": "options must be valid JSON"
}
}

---

Queue Consumer Flow
Queue handler in backend/src/index.ts receives QueueJobMessage.
Flow:

1. For each queue message, call processJob(msg.body, env).
2. On success, msg.ack().
3. On error, log and msg.retry().
   processJob() flow:
4. Load job by job_id and workspace_id.
5. If no job exists, return successfully. The queue message is acknowledged.
6. Build workflow instance ID:
   {job_id}-attempt-{attempt}
7. Claim queued job:
   UPDATE jobs
   SET status = 'workflow_started',
   updated_at = ?,
   error_code = NULL,
   error_message = NULL,
   workflow_instance_id = ?
   WHERE id = ?
   AND status IN ('queued', 'retryable_failed', 'failed')
8. If no rows changed, another process already claimed or state changed. Return successfully.
9. Create Cloudflare Workflow instance with:
   - job_id
   - workspace_id
   - attempt
10. If workflow creation fails:
    - Mark job retryable_failed.
    - error_code = workflow_start_error.
    - Throw error so queue retries.
      Queue-level unhappy paths:

- Job deleted before queue runs: consumer returns and acks.
- Job already claimed: consumer returns and acks.
- Workflow create fails: job becomes retryable_failed, queue retries according to queue config.

---

Workflow State Machine
Job statuses:
queued
workflow_started
processing
completed
failed
retryable_failed
Typical happy state transition:
queued
-> workflow_started
-> processing
-> completed
Retryable failure transition:
queued
-> workflow_started
-> processing
-> retryable_failed
Permanent failure transition:
queued
-> workflow_started
-> processing
-> failed
Manual retry transition:
failed|retryable_failed
-> queued
-> workflow_started
-> processing
-> completed|failed|retryable_failed

---

**Image Processing Workflow Happy Path**
`ImageProcessingWorkflow.run()` uses Cloudflare Workflows steps.
Workflow steps:

1. `load job`
   - Load `template_id`, `template_version`, `image_r2_key`, `image_mime_type`.
   - If missing, stop.
2. `claim job`
   - Set:
     - `status = processing`
     - `workflow_started_at = now`
     - `current_attempt = attempt`
     - clear errors
   - Only succeeds when status is `queued` or `workflow_started` and `current_attempt < attempt`.
   - If not claimed, stop.
3. `load template fields`
   - Load fields for the exact `template_id` and `template_version`.
   - Order by `position`.
4. `read source from r2`
   - Get object from `IMAGES_BUCKET` using `image_r2_key`.
   - If missing, throw `missing_image`.
5. `extract and persist`
   - Call `runExtraction()`.
   - Normalize model results against template fields.
   - Upsert `job_results`.
   - Mark job `completed`.
   - Store:
     - `model_name = google/gemini-3-flash`
     - `ai_gateway_route = AI_GATEWAY_ROUTE || "default"`
     - `prompt_version = v1`
     - `schema_version = v1`
     - `completed_attempt = attempt`
6. `cleanup source file`
   - Delete R2 object.
   - Set `image_deleted_at`.
   - If cleanup fails, log only; job remains completed.

---

AI Extraction Flow
runExtraction() flow:

1. Use model:
   google/gemini-3-flash
2. Read gateway ID:
   AI_GATEWAY_ID || "default"
3. Build system prompt:
   You extract fields from document content. Use only source data, do not guess, return JSON only, and use status=not_found with answer=null when missing.
4. Build user prompt containing:
   - Extraction instruction.
   - Source guidance based on MIME/model.
   - Required JSON shape.
   - Serialized template fields.
     Expected model JSON shape:
     {
     "results": [
     {
     "field_id": "invoice_number",
     "status": "ok",
     "answer": "INV-1001",
     "confidence": 0.94,
     "evidence": "Invoice No: INV-1001"
     }
     ]
     }
5. For Google models, send the original image/PDF bytes as inline data:
   {
   "systemInstruction": {
   "parts": [
   {
   "text": "You extract fields from document content..."
   }
   ]
   },
   "contents": [
   {
   "role": "user",
   "parts": [
   {
   "text": "Extract all fields below..."
   },
   {
   "inlineData": {
   "mimeType": "application/pdf",
   "data": "<base64>"
   }
   }
   ]
   }
   ],
   "generationConfig": {
   "responseMimeType": "application/json"
   }
   }
6. Call:
   env.AI.run(model, input, {
   gateway: { id: gatewayId }
   })
7. Extract readable text from multiple possible provider response shapes.
8. Parse JSON.
9. Require results array.
10. Return raw field results.
    PDF note:

- There is code to convert PDFs to markdown for non-Google models using env.AI.toMarkdown().
- Current hardcoded model starts with google/, so PDFs are sent directly as inline data.

---

Result Normalization
The model may return missing, malformed, or extra fields. The backend normalizes results using the template field list as the source of truth.
Normalization flow:

1. Build map of raw model results by field_id.
2. For each template field, produce exactly one normalized result.
3. If model omitted a field, emit:
   - status = not_found
   - answer = null
4. Normalize status:
   - Allowed: ok, not_found, invalid_type, unreadable
   - Anything else becomes error
5. Validate/coerce answer by template data type:
   - string: must be string.
   - number: number or numeric string after stripping non-numeric characters.
   - boolean: boolean or string true, yes, false, no.
   - date: string parseable by Date.
   - object: non-array object.
   - array: array.
   - array<object>: array of objects, or object containing valid rows.
6. If type validation fails, result status becomes invalid_type.
7. Store:
   - answer_json
   - normalized_value
   - confidence
   - evidence_text
     Example stored/returned result:
     {
     "field_id": "total_amount",
     "name": "Total Amount",
     "data_type": "number",
     "status": "ok",
     "answer": 1234.56,
     "confidence": 0.91,
     "evidence": "Total Due $1,234.56"
     }

---

Workflow Unhappy Paths
Missing job:

- Workflow returns without changing anything.
  Could not claim job:
- Workflow returns.
- This prevents duplicate processing.
  Missing R2 source:
- Error message is missing_image.
- Workflow catches it as non-retryable.
- Job is marked:
  {
  "status": "failed",
  "error_code": "missing_image",
  "error_message": "Source image is missing from R2"
  }
  AI call failure:
- env.AI.run() failure becomes RetryableError.
- Job is marked:
  {
  "status": "retryable_failed",
  "error_code": "ai_gateway_error",
  "error_message": "AI.run failed: ..."
  }
  Invalid model JSON:
- Becomes RetryableError.
- Job is marked retryable_failed.
- Workflow rethrows so Cloudflare Workflow can retry according to step config.
  Model JSON missing results:
- Becomes RetryableError.
- Job is marked retryable_failed.
  PDF markdown conversion failure for non-Google models:
- Throws normal error.
- Job becomes failed with processing_error.
  Unexpected processing error:
  {
  "status": "failed",
  "error_code": "processing_error",
  "error_message": "..."
  }
  Cleanup failure:
- Logged only.
- Job remains completed.
- R2 source may remain orphaned.

---

Job Polling: Queued/Processing Response
Request:
GET /v1/jobs/job_abc123
Authorization: Bearer key_secretplaintext
If not completed:
{
"job_id": "job_abc123",
"status": "processing",
"image_name": "invoice.pdf",
"template_id": "tpl_abc123",
"template_version": 2,
"error_code": null,
"error_message": null,
"created_at": "2026-05-02T10:00:00.000Z",
"updated_at": "2026-05-02T10:00:03.000Z",
"completed_at": null,
"current_attempt": 1,
"completed_attempt": 0,
"last_failed_attempt": 0
}
If failed:
{
"job_id": "job_abc123",
"status": "retryable_failed",
"image_name": "invoice.pdf",
"template_id": "tpl_abc123",
"template_version": 2,
"error_code": "ai_gateway_error",
"error_message": "AI.run failed: rate limited",
"created_at": "2026-05-02T10:00:00.000Z",
"updated_at": "2026-05-02T10:00:12.000Z",
"completed_at": null,
"current_attempt": 1,
"completed_attempt": 0,
"last_failed_attempt": 1
}
Unhappy path:

- Missing or wrong workspace job: 404 not_found.

---

Job Results: Completed Response
Request:
GET /v1/jobs/job_abc123
Authorization: Bearer key_secretplaintext
Response:
{
"job_id": "job_abc123",
"status": "completed",
"image_name": "invoice.pdf",
"template_id": "tpl_abc123",
"template_version": 2,
"created_at": "2026-05-02T10:00:00.000Z",
"updated_at": "2026-05-02T10:00:15.000Z",
"completed_at": "2026-05-02T10:00:15.000Z",
"current_attempt": 1,
"completed_attempt": 1,
"last_failed_attempt": 0,
"results": [
{
"field_id": "invoice_number",
"name": "Invoice Number",
"data_type": "string",
"status": "ok",
"answer": "INV-1001",
"confidence": 0.94,
"evidence": "Invoice No: INV-1001"
},
{
"field_id": "total_amount",
"name": "Total Amount",
"data_type": "number",
"status": "ok",
"answer": 1234.56,
"confidence": 0.91,
"evidence": "Total Due $1,234.56"
},
{
"field_id": "currency",
"name": "Currency",
"data_type": "string",
"status": "not_found",
"answer": null,
"confidence": null,
"evidence": null
}
]
}
Backend result query:

- Loads job by ID/workspace.
- If completed, joins job_results to template_fields by stored template_id and template_version.
- Orders by field position.
- Parses answer_json safely.
- Returns result array.

---

List Jobs Flow
Request:
GET /v1/jobs
Authorization: Bearer key_secretplaintext
Response:
{
"jobs": [
{
"job_id": "job_abc123",
"status": "completed",
"image_name": "invoice.pdf",
"template_id": "tpl_abc123",
"template_version": 2,
"error_code": null,
"error_message": null,
"created_at": "2026-05-02T10:00:00.000Z",
"updated_at": "2026-05-02T10:00:15.000Z",
"completed_at": "2026-05-02T10:00:15.000Z",
"current_attempt": 1,
"completed_attempt": 1,
"last_failed_attempt": 0,
"results": [...]
}
]
}
Notes:

- Ordered by latest updated_at or created_at.
- Does not include full results; use GET /v1/jobs/:id.

---

Retry Job Flow
Request:
POST /v1/jobs/job_abc123/retry
Authorization: Bearer key_secretplaintext
Backend flow:

1. Authenticate workspace.
2. Load job.
3. Require image_r2_key exists.
4. Require status is failed or retryable_failed.
5. Compute nextAttempt = current_attempt + 1.
6. Update job:
   - status = queued
   - clear completed_at
   - clear error fields
7. Send queue message using same source R2 key/template/version.
8. Return queued response.
   Response:
   {
   "job_id": "job_abc123",
   "status": "queued",
   "current_attempt": 2
   }
   Unhappy paths:

- Job missing: 404 not_found.
- Source file already deleted: 400 retry_not_allowed.
- Status is not failed/retryable_failed: 409 retry_not_allowed.
- Race condition changing state during retry: 409 retry_not_allowed.
  Important behavior:
- Successful completed jobs usually have their R2 source deleted.
- Retrying completed jobs is not allowed.
- Retrying failed jobs only works if the source file still exists.

---

Delete Job Flow
Request:
DELETE /v1/jobs/job_abc123
Authorization: Bearer key_secretplaintext
Backend flow:

1. Authenticate workspace.
2. Load job and R2 key.
3. Delete job_results.
4. Delete jobs.
5. Delete R2 object if image_r2_key exists.
6. Return no content.
   Response:
   HTTP/1.1 204 No Content
   Unhappy path:

- Job missing/wrong workspace: 404 not_found.
  Concurrency note:
- If a job is deleted while queued/processing, queue/workflow may later find no job or fail to claim and stop.
- If workflow already loaded job before deletion, later writes could fail or have no effect depending on timing.

---

End-to-End Happy Path for General System Use
Process graph sequence:

1. User opens SPA.
2. SPA creates Better Auth client using /api/auth.
3. SPA checks session.
4. If no session, user signs up or signs in.
5. Better Auth creates/loads session.
6. On first user creation, backend bootstraps default workspace and starter invoice template.
7. SPA loads profile.
8. SPA loads workspaces.
9. SPA selects a workspace.
10. SPA loads templates using either session plus x-workspace-id or API key.
11. User creates or edits a template.
12. Backend validates template and stores versioned fields.
13. User uploads document against a selected template.
14. Backend validates upload and template.
15. Backend stores source file in R2.
16. Backend creates D1 job with queued.
17. Backend sends queue message.
18. Frontend receives 202 and starts polling.
19. Queue consumer claims job as workflow_started.
20. Queue consumer creates workflow instance.
21. Workflow claims job as processing.
22. Workflow loads template fields for stored version.
23. Workflow reads source from R2.
24. Workflow calls Workers AI/Gemini through AI Gateway.
25. Workflow parses and normalizes model results.
26. Workflow upserts job_results.
27. Workflow marks job completed.
28. Workflow deletes source from R2 and records image_deleted_at.
29. Frontend polling sees completed.
30. Frontend renders extracted fields.

---

End-to-End Unhappy Path Examples
No auth:

1. Client calls GET /v1/templates without API key or session.
2. API key auth returns null.
3. requireSession() fails.
4. Response is 401 unauthorized.
   Session but no workspace header:
5. Client signs in.
6. Client calls GET /v1/templates without x-workspace-id.
7. Session is valid.
8. Workspace ID is missing.
9. Response is 400 missing_workspace.
   Session user not member:
10. Client sends valid session and x-workspace-id for another workspace.
11. Membership query returns no row.
12. Response is 403 forbidden.
    Invalid upload:
13. Client uploads text/plain.
14. Multipart parses successfully.
15. MIME validation fails.
16. No R2 write occurs.
17. No job row is created.
18. No queue message is sent.
19. Response is 400 invalid_image.
    DB failure after R2 upload:
20. File validates.
21. R2 put() succeeds.
22. D1 job insert fails.
23. Backend deletes the R2 object.
24. Error propagates as 500 internal_error.
25. No queue message is sent.
    Queue duplicate/race:
26. Queue message is delivered twice.
27. First consumer changes queued to workflow_started.
28. Second consumer update affects 0 rows.
29. Second consumer returns and acks.
30. Only one workflow should process.
    AI transient failure:
31. Workflow reaches AI call.
32. env.AI.run() throws.
33. Code wraps as RetryableError.
34. Workflow marks job retryable_failed.
35. Workflow rethrows.
36. Cloudflare Workflow may retry the step.
37. User can manually retry if source file still exists.
    AI invalid JSON:
38. Model responds with non-JSON text.
39. JSON parse fails.
40. Job becomes retryable_failed with ai_gateway_error.
41. User sees error in job polling.
42. Retry is allowed if source remains in R2.
    Missing source file:
43. Workflow tries to read R2 object.
44. Object is missing.
45. Workflow marks job failed.
46. Error code is missing_image.
47. Manual retry is not possible if source file is gone.
    Completed cleanup failure:
48. Results are persisted.
49. Job is marked completed.
50. R2 delete throws.
51. Error is logged.
52. Job remains completed.
53. Source may remain in R2.

---

Frontend Operational Flow
Frontend state model:

- Auth state comes from Better Auth useSession().
- Workspace state is persisted in localStorage key imageextraction.workspace.v1.
- API base defaults to /v1.
- Auth base defaults to /api/auth.
- Workspace access is considered available when either:
  - API key is present, or
  - session exists and workspace ID exists.
    Frontend request helper behavior:

1. Builds URL as ${apiBase}${path}.
2. If auth required:
   - If API key exists, sets Authorization: Bearer ....
   - Else if session exists and workspace is required, sets x-workspace-id.
   - Else throws client-side error.
3. Sends credentials: include.
4. Parses JSON/text.
5. Throws Error with backend error message on non-2xx.
6. Stores successful response in latestResponse.
   Document upload UI flow:
7. User chooses template.
8. User adds one or more files.
9. For each file:
   - Create preview URL if image.
   - Build FormData.
   - Append template_id.
   - Append file as image.
   - Append options JSON.
   - Call POST /v1/extract.
   - Add queued job to local state.
10. Documents page shows queued item.
11. Polling updates state until terminal status.
