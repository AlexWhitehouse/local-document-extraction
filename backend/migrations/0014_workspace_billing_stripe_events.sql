CREATE TABLE IF NOT EXISTS workspace_billing_stripe_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_status TEXT NOT NULL CHECK (processed_status IN ('processed', 'failed')),
  workspace_id TEXT,
  related_stripe_object_id TEXT,
  error_details TEXT
);

CREATE INDEX IF NOT EXISTS idx_workspace_billing_stripe_events_workspace_time
  ON workspace_billing_stripe_events(workspace_id, received_at DESC);
