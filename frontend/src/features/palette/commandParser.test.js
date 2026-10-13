import { describe, expect, it } from "vitest";
import { validateCommandInterpretation } from "../../../../shared/documentSearch.ts";
import {
  askLooksLikeQuestion,
  describeFilter,
  interpretLocally,
  lexCommand,
  mergeInterpretations,
  resolveRelativeDate,
} from "./commandParser";

const TODAY = "2026-10-13"; // a Tuesday

const catalog = {
  models: [],
  interpretation: { available: true },
  templates: [
    {
      id: "tpl_invoice",
      name: "Invoice",
      current_version: 3,
      fields: [
        { field_id: "invoice_number", name: "Invoice number", data_type: "string", type: "text" },
        {
          field_id: "vendor",
          name: "Vendor",
          data_type: "string",
          type: "text",
          known_values: ["Acme", "Globex Supplies", "No", "12345"],
        },
        { field_id: "total", name: "Total", data_type: "number", type: "number" },
        { field_id: "issue_date", name: "Issue date", data_type: "date", type: "date" },
        { field_id: "paid", name: "Paid", data_type: "boolean", type: "boolean" },
        { field_id: "billing_address", name: "Billing address", data_type: "string", type: "text" },
        { field_id: "purchase_order", name: "Purchase order", data_type: "string", type: "text" },
        { field_id: "line_items", name: "Line items", data_type: "table", type: null },
      ],
    },
    {
      id: "tpl_receipt",
      name: "Receipt",
      current_version: 1,
      fields: [
        { field_id: "merchant", name: "Merchant", data_type: "string", type: "text", known_values: ["Acme"] },
        { field_id: "total", name: "Total", data_type: "number", type: "number" },
        { field_id: "tax", name: "Tax", data_type: "number", type: "number" },
      ],
    },
    {
      id: "tpl_po",
      name: "Purchase order",
      current_version: 2,
      fields: [
        {
          field_id: "supplier",
          name: "Supplier",
          data_type: "string",
          type: "text",
          known_values: ["Northwind Traders"],
        },
        { field_id: "amount", name: "Amount", data_type: "number", type: "number" },
        { field_id: "order_date", name: "Order date", data_type: "date", type: "date" },
      ],
    },
  ],
};

const workspaces = [
  { id: "ws_1", name: "Operations" },
  { id: "ws_2", name: "Demo" },
];

function run(text, options = {}) {
  const segments = lexCommand(text, catalog, { workspaces });
  const result = interpretLocally(segments, catalog, { today: TODAY, workspaces, ...options });

  // Every local interpretation must pass the shared validator unchanged.
  expect(validateCommandInterpretation(result.interpretation, catalog)).toEqual(result.interpretation);

  return { segments, ...result };
}

function kinds(segments) {
  return segments.flatMap((segment) => (segment.type === "plain" ? [] : [[segment.type, segment.text]]));
}

function condition(templateId, fieldId, op, value, value2) {
  const result = { template_id: templateId, field_id: fieldId, op };

  if (value !== undefined) result.value = value;

  if (value2 !== undefined) result.value2 = value2;

  return result;
}

describe("lexCommand", () => {
  it.each([
    'Find all documents where the invoice number starts with "hnh"',
    "Edit the invoice template to split the billing address into street, town and postcode",
    "  Retry all failed invoices from last week!  ",
    "Export Acme invoices over £1,500.50 as CSV, please",
    "",
    "(receipts) where total>=10",
    'contains "unterminated',
  ])("covers the whole input: %s", (text) => {
    const segments = lexCommand(text, catalog);

    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    let position = 0;

    for (const segment of segments) {
      expect(segment.start).toBe(position);
      expect(segment.end).toBe(position + segment.text.length);
      position = segment.end;
    }

    expect(position).toBe(text.length);
  });

  it("marks the issue's search example", () => {
    expect(kinds(lexCommand('Find all documents where the invoice number starts with "hnh"', catalog))).toEqual([
      ["action", "Find"],
      ["quantity", "all"],
      ["subject", "documents"],
      ["field", "the invoice number"],
      ["condition", 'starts with "hnh"'],
    ]);
  });

  it("treats only the first verb as the action", () => {
    expect(kinds(lexCommand("Find documents and delete them", catalog))).toEqual([
      ["action", "Find"],
      ["subject", "documents"],
    ]);
  });

  it("keeps the rest of an edit as one instruction", () => {
    const text = "Edit the invoice template to split the billing address into street, town and postcode";

    expect(kinds(lexCommand(text, catalog))).toEqual([
      ["action", "Edit"],
      ["template", "the invoice template"],
      ["instruction", "split the billing address into street, town and postcode"],
    ]);

    expect(kinds(lexCommand("Edit invoices: add a due date", catalog))).toEqual([
      ["action", "Edit"],
      ["subject", "invoices"],
      ["instruction", "add a due date"],
    ]);
  });

  it("reads template names and field labels from the catalogue, case-insensitively", () => {
    expect(kinds(lexCommand("show PURCHASE ORDERS where the Order Date is today", catalog))).toEqual([
      ["action", "show"],
      ["subject", "PURCHASE ORDERS"],
      ["field", "the Order Date"],
      ["condition", "is today"],
    ]);
  });

  it("prefers the longest match", () => {
    // "invoice number" beats the Template name "invoice"; "last 7 days" beats the quantity "last 7".
    expect(kinds(lexCommand("invoice number from the last 7 days", catalog))).toEqual([
      ["field", "invoice number"],
      ["date", "from the last 7 days"],
    ]);
  });

  it("only offers searchable fields", () => {
    expect(kinds(lexCommand("invoices with line items", catalog))).toEqual([["subject", "invoices"]]);
  });

  it("marks known values with an optional from", () => {
    expect(kinds(lexCommand("orders from Northwind Traders", catalog))).toEqual([["value", "from Northwind Traders"]]);
  });

  it("ignores known values that are too short or only digits", () => {
    expect(kinds(lexCommand("no 12345", catalog))).toEqual([]);
  });

  it("keeps quoted values inside the condition", () => {
    expect(kinds(lexCommand("vendor is “O'Brien, Smith & Co.” today", catalog))).toEqual([
      ["field", "vendor"],
      ["condition", "is “O'Brien, Smith & Co.”"],
      ["date", "today"],
    ]);
  });

  it("does not read a status as the value of is", () => {
    expect(kinds(lexCommand("documents that is failed", catalog))).toEqual([
      ["subject", "documents"],
      ["status", "failed"],
    ]);
  });

  it("reads statuses, people, roles, formats and pages", () => {
    expect(kinds(lexCommand("needs a template", catalog))).toEqual([["status", "needs a template"]]);
    expect(kinds(lexCommand("Invite sam@example.com as an editor", catalog))).toEqual([
      ["action", "Invite"],
      ["person", "sam@example.com"],
      ["role", "as an editor"],
    ]);
    expect(kinds(lexCommand("export as an excel file", catalog))).toEqual([
      ["action", "export"],
      ["format", "as an excel file"],
    ]);
    expect(kinds(lexCommand("go to connected apps", catalog))).toEqual([
      ["action", "go to"],
      ["page", "connected apps"],
    ]);
  });

  it("reads workspace names from the options", () => {
    expect(kinds(lexCommand("Switch to demo workspace", catalog, { workspaces }))).toEqual([
      ["action", "Switch to"],
      ["workspace", "demo workspace"],
    ]);
    expect(kinds(lexCommand("switch to operations", catalog, { workspaces }))).toEqual([
      ["action", "switch to"],
      ["workspace", "operations"],
    ]);
    // A bare name is only a workspace after "switch".
    expect(kinds(lexCommand("find operations", catalog, { workspaces }))).toEqual([["action", "find"]]);
  });

  it("needs a prefix or a year before May", () => {
    expect(kinds(lexCommand("may", catalog))).toEqual([]);
    expect(kinds(lexCommand("in May", catalog))).toEqual([["date", "in May"]]);
  });

  it("reads a date after a date field as a condition", () => {
    expect(kinds(lexCommand("after 1 March 2026", catalog))).toEqual([["date", "after 1 March 2026"]]);
    expect(kinds(lexCommand("issued after 1 March 2026", catalog))).toEqual([
      ["field", "issued"],
      ["condition", "after 1 March 2026"],
    ]);
  });

  it("works without a catalogue", () => {
    expect(kinds(lexCommand("find failed documents today", null))).toEqual([
      ["action", "find"],
      ["status", "failed"],
      ["subject", "documents"],
      ["date", "today"],
    ]);
  });

  it("is fast enough to run on every keystroke", () => {
    const text =
      'Find all failed invoices from last week where the invoice number starts with "hnh" and total over 500 '.repeat(
        8,
      );

    const started = performance.now();

    for (let round = 0; round < 50; round += 1) interpretLocally(lexCommand(text, catalog), catalog, { today: TODAY });

    expect((performance.now() - started) / 50).toBeLessThan(25);
  });
});

