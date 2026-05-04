import { newId } from "./ids";
import type { StarterTemplateAdapter } from "./workspacePolicy";

export function createStarterInvoiceTemplate(db: D1Database): StarterTemplateAdapter {
  return {
    async createStarterTemplate(input) {
      const templateId = newId("tpl");

      await db.batch([
        db
          .prepare(
            `INSERT INTO templates (id, workspace_id, name, description, status, current_version, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'active', 1, ?, ?)`
          )
          .bind(
            templateId,
            input.workspaceId,
            "Example Invoice",
            "Starter template that extracts key invoice fields for quick testing.",
            input.createdAt,
            input.createdAt
          ),
        db
          .prepare(
            `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, required, position)
             VALUES (?, 1, 'invoice_number', 'Invoice Number', 'Unique invoice identifier.', 'string', 1, 1)`
          )
          .bind(templateId),
        db
          .prepare(
            `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, required, position)
             VALUES (?, 1, 'invoice_date', 'Invoice Date', 'Date shown on the invoice.', 'date', 1, 2)`
          )
          .bind(templateId),
        db
          .prepare(
            `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, required, position)
             VALUES (?, 1, 'vendor_name', 'Vendor Name', 'Name of the supplier issuing the invoice.', 'string', 1, 3)`
          )
          .bind(templateId),
        db
          .prepare(
            `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, required, position)
             VALUES (?, 1, 'total_amount', 'Total Amount', 'Total amount due on the invoice.', 'number', 1, 4)`
          )
          .bind(templateId),
        db
          .prepare(
            `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, required, position)
             VALUES (?, 1, 'currency', 'Currency', 'Currency code used for the totals (e.g. USD).', 'string', 0, 5)`
          )
          .bind(templateId)
      ]);
    }
  };
}
