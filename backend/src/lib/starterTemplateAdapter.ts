import { newId } from "./ids";
import { getWorkspaceProductStore } from "./workspaceProductStoreClient";
import type { StarterTemplateAdapter } from "./workspacePolicy";
import type { FieldDefinition } from "./types";

const STARTER_INVOICE_FIELDS: FieldDefinition[] = [
  {
    id: "invoice_number",
    name: "Invoice Number",
    description: "Unique invoice identifier.",
    data_type: "string",
  },
  {
    id: "invoice_date",
    name: "Invoice Date",
    description: "Date shown on the invoice.",
    data_type: "date",
  },
  {
    id: "vendor_name",
    name: "Vendor Name",
    description: "Name of the supplier issuing the invoice.",
    data_type: "string",
  },
  {
    id: "total_amount",
    name: "Total Amount",
    description: "Total amount due on the invoice.",
    data_type: "number",
  },
  {
    id: "currency",
    name: "Currency",
    description: "Currency code used for the totals (e.g. USD).",
    data_type: "string",
  },
];

const STARTER_INVOICE_NAME = "Example Invoice";
const STARTER_INVOICE_DESCRIPTION = "Starter template that extracts key invoice fields for quick testing.";

export function createWorkspaceProductStarterInvoiceTemplate(env: Pick<Env, "WORKSPACE_PRODUCT_STORE">): StarterTemplateAdapter {
  return {
    async createStarterTemplate(input) {
      await getWorkspaceProductStore(env, input.workspaceId).createTemplate({
        templateId: newId("tpl"),
        name: STARTER_INVOICE_NAME,
        description: STARTER_INVOICE_DESCRIPTION,
        fields: STARTER_INVOICE_FIELDS,
        createdAt: input.createdAt,
      });
    },
  };
}
