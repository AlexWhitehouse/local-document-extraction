ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_status TEXT CHECK (enterprise_annual_status IN ('pending_payment', 'active', 'suspended', 'expired') OR enterprise_annual_status IS NULL);

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_monthly_minimum_allowance INTEGER;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_per_page_price_minor INTEGER;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_yearly_amount_minor INTEGER;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_collection_mode TEXT CHECK (enterprise_annual_collection_mode IN ('automatic', 'manual') OR enterprise_annual_collection_mode IS NULL);

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_invoice_review_enabled INTEGER NOT NULL DEFAULT 0 CHECK (enterprise_annual_invoice_review_enabled IN (0, 1));

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_reason TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_created_by_user_id TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_created_at TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_upfront_invoice_id TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_upfront_invoice_status TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_upfront_invoice_hosted_url TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_upfront_invoice_paid_at TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_last_overage_invoice_period_start TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_last_overage_invoice_period_end TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_last_overage_invoice_id TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_last_overage_invoice_status TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_last_overage_invoice_hosted_url TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_annual_last_overage_invoiced_at TEXT;

CREATE TABLE IF NOT EXISTS workspace_billing_admin_audit_log_annual_rebuild (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'goodwill_credit_grant',
    'goodwill_credit_revocation',
    'plan_override_created',
    'no_billing_mode_updated',
    'payment_required_plan_override_created',
    'payment_required_plan_override_payment_updated',
    'enterprise_ramp_up_assigned',
    'enterprise_annual_commitment_created'
  )),
  actor_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

INSERT INTO workspace_billing_admin_audit_log_annual_rebuild (
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

ALTER TABLE workspace_billing_admin_audit_log_annual_rebuild
  RENAME TO workspace_billing_admin_audit_log;