describe("interpretLocally with the issue's examples", () => {
  it("finds documents by a field prefix", () => {
    const { interpretation, complete, resolved, segments } = run(
      'Find all documents where the invoice number starts with "hnh"',
    );

    expect(interpretation).toEqual({
      action: "find_documents",
      args: {},
      filter: { conditions: [condition("tpl_invoice", "invoice_number", "starts_with", "hnh")] },
      unrecognised: [],
      notes: [],
    });
    expect(complete).toBe(true);
    expect(resolved[segments.findIndex((segment) => segment.type === "field")]).toBe("Invoice");
  });

  it("edits a template with an instruction", () => {
    const { interpretation, complete } = run(
      "Edit the invoice template to split the billing address into street, town and postcode",
    );

    expect(interpretation.action).toBe("edit_template");
    expect(interpretation.args).toEqual({
      template_id: "tpl_invoice",
      instruction: "split the billing address into street, town and postcode",
    });
    expect(interpretation.filter).toBeNull();
    expect(complete).toBe(true);
  });

  it("retries failed invoices from last week", () => {
    const { interpretation, complete, resolved } = run("Retry all failed invoices from last week");

    expect(interpretation.action).toBe("retry");
    expect(interpretation.filter).toEqual({
      statuses: ["failed"],
      template_ids: ["tpl_invoice"],
      uploaded_from: "2026-10-05",
      uploaded_to: "2026-10-11",
    });
    expect(complete).toBe(true);
    expect(resolved).toContain("5 Oct – 11 Oct");
  });

  it("exports Acme invoices over 500 as CSV", () => {
    const { interpretation, complete, resolved } = run("Export Acme invoices over 500 as CSV");

    expect(interpretation.action).toBe("export");
    expect(interpretation.args).toEqual({ format: "csv" });
    expect(interpretation.filter).toEqual({
      conditions: [
        condition("tpl_invoice", "vendor", "contains", "Acme"),
        condition("tpl_invoice", "total", "gt", 500),
      ],
    });
    expect(complete).toBe(true);
    expect(resolved.filter(Boolean)).toEqual(["Vendor", "Invoice", "Total", "CSV"]);
  });

  it("reports words it can't use", () => {
    const { interpretation, complete, unused } = run("Find invoices billed to Leeds");

    expect(unused).toEqual(["billed", "Leeds"]);
    expect(complete).toBe(false);
    expect(interpretation.unrecognised).toEqual(["billed", "Leeds"]);
    expect(interpretation.filter).toEqual({ template_ids: ["tpl_invoice"] });
    expect(interpretation.notes).toEqual([{ kind: "unrecognised", text: "Not used: “billed”, “Leeds”." }]);
  });

  it("creates a template from a description", () => {
    const { interpretation, complete } = run(
      "Create a template for delivery notes with delivery date, driver name, items and signed",
    );

    expect(interpretation).toEqual({
      action: "create_template",
      args: { instruction: "delivery notes with delivery date, driver name, items and signed" },
      filter: null,
      unrecognised: [],
      notes: [],
    });
    expect(complete).toBe(true);
  });

  it("invites an editor as a member", () => {
    const { interpretation, resolved } = run("Invite sam@example.com as an editor");

    expect(interpretation.action).toBe("invite");
    expect(interpretation.args).toEqual({ email: "sam@example.com", role: "member" });
    expect(resolved).toContain("Member");
    expect(run("invite ops@example.co.uk as admin").interpretation.args.role).toBe("admin");
  });

  it("goes to a page", () => {
    expect(run("Go to costs").interpretation).toMatchObject({ action: "go_to", args: { page: "costs" } });
    expect(run("go to settings").interpretation.args).toEqual({ page: "workspace" });
    expect(run("open connected apps").interpretation.args).toEqual({ page: "connected_apps" });
    expect(run("Open templates").interpretation.args).toEqual({ page: "templates" });
    expect(run("Open the invoice template").interpretation.args).toEqual({
      page: "templates",
      template_id: "tpl_invoice",
    });
    expect(run("costs").interpretation.action).toBe("go_to");
  });

  it("switches workspace", () => {
    expect(run("Switch to demo workspace").interpretation).toMatchObject({
      action: "switch_workspace",
      args: { workspace: "Demo" },
    });

    // Without a matching workspace the name is passed on as written.
    const segments = lexCommand("Switch to sandbox workspace", catalog);
    const { interpretation, complete } = interpretLocally(segments, catalog, { today: TODAY });

    expect(interpretation.args).toEqual({ workspace: "sandbox" });
    expect(complete).toBe(true);
  });
});

describe("interpretLocally actions and arguments", () => {
  it("finds templates", () => {
    expect(run("find templates").interpretation).toMatchObject({ action: "find_templates", filter: null });
    expect(run("show THE INVOICE template").interpretation).toMatchObject({
      action: "find_templates",
      args: { template_id: "tpl_invoice" },
    });
  });

  it("uploads to a Template and runs evaluations", () => {
    expect(run("Upload receipts").interpretation).toMatchObject({
      action: "upload",
      args: { template_id: "tpl_receipt" },
    });
    expect(run("evaluate the receipt template").interpretation).toMatchObject({
      action: "run_evaluation",
      args: { template_id: "tpl_receipt" },
    });
  });

  it("defaults retry to failed documents", () => {
    expect(run("retry receipts").interpretation.filter).toEqual({
      statuses: ["failed"],
      template_ids: ["tpl_receipt"],
    });
  });

  it("deletes with a limit", () => {
    expect(run("delete the latest 5 receipts").interpretation).toMatchObject({
      action: "delete",
      args: { limit: 5 },
      filter: { template_ids: ["tpl_receipt"] },
    });
  });

  it("reads quantities", () => {
    const latest = run("Show the latest 5 invoices");

    expect(latest.interpretation.args).toEqual({ limit: 5 });
    expect(latest.resolved).toContain("Newest 5");
    expect(run("show the latest invoice").interpretation.args).toEqual({ limit: 1 });
    expect(run("show the latest invoices").interpretation.args).toEqual({});
    expect(run("top 600 documents").interpretation.args).toEqual({ limit: 500 });
  });

  it("reads export formats", () => {
    expect(run("export as json").interpretation.args).toEqual({ format: "json" });
    expect(run("download invoices as an excel file").interpretation.args).toEqual({ format: "xlsx" });
    expect(run("export to spreadsheet").interpretation.args).toEqual({ format: "xlsx" });
  });

  it("creates a template without a connecting word", () => {
    expect(run("Create a delivery note template").interpretation.args).toEqual({
      instruction: "delivery note template",
    });
    expect(run("Create a template").interpretation.args).toEqual({});
  });

  it("keeps an edit without an instruction complete", () => {
    const { interpretation, complete } = run("Edit the receipt template");

    expect(interpretation.args).toEqual({ template_id: "tpl_receipt" });
    expect(complete).toBe(true);
  });

  it("reads statuses", () => {
    expect(run("find queued or processing documents").interpretation.filter).toEqual({
      statuses: ["queued", "processing"],
    });
    expect(run("documents that need a template").interpretation.filter).toEqual({ statuses: ["awaiting_template"] });
  });

  it("searches plain text", () => {
    expect(run('find documents containing "acme"').interpretation.filter).toEqual({ text: "acme" });
    expect(run('documents named "march report"').interpretation.filter).toEqual({ text: "march report" });
    expect(run('"hnh-0042"').interpretation.filter).toEqual({ text: "hnh-0042" });
  });

  it("falls back to a text search when nothing else was recognised", () => {
    const { interpretation, complete } = run("zebra crossing");

    expect(interpretation.filter).toEqual({ text: "zebra crossing" });
    expect(complete).toBe(false);
  });

  it("reports phrases that don't apply to the action", () => {
    const { complete, unused } = run("go to costs from last week");

    expect(complete).toBe(false);
    expect(unused).toEqual(["from last week"]);
  });
});

