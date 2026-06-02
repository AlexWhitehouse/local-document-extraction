CREATE TABLE IF NOT EXISTS workspace_billing_controls (
  workspace_id TEXT PRIMARY KEY,
  ledger_object_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_billing_admin_audit_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('goodwill_credit_grant', 'goodwill_credit_revocation')),
  actor_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_billing_admin_audit_workspace_time
  ON workspace_billing_admin_audit_log(workspace_id, occurred_at DESC);
