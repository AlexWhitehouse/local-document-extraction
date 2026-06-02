ALTER TABLE workspace_billing_controls
  ADD COLUMN self_service_subscription_invoice_id TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN self_service_subscription_invoice_status TEXT;

ALTER TABLE workspace_billing_controls
  ADD COLUMN self_service_subscription_hosted_invoice_url TEXT;