describe("interpretLocally conditions", () => {
  it.each([
    ['invoice number contains "50%_off\\now"', "contains", "50%_off\\now"],
    ["invoice number ends with 'O'Brien'", "ends_with", "O'Brien"],
    ['invoice number is "O’Neill & Sons"', "is", "O’Neill & Sons"],
    ["invoice number is “a, b. c”", "is", "a, b. c"],
    ["invoice number is not HNH-1", "is_not", "HNH-1"],
    ["invoice number isn't HNH-1.", "is_not", "HNH-1"],
    ['invoice number starts with "hn', "starts_with", "hn"],
    ["invoice number = 42", "is", "42"],
  ])("keeps literal text: %s", (text, op, value) => {
    expect(run(text).interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "invoice_number", op, value)],
    });
  });

  it.each([
    ["invoices where total is over 500", "gt", 500],
    ["invoices with total above £1,500.50", "gt", 1500.5],
    ["invoices with a total of at least 500", "gte", 500],
    ["invoices where total >= 0", "gte", 0],
    ["invoices where total<10", "lt", 10],
    ["invoices with total under $99.99", "lt", 99.99],
    ["invoices with total at most 1,000,000", "lte", 1_000_000],
    ["invoices where total is 500", "eq", 500],
    ["invoices where total = 500", "eq", 500],
    ["invoices where total is -20", "eq", -20],
  ])("compares numbers: %s", (text, op, value) => {
    expect(run(text).interpretation.filter).toEqual({ conditions: [condition("tpl_invoice", "total", op, value)] });
  });

  it("reads a bare comparison after and as another bound on the same field", () => {
    // Receipts have two number fields, so "under 20" can only be read from what came before it.
    expect(run("receipts with tax over 10 and under 20").interpretation.filter).toEqual({
      conditions: [condition("tpl_receipt", "tax", "gt", 10), condition("tpl_receipt", "tax", "lt", 20)],
    });
  });

  it("reads number ranges", () => {
    expect(run("invoices where total is between 100 and 2,000").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "total", "between", 100, 2000)],
    });

    const reversed = run("invoices where total is between 200 and 100");

    expect(reversed.complete).toBe(false);
    expect(reversed.unused).toEqual(["is between 200 and 100"]);
  });

  it.each([
    ["invoices issued after 2026-03-01", "gt", "2026-03-01"],
    ["invoices issued after 1 March 2026", "gt", "2026-03-01"],
    ["invoices issued before 1st March 2026", "lt", "2026-03-01"],
    ["invoices issued on or after 01/03/2026", "gte", "2026-03-01"],
    ["invoices issued since March 1, 2026", "gte", "2026-03-01"],
    ["invoices issued until 31 Dec 2026", "lte", "2026-12-31"],
    ["invoices where issue date is 29/02/2028", "eq", "2028-02-29"],
    ["invoices where issue date is 1 December", "eq", "2026-12-01"],
  ])("compares dates on a date field: %s", (text, op, value) => {
    expect(run(text).interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "issue_date", op, value)],
    });
  });

  it("turns a date range next to a date field into a field range", () => {
    expect(run("invoices issued last week").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "issue_date", "between", "2026-10-05", "2026-10-11")],
    });
    expect(run("invoices issued in March").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "issue_date", "between", "2026-03-01", "2026-03-31")],
    });
    expect(run("invoices issued between 1 March 2026 and 31 March 2026").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "issue_date", "between", "2026-03-01", "2026-03-31")],
    });
    expect(run("orders where order date is today").interpretation.filter).toEqual({
      conditions: [condition("tpl_po", "order_date", "eq", TODAY)],
    });
  });

  it("leaves impossible dates unused", () => {
    const { complete, interpretation } = run("invoices where issue date is 31/02/2026");

    expect(complete).toBe(false);
    expect(interpretation.filter?.conditions).toBeUndefined();
  });

  it.each([
    ["invoices where vendor is missing", "vendor", "not_found"],
    ["invoices where vendor was not found", "vendor", "not_found"],
    ["invoices without a vendor", "vendor", "not_found"],
    ["invoices with no total", "total", "not_found"],
    ["invoices where billing address is empty", "billing_address", "empty"],
    ["invoices where total is invalid", "total", "invalid"],
    ["invoices where the issue date is invalid", "issue_date", "invalid"],
    ["invoices where vendor has a value", "vendor", "has_value"],
    ["invoices where paid is yes", "paid", "is_true"],
    ["invoices where paid is false", "paid", "is_false"],
    ["invoices where paid = no", "paid", "is_false"],
    ["invoices with an invoice number", "invoice_number", "has_value"],
  ])("reads state and yes or no conditions: %s", (text, fieldId, op) => {
    expect(run(text).interpretation.filter).toEqual({ conditions: [condition("tpl_invoice", fieldId, op)] });
  });

  it("reads Boolean fields as adjectives", () => {
    const unpaid = run("unpaid invoices");

    expect(unpaid.interpretation.filter).toEqual({ conditions: [condition("tpl_invoice", "paid", "is_false")] });
    expect(unpaid.resolved[0]).toBe("Paid: no");

    const paid = run("paid invoices");

    expect(paid.interpretation.filter).toEqual({ conditions: [condition("tpl_invoice", "paid", "is_true")] });
    expect(paid.resolved[0]).toBe("Paid: yes");
    expect(run("invoices that are not paid").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "paid", "is_false")],
    });
  });

  it("keeps yes and no as text on a text field", () => {
    expect(run("invoices where vendor is yes").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "vendor", "is", "yes")],
    });
  });

  it("uses a typed value for the pending field", () => {
    expect(run("invoices with vendor Acme").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "vendor", "contains", "Acme")],
    });
    expect(run('invoices with total "250"').interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "total", "eq", 250)],
    });
  });

  it("rejects operators the field's type doesn't take", () => {
    const text = run("invoices where invoice number is over 500");

    expect(text.complete).toBe(false);
    expect(text.unused).toEqual(["is over 500"]);

    const number = run('invoices where total starts with "5"');

    expect(number.complete).toBe(false);
  });

  it("resolves a loose number to the subject's only number field", () => {
    expect(run("purchase orders over 1,000").interpretation.filter).toEqual({
      conditions: [condition("tpl_po", "amount", "gt", 1000)],
    });

    // Receipts have two number fields, and "documents" names no Template.
    for (const text of ["receipts over 50", "documents over 50", "invoices and receipts over 50"]) {
      const { complete, interpretation } = run(text);

      expect(complete).toBe(false);
      expect(interpretation.filter?.conditions).toBeUndefined();
    }
  });

  it("reads a loose date range as the upload date", () => {
    expect(run("documents between 1 March 2026 and 15 March 2026").interpretation.filter).toEqual({
      uploaded_from: "2026-03-01",
      uploaded_to: "2026-03-15",
    });
  });

  it("combines upload date phrases", () => {
    expect(run("documents since 1 March before April").interpretation.filter).toEqual({
      uploaded_from: "2026-03-01",
      uploaded_to: "2026-03-31",
    });
    expect(run("documents after 1 December").interpretation.filter).toEqual({ uploaded_from: "2025-12-02" });
  });

  it("does not add a Template already pinned by a condition", () => {
    expect(run("receipts where merchant is Acme").interpretation.filter).toEqual({
      conditions: [condition("tpl_receipt", "merchant", "is", "Acme")],
    });
  });
});

describe("interpretLocally ambiguity", () => {
  it("uses the first Template and asks when a label is on several", () => {
    const { interpretation, complete } = run("documents where total is over 100");

    expect(complete).toBe(false);
    expect(interpretation.filter).toEqual({ conditions: [condition("tpl_invoice", "total", "gt", 100)] });
    expect(interpretation.notes).toEqual([
      {
        kind: "ambiguous_field",
        text: "“Total” is on Invoice and Receipt. Using Invoice.",
        alternatives: [{ template_id: "tpl_receipt", field_id: "total" }],
      },
    ]);
  });

  it("uses the Template named in the sentence", () => {
    const { interpretation, complete } = run("receipts where total is over 100");

    expect(complete).toBe(true);
    expect(interpretation.notes).toEqual([]);
    expect(interpretation.filter).toEqual({ conditions: [condition("tpl_receipt", "total", "gt", 100)] });
  });

  it("notes a field that isn't on the named Template", () => {
    const { interpretation, complete } = run("invoices where merchant is Acme");

    expect(complete).toBe(false);
    expect(interpretation.filter).toEqual({ conditions: [condition("tpl_receipt", "merchant", "is", "Acme")] });
    expect(interpretation.notes).toEqual([
      { kind: "unrecognised", text: "“Merchant” isn't on Invoice. Using Receipt." },
      { kind: "unrecognised", text: "The conditions only apply to Receipt, so Invoice is left out." },
    ]);
  });

  it("notes a known value that is in several fields", () => {
    const { interpretation, complete } = run("find Acme");

    expect(complete).toBe(false);
    expect(interpretation.filter).toEqual({ conditions: [condition("tpl_invoice", "vendor", "contains", "Acme")] });
    expect(interpretation.notes).toEqual([
      {
        kind: "ambiguous_field",
        text: "“Acme” appears in Invoice › Vendor and Receipt › Merchant. Using Invoice › Vendor.",
        alternatives: [{ template_id: "tpl_receipt", field_id: "merchant" }],
      },
    ]);
    expect(run("receipts from acme").interpretation.filter).toEqual({
      conditions: [condition("tpl_receipt", "merchant", "contains", "Acme")],
    });
  });
});

describe("interpretLocally limits", () => {
  it("validates a long request with many phrases", () => {
    const text = `${Array.from({ length: 30 }, (_, index) => `word${index}`).join(" ")} ${"x".repeat(300)}`;
    const { interpretation } = run(text);

    expect(interpretation.unrecognised).toHaveLength(20);
  });

  it("keeps at most ten conditions", () => {
    const text = Array.from({ length: 12 }, (_, index) => `invoice number contains "v${index}"`).join(" and ");

    const { interpretation, complete } = run(text);

    expect(interpretation.filter.conditions).toHaveLength(10);
    expect(complete).toBe(false);
    expect(interpretation.notes).toContainEqual({
      kind: "unrecognised",
      text: "Only the first 10 conditions are used.",
    });
  });
});

