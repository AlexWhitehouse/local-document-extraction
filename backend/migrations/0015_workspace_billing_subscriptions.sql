ALTER TABLE workspace_billing_controls
  ADD COLUMN stripe_subscription_id TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN self_service_subscription_plan TEXT CHECK (self_service_subscription_plan IN ('pro', 'max') OR self_service_subscription_plan IS NULL);

ALTER TABLE workspace_billing_controls
  ADD COLUMN self_service_subscription_status TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN stripe_subscription_current_period_start TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN stripe_subscription_current_period_end TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_billing_controls_stripe_subscription
  ON workspace_billing_controls(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
