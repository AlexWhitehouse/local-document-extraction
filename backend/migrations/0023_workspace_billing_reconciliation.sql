CREATE TABLE IF NOT EXISTS workspace_billing_reconciliation_status (
  workspace_id TEXT PRIMARY KEY,
  last_checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_billing_reconciliation_drift (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  drift_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('needs_review', 'warning')),
  actionability TEXT NOT NULL CHECK (actionability IN ('manual_review', 'informational')),
  related_stripe_object_id TEXT,
  observed_json TEXT NOT NULL,
  expected_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_billing_reconciliation_drift_workspace_status
  ON workspace_billing_reconciliation_drift(workspace_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_billing_stripe_events_related_object
  ON workspace_billing_stripe_events(workspace_id, related_stripe_object_id, received_at DESC);