describe("resolveRelativeDate", () => {
  it.each([
    ["today", TODAY, { from: TODAY, to: TODAY }],
    ["yesterday", "2026-01-01", { from: "2025-12-31", to: "2025-12-31" }],
    ["this week", TODAY, { from: "2026-10-12", to: TODAY }],
    ["this week", "2026-10-12", { from: "2026-10-12", to: "2026-10-12" }],
    ["last week", TODAY, { from: "2026-10-05", to: "2026-10-11" }],
    ["last week", "2026-10-18", { from: "2026-10-05", to: "2026-10-11" }],
    ["last week", "2026-01-03", { from: "2025-12-22", to: "2025-12-28" }],
    ["this week", "2026-01-03", { from: "2025-12-29", to: "2026-01-03" }],
    ["this month", TODAY, { from: "2026-10-01", to: TODAY }],
    ["last month", "2026-01-15", { from: "2025-12-01", to: "2025-12-31" }],
    ["last month", "2024-03-31", { from: "2024-02-01", to: "2024-02-29" }],
    ["last 7 days", "2026-03-02", { from: "2026-02-24", to: "2026-03-02" }],
    ["past week", TODAY, { from: "2026-10-07", to: TODAY }],
    ["the last 30 days", TODAY, { from: "2026-09-14", to: TODAY }],
    ["this year", TODAY, { from: "2026-01-01", to: TODAY }],
    ["last year", TODAY, { from: "2025-01-01", to: "2025-12-31" }],
    ["in March", TODAY, { from: "2026-03-01", to: "2026-03-31" }],
    ["December", TODAY, { from: "2025-12-01", to: "2025-12-31" }],
    ["February 2028", TODAY, { from: "2028-02-01", to: "2028-02-29" }],
    ["in 2025", TODAY, { from: "2025-01-01", to: "2025-12-31" }],
    ["uploaded on 2026-03-01", TODAY, { from: "2026-03-01", to: "2026-03-01" }],
    ["since 1 March", TODAY, { from: "2026-03-01", to: null }],
    ["from 1 March", TODAY, { from: "2026-03-01", to: null }],
    ["after 31 December 2025", TODAY, { from: "2026-01-01", to: null }],
    ["before 1 March 2024", TODAY, { from: null, to: "2024-02-29" }],
    ["until last week", TODAY, { from: null, to: "2026-10-11" }],
  ])("%s on %s", (phrase, today, expected) => {
    expect(resolveRelativeDate(phrase, today)).toEqual(expected);
  });

  it.each(["", "soon", "31 February", "2026-02-30", "last 0 days", "2025"])("returns null for %j", (phrase) => {
    expect(resolveRelativeDate(phrase, TODAY)).toBeNull();
  });
});

describe("describeFilter", () => {
  it("summarises a filter in UK style", () => {
    const filter = {
      conditions: [condition("tpl_invoice", "invoice_number", "starts_with", "hnh")],
      statuses: ["failed"],
      uploaded_from: "2026-10-05",
      uploaded_to: "2026-10-11",
      text: "acme",
    };

    expect(describeFilter(filter, catalog, { today: TODAY })).toBe(
      "Invoice › Invoice number starts with “hnh” · failed · uploaded 5 Oct – 11 Oct · text “acme”",
    );
  });

  it("describes every kind of member", () => {
    const filter = {
      template_ids: ["tpl_receipt", "tpl_po"],
      statuses: ["queued", "awaiting_template"],
      uploaded_from: "2025-12-29",
      uploaded_to: "2026-01-04",
      model: "gpt-x",
      conditions: [
        condition("tpl_invoice", "total", "between", 1500, 20000.5),
        condition("tpl_invoice", "issue_date", "lt", "2026-03-01"),
        condition("tpl_invoice", "paid", "is_false"),
        condition("tpl_invoice", "vendor", "not_found"),
      ],
    };

    expect(describeFilter(filter, catalog, { today: TODAY })).toBe(
      [
        "Receipt or Purchase order",
        "Invoice › Total between 1,500 and 20,000.5",
        "Invoice › Issue date before 1 Mar 2026",
        "Invoice › Paid is no",
        "Invoice › Vendor is missing",
        "queued or needs template",
        "uploaded 29 Dec 2025 – 4 Jan 2026",
        "model “gpt-x”",
      ].join(" · "),
    );
  });

  it("describes open-ended upload ranges", () => {
    expect(describeFilter({ uploaded_from: "2026-03-01" }, catalog, { today: TODAY })).toBe("uploaded since 1 Mar");
    expect(describeFilter({ uploaded_to: "2025-02-28" }, catalog, { today: TODAY })).toBe("uploaded up to 28 Feb 2025");
  });

  it("returns an empty string for no filter", () => {
    expect(describeFilter(null, catalog)).toBe("");
    expect(describeFilter({}, catalog)).toBe("");
  });

  it("describes the local interpretation", () => {
    const { interpretation } = run("Retry all failed invoices from last week");

    expect(describeFilter(interpretation.filter, catalog, { today: TODAY })).toBe(
      "Invoice · failed · uploaded 5 Oct – 11 Oct",
    );
  });
});

describe("askLooksLikeQuestion", () => {
  it.each([
    ["How many invoices failed last week?", true],
    ["what is the total for Acme", true],
    ["Which receipts are missing a merchant", true],
    ["Find invoices?", true],
    ["Find invoices", false],
    ["invoices over 500", false],
    ["   ", false],
  ])("%j → %s", (text, expected) => {
    expect(askLooksLikeQuestion(text, lexCommand(text, catalog))).toBe(expected);
  });
});

describe("review regressions", () => {
  it("reads one and a single as a limit of one", () => {
    for (const text of ["delete one failed document", "delete a single failed document"]) {
      const { interpretation, complete } = run(text);

      expect(interpretation.args).toEqual({ limit: 1 });
      expect(interpretation.filter).toEqual({ statuses: ["failed"] });
      expect(complete).toBe(true);
    }
  });

  it("leaves a quantity unused when it sets no limit", () => {
    const latest = run("show the latest invoices");

    expect(latest.interpretation.args).toEqual({});
    expect(latest.complete).toBe(false);
    expect(latest.unused).toEqual(["the latest"]);

    const templates = run("show 5 templates");

    expect(templates.interpretation.args).toEqual({});
    expect(templates.unused).toEqual(["5"]);
    expect(run("show all templates").complete).toBe(true);
  });

  it("reads a Template name as a field of a Template already named", () => {
    const segments = lexCommand("delete invoices with a purchase order", catalog);

    expect(kinds(segments)).toEqual([
      ["action", "delete"],
      ["subject", "invoices"],
      ["field", "purchase order"],
    ]);

    const { interpretation, complete } = run("delete invoices with a purchase order");

    expect(interpretation.filter).toEqual({ conditions: [condition("tpl_invoice", "purchase_order", "has_value")] });
    expect(complete).toBe(true);
  });

  it("notes a Template name that is also a field elsewhere", () => {
    const { interpretation, complete } = run("find purchase order");

    expect(complete).toBe(false);
    expect(interpretation.filter).toEqual({ template_ids: ["tpl_po"] });
    expect(interpretation.notes).toEqual([
      {
        kind: "ambiguous_field",
        text: "“Purchase order” is a template and a field on Invoice. Using the template.",
        alternatives: [{ template_id: "tpl_invoice", field_id: "purchase_order" }],
      },
    ]);
  });

  it("settles a pending field before a from value", () => {
    const { interpretation, complete } = run("invoices with an invoice number from Globex Supplies");

    expect(interpretation.filter).toEqual({
      conditions: [
        condition("tpl_invoice", "invoice_number", "has_value"),
        condition("tpl_invoice", "vendor", "contains", "Globex Supplies"),
      ],
    });
    expect(complete).toBe(true);
  });

  it("settles a pending date field before an upload date", () => {
    expect(run("invoices with an issue date uploaded last week").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "issue_date", "has_value")],
      uploaded_from: "2026-10-05",
      uploaded_to: "2026-10-11",
    });
  });

  it("does not use a value from a Template that wasn't named", () => {
    const { interpretation, complete, unused } = run("receipts from Northwind Traders");

    expect(interpretation.filter).toEqual({ template_ids: ["tpl_receipt"] });
    expect(complete).toBe(false);
    expect(unused).toEqual(["from Northwind Traders"]);
  });

  it("asks when several named Templates have the field", () => {
    const { interpretation, complete } = run("invoices and receipts with total over 100");

    expect(complete).toBe(false);
    expect(interpretation.filter).toEqual({ conditions: [condition("tpl_invoice", "total", "gt", 100)] });
    expect(interpretation.notes).toContainEqual({
      kind: "ambiguous_field",
      text: "“Total” is on Invoice and Receipt. Using Invoice.",
      alternatives: [{ template_id: "tpl_receipt", field_id: "total" }],
    });
  });

  it("never combines a condition with a different Template", () => {
    const { interpretation, complete } = run("receipts and invoices where merchant is Acme");

    expect(interpretation.filter).toEqual({ conditions: [condition("tpl_receipt", "merchant", "is", "Acme")] });
    expect(complete).toBe(false);
    expect(interpretation.notes).toContainEqual({
      kind: "unrecognised",
      text: "The conditions only apply to Receipt, so Invoice is left out.",
    });
  });

  it("reports conditions on several Templates", () => {
    const { interpretation, complete } = run("documents where vendor is Acme and merchant is Acme");

    expect(complete).toBe(false);
    expect(interpretation.notes).toContainEqual({
      kind: "unrecognised",
      text: "These conditions use fields from Invoice and Receipt, so no document can match.",
    });
  });

  it("reports search text that was cut", () => {
    const { interpretation, complete } = run(`find documents containing "${"x".repeat(250)}"`);

    expect(interpretation.filter.text).toHaveLength(200);
    expect(complete).toBe(false);
    expect(interpretation.notes).toContainEqual({
      kind: "unrecognised",
      text: "Search text is limited to 200 characters.",
    });
  });

  it("uses whole periods for extracted date fields", () => {
    expect(run("invoices issued this week").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "issue_date", "between", "2026-10-12", "2026-10-18")],
    });
    expect(run("invoices issued this month").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "issue_date", "between", "2026-10-01", "2026-10-31")],
    });
    expect(run("invoices issued this year").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "issue_date", "between", "2026-01-01", "2026-12-31")],
    });
    // Upload dates still stop at today.
    expect(run("documents this month").interpretation.filter).toEqual({
      uploaded_from: "2026-10-01",
      uploaded_to: TODAY,
    });
  });

  it("leaves an email that is too long unused", () => {
    const email = `${"a".repeat(250)}@example.com`;
    const { interpretation, complete } = run(`invite ${email}`);

    expect(interpretation.args).toEqual({});
    expect(complete).toBe(false);
  });

  it("rejects years outside 1000 to 9999", () => {
    expect(resolveRelativeDate("after 31/12/9999", TODAY)).toBeNull();
    expect(resolveRelativeDate("March 0050", TODAY)).toBeNull();
    expect(resolveRelativeDate("31/12/9999", TODAY)).toEqual({ from: "9999-12-31", to: "9999-12-31" });

    for (const text of ["documents after 31/12/9999", "documents in March 0050"]) {
      const { interpretation, complete } = run(text);

      expect(complete).toBe(false);
      expect(interpretation.filter.uploaded_from).toBeUndefined();
    }
  });

  it("defaults today to the UTC day", () => {
    const today = new Date().toISOString().slice(0, 10);

    expect(resolveRelativeDate("today")).toEqual({ from: today, to: today });
  });
});

