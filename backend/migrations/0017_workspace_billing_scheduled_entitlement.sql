ALTER TABLE workspace_billing_controls
  ADD COLUMN scheduled_entitlement_plan TEXT CHECK (scheduled_entitlement_plan IN ('free', 'pro', 'max') OR scheduled_entitlement_plan IS NULL);

ALTER TABLE workspace_billing_controls
  ADD COLUMN scheduled_entitlement_effective_at TEXT;
