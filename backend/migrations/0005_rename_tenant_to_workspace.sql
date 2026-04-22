ALTER TABLE tenants RENAME TO workspaces;

ALTER TABLE templates RENAME COLUMN tenant_id TO workspace_id;
ALTER TABLE jobs RENAME COLUMN tenant_id TO workspace_id;

ALTER TABLE tenant_memberships RENAME TO workspace_memberships;
ALTER TABLE workspace_memberships RENAME COLUMN tenant_id TO workspace_id;

ALTER TABLE tenant_invitations RENAME TO workspace_invitations;
ALTER TABLE workspace_invitations RENAME COLUMN tenant_id TO workspace_id;

DROP INDEX IF EXISTS idx_tenants_api_key_hash;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_api_key_hash ON workspaces(api_key_hash);

DROP INDEX IF EXISTS idx_templates_tenant_status;
DROP INDEX IF EXISTS idx_templates_tenant_deleted;
CREATE INDEX IF NOT EXISTS idx_templates_workspace_status ON templates(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_templates_workspace_deleted ON templates(workspace_id, deleted_at);

DROP INDEX IF EXISTS idx_jobs_tenant_created;
DROP INDEX IF EXISTS idx_jobs_tenant_status;
CREATE INDEX IF NOT EXISTS idx_jobs_workspace_created ON jobs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_workspace_status ON jobs(workspace_id, status);

DROP INDEX IF EXISTS idx_tenant_memberships_user;
CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user ON workspace_memberships(user_id);

DROP INDEX IF EXISTS idx_tenant_invites_email_status;
DROP INDEX IF EXISTS idx_tenant_invites_tenant_status;
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email_status ON workspace_invitations(email, status);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_status ON workspace_invitations(workspace_id, status);
