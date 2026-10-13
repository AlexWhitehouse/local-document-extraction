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
