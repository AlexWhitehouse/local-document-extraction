ALTER TABLE workspace_billing_controls
  ADD COLUMN payment_required_plan_override_plan TEXT CHECK (payment_required_plan_override_plan IN ('free', 'pro', 'max') OR payment_required_plan_override_plan IS NULL);

ALTER TABLE workspace_billing_controls
  ADD COLUMN payment_required_plan_override_start_at TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN payment_required_plan_override_end_at TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN payment_required_plan_override_reason TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN payment_required_plan_override_created_by_user_id TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN payment_required_plan_override_created_at TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN payment_required_plan_override_amount_minor INTEGER;

ALTER TABLE workspace_billing_controls
  ADD COLUMN payment_required_plan_override_currency TEXT CHECK (payment_required_plan_override_currency IN ('GBP') OR payment_required_plan_override_currency IS NULL);

ALTER TABLE workspace_billing_controls
  ADD COLUMN payment_required_plan_override_collection_mode TEXT CHECK (payment_required_plan_override_collection_mode IN ('automatic', 'manual') OR payment_required_plan_override_collection_mode IS NULL);

ALTER TABLE workspace_billing_controls
  ADD COLUMN payment_required_plan_override_invoice_id TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN payment_required_plan_override_invoice_status TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN payment_required_plan_override_hosted_invoice_url TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN payment_required_plan_override_paid_at TEXT;

CREATE TABLE IF NOT EXISTS workspace_billing_admin_audit_log_payment_required_rebuild (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN (
      'goodwill_credit_grant',
      'goodwill_credit_revocation',
      'plan_override_created',
      'no_billing_mode_updated',
      'payment_required_plan_override_created',
      'payment_required_plan_override_payment_updated'
    )
  ),
  actor_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

INSERT INTO workspace_billing_admin_audit_log_payment_required_rebuild (
  id,
  workspace_id,
  action,
  actor_user_id,
  reason,
  before_json,
  after_json,
  occurred_at
)
SELECT
  id,
  workspace_id,
  action,
  actor_user_id,
  reason,
  before_json,
  after_json,
  occurred_at
FROM workspace_billing_admin_audit_log;

DROP TABLE workspace_billing_admin_audit_log;

ALTER TABLE workspace_billing_admin_audit_log_payment_required_rebuild
  RENAME TO workspace_billing_admin_audit_log;

CREATE INDEX IF NOT EXISTS idx_workspace_billing_admin_audit_workspace_time
  ON workspace_billing_admin_audit_log(workspace_id, occurred_at DESC);
