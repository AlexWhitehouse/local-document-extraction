ALTER TABLE workspace_billing_stripe_events
  RENAME TO workspace_billing_stripe_events_old;

CREATE TABLE workspace_billing_stripe_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_status TEXT NOT NULL CHECK (processed_status IN ('processed', 'ignored', 'failed')),
  workspace_id TEXT,
  related_stripe_object_id TEXT,
  error_details TEXT
);

INSERT INTO workspace_billing_stripe_events (
  event_id,
  type,
  received_at,
  processed_status,
  workspace_id,
  related_stripe_object_id,
  error_details
)
SELECT event_id,
       type,
       received_at,
       processed_status,
       workspace_id,
       related_stripe_object_id,
       error_details
FROM workspace_billing_stripe_events_old;

DROP TABLE workspace_billing_stripe_events_old;

CREATE INDEX IF NOT EXISTS idx_workspace_billing_stripe_events_workspace_time
  ON workspace_billing_stripe_events(workspace_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_billing_stripe_events_related_object
  ON workspace_billing_stripe_events(workspace_id, related_stripe_object_id, received_at DESC);