describe("large catalogues", () => {
  const words = ["north", "south", "east", "west", "central", "upper", "lower", "outer"];

  function largeCatalog(templateCount, fieldCount, valueCount) {
    let valuesLeft = valueCount;

    return {
      models: [],
      interpretation: { available: true },
      templates: Array.from({ length: templateCount }, (_, t) => ({
        id: `tpl_${t}`,
        name: `${words[t % words.length]} form ${t}`,
        current_version: 1,
        fields: Array.from({ length: fieldCount }, (_, f) => {
          const share = Math.ceil(valuesLeft / Math.max(1, (templateCount - t) * fieldCount - f));
          const count = Math.min(share, valuesLeft);

          valuesLeft -= count;

          return {
            field_id: `f_${t}_${f}`,
            name: `${words[f % words.length]} field ${f}`,
            data_type: "string",
            type: "text",
            known_values: Array.from({ length: count }, (_, v) => `${words[v % words.length]} supplier ${t}-${f}-${v}`),
          };
        }),
      })),
    };
  }

  it("lexes 200 characters in under 50 ms with 100 Templates, 30 fields each and 1,500 values", () => {
    const big = largeCatalog(100, 30, 1_500);

    const text =
      'find north form 7 where north field 3 starts with "ab" from south supplier 4-2-1 and east field 9 over 5 '
        .repeat(2)
        .slice(0, 200);

    interpretLocally(lexCommand(text, big), big, { today: TODAY });
    const started = performance.now();

    for (let round = 0; round < 10; round += 1) interpretLocally(lexCommand(text, big), big, { today: TODAY });

    expect((performance.now() - started) / 10).toBeLessThan(50);
  });

  it("handles 1,000 characters and 80,000 values without throwing", () => {
    const big = largeCatalog(100, 30, 80_000);
    const text = "north supplier 1-1-1 west field 2 is missing ".repeat(25).slice(0, 1_000);

    expect(() => interpretLocally(lexCommand(text, big), big, { today: TODAY })).not.toThrow();
  });

  it("only reads the first 1,000 characters", () => {
    const text = `${"invoices ".repeat(120)}failed`;
    const segments = lexCommand(text, catalog);
    const last = segments[segments.length - 1];

    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    expect(last.type).toBe("plain");
    expect(last.end).toBe(text.length);
    expect(segments.some((segment) => segment.type === "status")).toBe(false);
  });
});

describe("short Template names and find verbs", () => {
  const named = {
    models: [],
    interpretation: { available: true },
    templates: [
      {
        id: "tpl_delivery",
        name: "Delivery Note Template",
        current_version: 2,
        fields: [{ field_id: "driver", name: "Driver", data_type: "string", type: "text" }],
      },
      { id: "tpl_order_a", name: "Order Form", current_version: 1, fields: [] },
      { id: "tpl_order_b", name: "Order Template", current_version: 1, fields: [] },
      { id: "tpl_plain", name: "Template", current_version: 1, fields: [] },
    ],
  };

  function read(text) {
    const segments = lexCommand(text, named, { workspaces: [] });
    const result = interpretLocally(segments, named, { today: TODAY, workspaces: [] });

    expect(validateCommandInterpretation(result.interpretation, named)).toEqual(result.interpretation);

    return { segments, ...result };
  }

  it("finds a Template by its name without generic words such as Template or Form", () => {
    const { interpretation, complete } = read("Return delivery note documents created in the last 7 days");

    expect(complete).toBe(true);
    expect(interpretation.action).toBe("find_documents");
    expect(interpretation.filter).toEqual({
      template_ids: ["tpl_delivery"],
      uploaded_from: "2026-10-07",
      uploaded_to: "2026-10-13",
    });
  });

  it("reads plural short names", () => {
    const { interpretation, complete } = read("fetch delivery notes from last week");

    expect(complete).toBe(true);
    expect(interpretation.filter.template_ids).toEqual(["tpl_delivery"]);
  });

  it("keeps the full name working, singular and plural", () => {
    expect(read("Return delivery note templates created in the last 7 days").interpretation.filter.template_ids).toEqual([
      "tpl_delivery",
    ]);
  });

  it("leaves out a short name that several Templates share", () => {
    const { interpretation, complete, unused } = read("show order documents");

    expect(complete).toBe(false);
    expect(unused).toContain("order");
    expect(interpretation.filter?.template_ids).toBeUndefined();
  });

  it("treats return, fetch, display and view as find", () => {
    for (const verb of ["Return", "Fetch", "Display", "View", "Pull up", "Give me"])
      expect(read(`${verb} failed documents`).interpretation).toMatchObject({
        action: "find_documents",
        filter: { statuses: ["failed"] },
      });
  });
});

describe("mergeInterpretations", () => {
  function local(text) {
    const segments = lexCommand(text, catalog, { workspaces });

    return { segments, ...interpretLocally(segments, catalog, { today: TODAY, workspaces }) };
  }

  it("keeps the action, dates and Templates the parser recognised", () => {
    const { segments, interpretation } = local("find invoices billed to Leeds from last week");

    const model = {
      action: "find_templates",
      args: { template_id: "tpl_receipt" },
      filter: {
        template_ids: ["tpl_receipt"],
        uploaded_from: "2026-10-04",
        uploaded_to: "2026-10-12",
        conditions: [{ template_id: "tpl_invoice", field_id: "billing_address", op: "contains", value: "Leeds" }],
      },
      unrecognised: [],
      notes: [{ kind: "matched", text: "Matched “Leeds” to Billing address." }],
    };

    const merged = mergeInterpretations(interpretation, model, segments);

    expect(merged.action).toBe("find_documents");
    expect(merged.filter).toMatchObject({
      uploaded_from: "2026-10-05",
      uploaded_to: "2026-10-11",
      conditions: [{ template_id: "tpl_invoice", field_id: "billing_address", op: "contains", value: "Leeds" }],
    });
    expect(merged.filter.template_ids ?? ["tpl_invoice"]).toEqual(["tpl_invoice"]);
    expect(merged.unrecognised).toEqual([]);
    expect(validateCommandInterpretation(merged, catalog)).toEqual(merged);
  });

  it("drops model conditions on Templates the request didn't name", () => {
    const { segments, interpretation } = local("find invoices billed to Leeds");

    const merged = mergeInterpretations(
      interpretation,
      {
        action: "find_documents",
        args: {},
        filter: { conditions: [{ template_id: "tpl_receipt", field_id: "merchant", op: "contains", value: "Leeds" }] },
        unrecognised: ["billed"],
        notes: [],
      },
      segments,
    );

    expect(merged.filter.conditions ?? []).toEqual([]);
    expect(merged.unrecognised).toEqual(["billed"]);
  });

  it("uses the model's action when the request has no action verb", () => {
    const { segments, interpretation } = local("invoices billed to Leeds");

    const merged = mergeInterpretations(
      interpretation,
      { action: "export", args: { format: "csv" }, filter: {}, unrecognised: [], notes: [] },
      segments,
    );

    expect(merged.action).toBe("export");
    expect(merged.args.format).toBe("csv");
  });
});

