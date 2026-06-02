ALTER TABLE workspace_billing_controls
  ADD COLUMN enterprise_deal_status TEXT;

CREATE TABLE IF NOT EXISTS workspace_billing_retained_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  ledger_object_name TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  self_service_subscription_status TEXT,
  final_billing_state TEXT NOT NULL,
  retained_reason TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  retained_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_billing_retained_records_workspace_time
  ON workspace_billing_retained_records(workspace_id, retained_at DESC);
