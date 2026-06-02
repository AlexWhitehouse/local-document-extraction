ALTER TABLE workspace_billing_controls
  ADD COLUMN stripe_customer_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_billing_controls_stripe_customer
  ON workspace_billing_controls(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