describe("processing cost", () => {
  const costCatalog = { ...catalog, capabilities: { cost: true } };

  // Invoice has its own "Cost" field; Receipt and Purchase order don't.
  const costFieldCatalog = {
    ...costCatalog,
    templates: costCatalog.templates.map((template) =>
      template.id === "tpl_invoice"
        ? { ...template, fields: [...template.fields, { field_id: "cost", name: "Cost", data_type: "number", type: "number" }] }
        : template,
    ),
  };

  function costRun(text, source = costCatalog) {
    const segments = lexCommand(text, source, { workspaces });
    const result = interpretLocally(segments, source, { today: TODAY, workspaces });

    expect(validateCommandInterpretation(result.interpretation, source)).toEqual(result.interpretation);

    return { segments, ...result };
  }

  it("reads the issue's example as a cost condition, with a Processing cost pill", () => {
    const { segments, interpretation, complete, resolved } = costRun("Show me documents with a cost greater than $0.03");

    expect(kinds(segments)).toEqual([
      ["action", "Show me"],
      ["subject", "documents"],
      ["field", "cost"],
      ["condition", "greater than $0.03"],
    ]);
    expect(resolved[segments.findIndex((segment) => segment.type === "field")]).toBe("Processing cost");
    expect(interpretation).toMatchObject({
      action: "find_documents",
      filter: { conditions: [{ cost: { op: "gt", value: 0.03 } }] },
    });
    expect(complete).toBe(true);
  });

  it.each([
    ["documents with a processing cost over 3 cents", { op: "gt", value: 0.03 }],
    ["documents costing between $0.01 and $0.05", { op: "between", value: 0.01, value2: 0.05 }],
    ["docs with a cost between 1 and 5 cents", { op: "between", value: 0.01, value2: 0.05 }],
    ["documents where the total cost is under 0.1", { op: "lt", value: 0.1 }],
    ["documents with spend >= $1", { op: "gte", value: 1 }],
    ["documents that cost at most 50c", { op: "lte", value: 0.5 }],
    ["documents we spent more than 2 dollars on", { op: "gt", value: 2 }],
    ["documents with costs of exactly $0.25", { op: "eq", value: 0.25 }],
    ["documents with a cost of $0.25", { op: "eq", value: 0.25 }],
    ["documents costing $0.05", { op: "eq", value: 0.05 }],
    ["documents with a total cost above $1,200.50", { op: "gt", value: 1200.5 }],
    ["documents with a cost over 0.3 cents", { op: "gt", value: 0.003 }],
    ["documents with a cost over 0", { op: "gt", value: 0 }],
  ])("%s", (text, cost) => {
    const { interpretation, complete } = costRun(text);

    expect(interpretation.filter).toEqual({ conditions: [{ cost }] });
    expect(complete).toBe(true);
  });

  it("needs an amount after the cost words, and a range in order", () => {
    // A bare number without a comparison or currency isn't an amount.
    expect(costRun("documents costing 3").interpretation.filter.conditions).toBeUndefined();
    expect(costRun("documents with a cost between $0.05 and $0.01").interpretation.filter.conditions).toBeUndefined();
    // Negative amounts aren't costs.
    expect(costRun("documents with a cost under -1").interpretation.filter.conditions).toBeUndefined();
  });

  it("combines with Templates, statuses, upload dates and field conditions", () => {
    const { interpretation, complete } = costRun("failed invoices with a cost of more than 2c uploaded last week");

    expect(interpretation.filter).toEqual({
      statuses: ["failed"],
      template_ids: ["tpl_invoice"],
      uploaded_from: "2026-10-05",
      uploaded_to: "2026-10-11",
      conditions: [{ cost: { op: "gt", value: 0.02 } }],
    });
    expect(complete).toBe(true);
    expect(costRun("invoices where total is over 500 and the cost is under $0.10").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "total", "gt", 500), { cost: { op: "lt", value: 0.1 } }],
    });
  });

  it("still goes to the Costs page", () => {
    for (const text of ["Go to costs", "costs page", "open the costs page", "costs", "go to spend"]) {
      expect(costRun(text).interpretation).toMatchObject({ action: "go_to", args: { page: "costs" } });
    }
  });

  it("uses a named Template's field of that name, and the processing cost otherwise", () => {
    expect(costRun("invoices with a cost over 5", costFieldCatalog).interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "cost", "gt", 5)],
    });
    expect(costRun("documents with a cost over 5", costFieldCatalog).interpretation.filter).toEqual({
      conditions: [{ cost: { op: "gt", value: 5 } }],
    });
    expect(costRun("receipts with a cost over $5", costFieldCatalog).interpretation.filter).toEqual({
      template_ids: ["tpl_receipt"],
      conditions: [{ cost: { op: "gt", value: 5 } }],
    });
  });

  it("leaves cost words unused, with a note, when the caller can't read costs", () => {
    for (const source of [catalog, { ...catalog, capabilities: { cost: false } }]) {
      const { interpretation, complete, unused } = costRun("Show me documents with a cost greater than $0.03", source);

      expect(interpretation.filter.conditions).toBeUndefined();
      expect(unused).toEqual(["cost", "greater than $0.03"]);
      expect(complete).toBe(false);
      expect(interpretation.notes).toContainEqual({ kind: "unrecognised", text: "Only owners and admins can search by cost." });
    }

    // A catalogue field called "Cost" is still searchable.
    const withField = { ...costFieldCatalog, capabilities: { cost: false } };

    expect(costRun("documents with a cost over 5", withField).interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "cost", "gt", 5)],
    });
  });

  it.each([
    // Purchase orders have one number field, which used to take the second bound.
    "purchase orders that cost more than $0.03 and less than $0.05",
    "documents that cost more than $0.03 and cost less than $0.05",
    "documents costing over 3 cents and under 5 cents",
  ])("reads every cost condition: %s", (text) => {
    const { interpretation, complete } = costRun(text);

    // The second condition is on the cost, not on a number field.
    expect(interpretation.filter.conditions).toEqual([{ cost: { op: "gt", value: 0.03 } }, { cost: { op: "lt", value: 0.05 } }]);
    expect(complete).toBe(true);
  });

  it("groups cost conditions like field conditions", () => {
    expect(costRun("documents that cost under 1 cent or over 5 cents").interpretation.filter).toEqual({
      conditions: [{ any: [{ cost: { op: "lt", value: 0.01 } }, { cost: { op: "gt", value: 0.05 } }] }],
    });
    expect(costRun("receipts that cost over $0.03 or total under 20").interpretation.filter).toEqual({
      template_ids: ["tpl_receipt"],
      conditions: [{ any: [{ cost: { op: "gt", value: 0.03 } }, condition("tpl_receipt", "total", "lt", 20)] }],
    });
    expect(costRun("receipts that cost over $0.03 and total under 20").interpretation.filter).toEqual({
      conditions: [{ cost: { op: "gt", value: 0.03 } }, condition("tpl_receipt", "total", "lt", 20)],
    });
  });

  it("never loses a recognised cost when the model corrects a field grouped with it", () => {
    const local = costRun("delete invoices that cost over $0.03 or total under 5 billed to Leeds");
    const cost = { cost: { op: "gt", value: 0.03 } };
    const group = { any: [cost, condition("tpl_invoice", "total", "lt", 5)] };
    const leeds = condition("tpl_invoice", "billing_address", "contains", "Leeds");
    const model = (conditions) => ({ action: "delete", args: {}, filter: { conditions }, unrecognised: [], notes: [] });

    const merge = (conditions) =>
      mergeInterpretations(local.interpretation, model(conditions), local.segments).filter.conditions;

    expect(local.interpretation.filter.conditions).toEqual([group]);
    // A correction of the field alone can't replace the group, or the cost would be dropped.
    expect(merge([condition("tpl_invoice", "total", "lt", 6), leeds])).toEqual([group, leeds]);
    // A correction that keeps the same cost replaces the group.
    const corrected = { any: [cost, condition("tpl_invoice", "total", "lt", 6)] };

    expect(merge([corrected, leeds])).toEqual([corrected, leeds]);
    // A replacement that can't be used (it names a Template the request didn't) replaces nothing.
    const elsewhere = { any: [cost, condition("tpl_invoice", "total", "lt", 6), condition("tpl_receipt", "total", "lt", 6)] };

    expect(merge([elsewhere, leeds])).toEqual([group, leeds]);
  });

  it("describes the cost in the summary", () => {
    const describe = (cost) => describeFilter({ conditions: [{ cost }] }, costCatalog);

    expect(describe({ op: "gt", value: 0.03 })).toBe("cost over $0.03");
    expect(describe({ op: "lte", value: 1 })).toBe("cost at most $1.00");
    expect(describe({ op: "eq", value: 0.0025 })).toBe("cost of $0.0025");
    expect(describe({ op: "between", value: 0.01, value2: 0.05 })).toBe("cost between $0.01 and $0.05");
    expect(
      describeFilter(
        { template_ids: ["tpl_invoice"], statuses: ["failed"], conditions: [{ cost: { op: "gte", value: 0.5 } }] },
        costCatalog,
      ),
    ).toBe("Invoice · cost at least $0.50 · failed");
    expect(
      describeFilter({ conditions: [{ any: [{ cost: { op: "lt", value: 0.01 } }, { cost: { op: "gt", value: 0.05 } }] }] }, costCatalog),
    ).toBe("cost under $0.01 or over $0.05");
  });

  it("keeps a locally recognised cost over the model's, and takes the model's otherwise", () => {
    const model = (cost) => ({
      action: "find_documents",
      args: {},
      filter: { conditions: [{ cost }] },
      unrecognised: [],
      notes: [],
    });

    const recognised = costRun("documents with a cost over $0.03 billed to Leeds");

    expect(
      mergeInterpretations(recognised.interpretation, model({ op: "gt", value: 3 }), recognised.segments).filter.conditions,
    ).toEqual([{ cost: { op: "gt", value: 0.03 } }]);

    const unread = costRun("documents billed to Leeds");

    expect(
      mergeInterpretations(unread.interpretation, model({ op: "lt", value: 1 }), unread.segments).filter.conditions,
    ).toEqual([{ cost: { op: "lt", value: 1 } }]);
  });
});

