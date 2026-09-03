// Fictional, in-memory fixtures. No runtime state, accounts, or credentials are read.
export const VARIANTS = [
  { id: "A1", page: "workspace", name: "Open settings", idea: "A single canvas. Sections and spacing replace the card stack." },
  { id: "B2", page: "templates", name: "Split editor", idea: "A simple field outline beside a spacious, unboxed editor." },
  { id: "C1", page: "documents", name: "Results ledger", idea: "Compare extracted values and evidence in a single table." },
];

export const WORKSPACES = [
  { id: "ws_finance_01", name: "Finance operations", connected: true },
  { id: "ws_procurement_02", name: "Procurement", connected: true },
  { id: "ws_sandbox_03", name: "Development", connected: true },
];

export const MEMBERS = [
  { name: "Alex Morgan", email: "alex@example.com", role: "Owner", initials: "AM" },
  { name: "Sam Chen", email: "sam@example.com", role: "Admin", initials: "SC" },
  { name: "Jordan Ellis", email: "jordan@example.com", role: "Member", initials: "JE" },
];

export const FIELDS = [
  { id: "supplier", name: "Supplier name", type: "string", description: "The legal name of the company issuing the invoice.", value: "Harbour & Co.", confidence: 99.8, evidence: "Harbour & Co. — Design & research studio", page: 1 },
  { id: "invoice_number", name: "Invoice number", type: "string", description: "The unique invoice reference, preserving any prefix.", value: "INV-2026-0842", confidence: 99.6, evidence: "INVOICE / INV-2026-0842", page: 1 },
  { id: "invoice_date", name: "Invoice date", type: "date", description: "The date the invoice was issued, in YYYY-MM-DD format.", value: "2026-09-01", confidence: 99.4, evidence: "Date issued: 01 September 2026", page: 1 },
  { id: "due_date", name: "Due date", type: "date", description: "The payment due date. Return null if it is not specified.", value: "2026-09-30", confidence: 86.2, evidence: "Payment terms: payment by the end of September.", page: 2 },
  { id: "total_amount", name: "Total amount", type: "number", description: "The final invoice total, including tax. Return the numeric value.", value: "3,420.00", confidence: 99.9, evidence: "TOTAL DUE GBP 3,420.00", page: 1 },
  { id: "currency", name: "Currency", type: "string", description: "The ISO 4217 currency code used on the invoice.", value: "GBP", confidence: 99.9, evidence: "All amounts in GBP", page: 1 },
  { id: "line_items", name: "Line items", type: "array<object>", description: "Each invoice item with description, quantity, unit price and amount.", value: "3 items", confidence: 98.7, evidence: "Services supplied in August 2026", page: 1 },
];

export const TEMPLATES = [
  { id: "tpl_invoice_01", name: "Supplier invoice", description: "Extract invoice details, totals and line items from supplier documents.", fields: FIELDS },
  { id: "tpl_credit_02", name: "Credit note", description: "Capture supplier credit references and amounts.", fields: FIELDS.filter(f => ["supplier", "invoice_number", "invoice_date", "total_amount", "currency"].includes(f.id)) },
  { id: "tpl_receipt_03", name: "Expense receipt", description: "Extract merchant, date and total from expense receipts.", fields: FIELDS.filter(f => ["supplier", "invoice_date", "total_amount", "currency"].includes(f.id)) },
  { id: "tpl_statement_04", name: "Account statement", description: "Read account balances and transaction details.", fields: FIELDS.filter(f => ["supplier", "invoice_date", "currency", "line_items"].includes(f.id)) },
];

export const DOCUMENTS = [
  ["Harbour_invoice_0842.pdf", "Harbour & Co.", "INV-2026-0842", "3,420.00"],
  ["Northstar_invoice_0198.pdf", "Northstar Studio", "INV-2026-0198", "1,260.00"],
  ["August_services.pdf", "Fieldwork Partners", "FW-2026-0081", "2,880.00"],
  ["Supplier_invoice_0214.pdf", "Common Ground", "CG-0214", "720.00"],
  ["September_invoice.pdf", "Low Tide Design", "LT-2026-0901", "4,560.00"],
  ["Office_supplies.pdf", "Paper & Plane", "PP-2026-3261", "180.00"],
  ["Monthly_retainer.pdf", "Harbour & Co.", "INV-2026-0801", "2,400.00"],
].map(([source_name, supplier, invoice, amount], i) => ({
  job_id: `job_20260903_00${i + 1}`, source_name, supplier, invoice, amount,
  status: "completed", model: "studio-extract", created_at: "2026-09-03T09:42:00Z",
}));

export const LINE_ITEMS = [
  { description: "Design consultation", quantity: 2, rate: "450.00", amount: "900.00" },
  { description: "Research & discovery", quantity: 3, rate: "350.00", amount: "1,050.00" },
  { description: "Interface design", quantity: 2, rate: "450.00", amount: "900.00" },
];

export function documentFields(document) {
  return FIELDS.map(field => ({
    ...field,
    value: field.id === "supplier" ? document.supplier : field.id === "invoice_number" ? document.invoice : field.id === "total_amount" ? document.amount : field.value,
    evidence: field.evidence.replace("Harbour & Co.", document.supplier).replace("INV-2026-0842", document.invoice).replace("3,420.00", document.amount),
  }));
}