describe("negated values", () => {
  const notAcme = condition("tpl_invoice", "vendor", "is_not", "Acme");

  it.each([
    "delete invoices excluding Acme",
    "delete invoices except Acme",
    "delete invoices except for Acme",
    "delete invoices other than Acme",
    "delete invoices not from Acme",
    "delete invoices that aren't from Acme",
    "delete invoices that are not by Acme",
    "delete invoices without Acme",
    "delete invoices that isn't Acme",
    "delete invoices where vendor is not Acme",
    "delete invoices where vendor excluding acme",
  ])("reads %s as is not", (text) => {
    const { interpretation, complete } = run(text);

    expect(interpretation.filter.conditions).toEqual([
      { ...notAcme, value: /acme$/.test(text) ? "acme" : "Acme" },
    ]);
    expect(complete).toBe(true);
  });

  it("negates a typed value straight after a field", () => {
    expect(run("invoices where invoice number except HNH-1").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "invoice_number", "is_not", "HNH-1")],
    });
    // "without" before a field label still means the field is missing.
    expect(run("invoices without a vendor").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "vendor", "not_found")],
    });
  });

  it("asks when leaving a value out would also leave out other Templates", () => {
    const { interpretation, complete } = run("delete documents excluding Acme");

    expect(complete).toBe(false);
    expect(interpretation.filter.conditions).toEqual([notAcme]);
    expect(interpretation.notes).toContainEqual({
      kind: "unrecognised",
      text: "Only Invoice documents can leave out “Acme”, so others aren't included.",
    });
  });

  it("never searches for text the request excludes", () => {
    const { interpretation, complete, unused } = run('find documents without "draft"');

    expect(interpretation.filter.text).not.toBe("draft");
    expect(unused).toEqual(['without "draft"']);
    expect(complete).toBe(false);
  });

  it.each([
    ["delete documents except failed", ["except", "failed"]],
    ["delete documents not from last week", ["not", "from last week"]],
    ["delete documents except invoices from Acme", ["except", "invoices", "from Acme"]],
    ["delete invoices with Acme excluded", ["invoices", "Acme", "excluded"]],
    ["delete documents that aren't failed", ["aren't", "failed"]],
  ])("leaves out phrases after an unread negating word: %s", (text, words) => {
    const { interpretation, complete, unused } = run(text);
    const { statuses, template_ids: templateIds, conditions, uploaded_from: from } = interpretation.filter;

    expect({ statuses, templateIds, conditions, from }).toEqual({});
    expect(unused).toEqual(words);
    expect(complete).toBe(false);
  });
});

describe("date ranges", () => {
  it("keeps both ends of the review's example", () => {
    const { interpretation, complete } = run("find documents uploaded from 1 March 2026 to 31 March 2026");

    expect(interpretation.filter).toEqual({ uploaded_from: "2026-03-01", uploaded_to: "2026-03-31" });
    expect(complete).toBe(true);
    expect(resolveRelativeDate("from 1 March 2026 to 31 March 2026", TODAY)).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
    });
  });

  it.each([
    ["documents from 1 March 2026 until 31 March 2026", "2026-03-01", "2026-03-31"],
    ["documents from 1 March 2026 through 31 March 2026", "2026-03-01", "2026-03-31"],
    ["documents from 1 March 2026 till 31 March 2026", "2026-03-01", "2026-03-31"],
    ["documents uploaded between 1 March and 31 March 2026", "2026-03-01", "2026-03-31"],
    ["documents 1 March 2026 – 31 March 2026", "2026-03-01", "2026-03-31"],
    ["documents 1 March 2026–31 March 2026", "2026-03-01", "2026-03-31"],
    ["documents 2026-03-01 - 2026-03-31", "2026-03-01", "2026-03-31"],
    ["documents 1 March 2026 to 31 March 2026", "2026-03-01", "2026-03-31"],
    // Month and year boundaries
    ["documents from 30 January 2028 to 2 March 2028", "2028-01-30", "2028-03-02"],
    ["documents from February 2028 to March 2028", "2028-02-01", "2028-03-31"],
    ["documents from 1 Oct through 31 Oct", "2026-10-01", "2026-10-31"],
    ["documents from 1 December to 5 January", "2025-12-01", "2026-01-05"],
    ["documents from 20 December 2025 to 3 January", "2025-12-20", "2026-01-03"],
    ["documents from December 2025 to January 2026", "2025-12-01", "2026-01-31"],
    ["documents from 2024 to 2025", "2024-01-01", "2025-12-31"],
    ["documents from last week to today", "2026-10-05", TODAY],
  ])("reads the upload range %s", (text, from, to) => {
    const { interpretation, complete } = run(text);

    expect(interpretation.filter).toEqual({ uploaded_from: from, uploaded_to: to });
    expect(complete).toBe(true);
  });

  it("reads a range next to a date field as a field range", () => {
    expect(run("invoices issued from 1 March 2026 to 31 March 2026").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "issue_date", "between", "2026-03-01", "2026-03-31")],
    });
    expect(run("invoices issued 1 March 2026 – 31 March 2026").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "issue_date", "between", "2026-03-01", "2026-03-31")],
    });
    // Extracted dates may be in the future, so a range without years runs forward from this year.
    expect(run("invoices issued between 1 December and 5 January").interpretation.filter).toEqual({
      conditions: [condition("tpl_invoice", "issue_date", "between", "2026-12-01", "2027-01-05")],
    });
  });

  it.each([
    "documents from 31 March 2026 to 1 March 2026",
    "documents between 15 March 2026 and 1 March 2026",
    "documents 31 March 2026 – 1 March 2026",
    "invoices issued from 31 March 2026 to 1 March 2026",
    "invoices issued between 31 March 2026 and 1 March 2026",
  ])("leaves a reversed range unused instead of narrowing it to a day: %s", (text) => {
    const { interpretation, complete } = run(text);

    expect(complete).toBe(false);
    expect(interpretation.filter.uploaded_from).toBeUndefined();
    expect(interpretation.filter.uploaded_to).toBeUndefined();
    expect(interpretation.filter.conditions).toBeUndefined();
  });

  it("keeps bare numbers after between as numbers", () => {
    expect(run("purchase orders between 2000 and 2500").interpretation.filter).toEqual({
      conditions: [condition("tpl_po", "amount", "between", 2000, 2500)],
    });
  });
});

describe("one-letter values", () => {
  const number = (op, value) => condition("tpl_invoice", "invoice_number", op, value);

  it.each([
    ["invoices where the invoice number starts with A", [number("starts_with", "A")]],
    ["invoices where invoice number is A", [number("is", "A")]],
    ["invoices where invoice number contains a", [number("contains", "a")]],
    ["invoices where invoice number starts with A or B", [{ any: [number("starts_with", "A"), number("starts_with", "B")] }]],
    ["invoices where invoice number starts with an, uploaded last week", [number("starts_with", "an")]],
  ])("reads %s", (text, conditions) => {
    const { interpretation, complete } = run(text);

    expect(interpretation.filter.conditions).toEqual(conditions);
    expect(complete).toBe(true);
  });

  it("still reads an article before more words as the start of a phrase", () => {
    const { interpretation, complete } = run("invoices where invoice number is a long one");

    // Never "has a value": the parser leaves the phrase for the model.
    expect(interpretation.filter.conditions).not.toEqual([number("is", "a")]);
    expect(complete).toBe(false);
  });
});

describe("and and or", () => {
  const vendor = (op, value) => condition("tpl_invoice", "vendor", op, value);
  const total = (op, value) => condition("tpl_invoice", "total", op, value);

  it.each([
    ["find invoices with vendor Acme or vendor Globex Supplies", [{ any: [vendor("contains", "Acme"), vendor("contains", "Globex Supplies")] }]],
    ["find invoices from Acme or Globex Supplies", [{ any: [vendor("contains", "Acme"), vendor("contains", "Globex Supplies")] }]],
    // Known values are whole values, so "and" between two of them means either.
    ["find invoices from Acme and Globex Supplies", [{ any: [vendor("contains", "Acme"), vendor("contains", "Globex Supplies")] }]],
    ["invoices where vendor is Acme or Globex Supplies", [{ any: [vendor("is", "Acme"), vendor("is", "Globex Supplies")] }]],
    // Bare values after "or" or a comma take the operator before them.
    [
      "invoices where invoice number is X1, X2 or X3",
      [{ any: ["X1", "X2", "X3"].map((value) => condition("tpl_invoice", "invoice_number", "is", value)) }],
    ],
    [
      'invoices where invoice number starts with "ab" or "cd"',
      [{ any: ["ab", "cd"].map((value) => condition("tpl_invoice", "invoice_number", "starts_with", value)) }],
    ],
    ["invoices where total is 5 or 10 or 15", [{ any: [total("eq", 5), total("eq", 10), total("eq", 15)] }]],
    ["invoices with total under 10 or over 100", [{ any: [total("lt", 10), total("gt", 100)] }]],
    ["invoices with total over 10 and under 20", [total("gt", 10), total("lt", 20)]],
    ["invoices with total over 10, under 20", [total("gt", 10), total("lt", 20)]],
    // "and" binds tighter than "or".
    ["invoices with total over 10 and under 20 or over 100", [{ any: [{ all: [total("gt", 10), total("lt", 20)] }, total("gt", 100)] }]],
    ["invoices where total is over 500 or vendor is Acme", [{ any: [total("gt", 500), vendor("is", "Acme")] }]],
    [
      "invoices where vendor is Acme or total over 500 and paid",
      [{ any: [vendor("is", "Acme"), { all: [total("gt", 500), condition("tpl_invoice", "paid", "is_true")] }] }],
    ],
    // ...except that one field's values come together first.
    ["invoices where vendor is Acme or Globex Supplies and total over 100", [{ any: [vendor("is", "Acme"), vendor("is", "Globex Supplies")] }, total("gt", 100)]],
    [
      "invoices issued before 1 March 2026 or after 1 June 2026",
      [{ any: [condition("tpl_invoice", "issue_date", "lt", "2026-03-01"), condition("tpl_invoice", "issue_date", "gte", "2026-06-02")] }],
    ],
    // Excluding either value excludes both.
    ["invoices excluding Acme or Globex Supplies", [vendor("is_not", "Acme"), vendor("is_not", "Globex Supplies")]],
  ])("%s", (text, conditions) => {
    const { interpretation, complete, unused } = run(text);

    expect(interpretation.filter.conditions).toEqual(conditions);
    expect(unused).toEqual([]);
    expect(complete).toBe(true);
  });

  it("puts each field on the Template named before it", () => {
    const { interpretation, complete } = run("invoices with total over 100 or receipts with total over 50");

    expect(interpretation.filter).toEqual({
      conditions: [{ any: [total("gt", 100), condition("tpl_receipt", "total", "gt", 50)] }],
    });
    expect(complete).toBe(true);
    expect(run("receipts from Acme or invoices from Globex Supplies").interpretation.filter).toEqual({
      conditions: [{ any: [condition("tpl_receipt", "merchant", "contains", "Acme"), vendor("contains", "Globex Supplies")] }],
    });
    // Templates named together before the conditions are still ambiguous.
    expect(run("invoices and receipts with total over 100").complete).toBe(false);
  });

  it("only reports that nothing can match when no alternative can", () => {
    const { interpretation, complete } = run(
      "invoices where vendor is Acme and receipts where merchant is Acme or invoices with total over 5",
    );

    expect(interpretation.filter.conditions).toEqual([
      {
        any: [
          { all: [vendor("is", "Acme"), condition("tpl_receipt", "merchant", "is", "Acme")] },
          total("gt", 5),
        ],
      },
    ]);
    // The Receipt alternative needs two Templates at once, so only invoices can match. That is worth
    // saying, but it isn't "no document can match".
    expect(interpretation.notes).toEqual([
      { kind: "unrecognised", text: "The conditions only apply to Invoice, so Receipt is left out." },
    ]);
    expect(complete).toBe(false);
  });

  it("asks when Templates must match together", () => {
    const { interpretation, complete } = run("documents where vendor is Acme and merchant is Acme");

    expect(complete).toBe(false);
    expect(interpretation.notes).toContainEqual({
      kind: "unrecognised",
      text: "These conditions use fields from Invoice and Receipt, so no document can match.",
    });
  });

  it("describes groups, naming a field once", () => {
    const describe = (conditions) => describeFilter({ conditions }, catalog);

    expect(describe([{ any: [vendor("is", "Acme"), vendor("is", "Globex")] }, total("gt", 100)])).toBe(
      "Invoice › Vendor is “Acme” or is “Globex” · Invoice › Total over 100",
    );
    expect(describe([{ any: [vendor("is", "Acme"), { all: [total("gt", 500), total("lt", 600)] }] }])).toBe(
      "Invoice › Vendor is “Acme” or (Invoice › Total over 500 and under 600)",
    );
  });

  it.each([
    ["documents uploaded today or yesterday", ["uploaded today", "or", "yesterday"]],
    ["find failed or Acme invoices", ["failed", "or", "Acme"]],
    ["failed invoices or vendor is Acme", ["failed", "or", "vendor", "is Acme"]],
    ["invoices from Acme or uploaded last week", ["from Acme", "or", "uploaded last week"]],
  ])("never ANDs the two sides of %s", (text, words) => {
    const { interpretation, complete, unused } = run(text);

    expect(interpretation.filter.conditions).toBeUndefined();
    expect(interpretation.filter.statuses).toBeUndefined();
    expect(interpretation.filter.uploaded_from).toBeUndefined();
    expect(unused).toEqual(words);
    expect(complete).toBe(false);
  });

  it("lists statuses and Templates joined by or", () => {
    const statuses = run("find failed or completed documents");

    expect(statuses.interpretation.filter).toEqual({ statuses: ["failed", "completed"] });
    expect(statuses.complete).toBe(true);

    const templates = run("find invoices or receipts");

    expect(templates.interpretation.filter).toEqual({ template_ids: ["tpl_invoice", "tpl_receipt"] });
    expect(templates.complete).toBe(true);
  });

  it("asks about Templates joined by or when the action takes one Template", () => {
    const { complete, unused } = run("upload invoices or receipts");

    expect(complete).toBe(false);
    expect(unused).toEqual(["or"]);
  });
});

describe("mergeInterpretations with words the parser didn't read", () => {
  function local(text) {
    const segments = lexCommand(text, catalog, { workspaces });

    return { segments, ...interpretLocally(segments, catalog, { today: TODAY, workspaces }) };
  }

  const answer = (conditions, unrecognised = []) => ({
    action: "delete",
    args: {},
    filter: { conditions },
    unrecognised,
    notes: [],
  });

  const contains = condition("tpl_invoice", "vendor", "contains", "Acme");
  const notAcme = condition("tpl_invoice", "vendor", "is_not", "Acme");

  it("takes the model's correction of a condition next to an unread word", () => {
    const segments = lexCommand("delete invoices excluding Acme", catalog);

    // The parser's reading before it knew "excluding".
    const incomplete = {
      action: "delete",
      args: {},
      filter: { conditions: [contains] },
      unrecognised: ["excluding"],
      notes: [],
    };

    expect(mergeInterpretations(incomplete, answer([notAcme]), segments).filter.conditions).toEqual([notAcme]);

    const unknownWord = local("delete invoices bar Acme");

    expect(unknownWord.complete).toBe(false);
    expect(unknownWord.interpretation.filter.conditions).toEqual([contains]);
    expect(
      mergeInterpretations(unknownWord.interpretation, answer([notAcme]), unknownWord.segments).filter.conditions,
    ).toEqual([notAcme]);
  });

  it("never turns excluding Acme into contains Acme", () => {
    const excluded = local("delete invoices excluding Acme");

    expect(excluded.complete).toBe(true);
    expect(excluded.interpretation.filter.conditions).toEqual([notAcme]);
    // Even a model that misreads it can't override a fully recognised phrase.
    expect(
      mergeInterpretations(excluded.interpretation, answer([contains]), excluded.segments).filter.conditions,
    ).toEqual([notAcme]);
  });

  it("keeps a fully recognised condition when nothing was left unread", () => {
    const ambiguous = local("delete Acme");

    expect(ambiguous.complete).toBe(false);
    expect(ambiguous.interpretation.unrecognised).toEqual([]);

    const merged = mergeInterpretations(
      ambiguous.interpretation,
      answer([condition("tpl_invoice", "vendor", "is", "Acme")]),
      ambiguous.segments,
    );

    expect(merged.filter.conditions).toEqual([contains]);
  });

  it("only uses the model's conditions for an or the filter can't express", () => {
    const either = local("delete invoices from Acme or uploaded last week");

    expect(either.interpretation.filter.conditions).toBeUndefined();

    const one = condition("tpl_invoice", "vendor", "contains", "Acme");

    expect(
      mergeInterpretations(either.interpretation, answer([one], ["or uploaded last week"]), either.segments).filter.conditions,
    ).toEqual([one]);
  });

  it("lists only the words the model left unused, not the ones the parser couldn't read", () => {
    const { interpretation, segments } = local("delete invoices from Acme billed to Leeds");

    expect(interpretation.notes).toContainEqual({ kind: "unrecognised", text: "Not used: “billed”, “Leeds”." });

    const leeds = condition("tpl_invoice", "billing_address", "contains", "Leeds");
    const read = mergeInterpretations(interpretation, answer([contains, leeds]), segments);

    expect(read.notes.filter((note) => note.text.startsWith("Not used"))).toEqual([]);

    const partly = mergeInterpretations(interpretation, answer([contains], ["billed to Leeds"]), segments);

    expect(partly.notes.filter((note) => note.text.startsWith("Not used"))).toEqual([
      { kind: "unrecognised", text: "Not used: “billed to Leeds”." },
    ]);
  });

  it("keeps a group the parser read whole, and adds the model's groups on other fields", () => {
    const grouped = local("delete invoices from Acme or Globex Supplies billed to Leeds");
    const vendors = { any: [contains, condition("tpl_invoice", "vendor", "contains", "Globex Supplies")] };

    expect(grouped.interpretation.filter.conditions).toEqual([vendors]);

    const address = { any: [condition("tpl_invoice", "billing_address", "contains", "Leeds"), condition("tpl_invoice", "vendor", "is", "Leeds")] };

    // Unread words let the model's reading of a field replace the parser's.
    expect(mergeInterpretations(grouped.interpretation, answer([address]), grouped.segments).filter.conditions).toEqual([address]);

    const other = { any: [condition("tpl_invoice", "billing_address", "contains", "Leeds"), condition("tpl_invoice", "paid", "is_true")] };

    expect(mergeInterpretations(grouped.interpretation, answer([other]), grouped.segments).filter.conditions).toEqual([
      vendors,
      other,
    ]);
  });
});
