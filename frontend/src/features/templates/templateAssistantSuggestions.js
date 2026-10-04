import {
  MAX_TEMPLATE_FIELDS,
  MAX_TEMPLATE_OBJECT_COLUMNS,
  SUGGESTION_LIMITS,
  isTableType,
  templateColumns,
  templateIdentity,
} from "../../../../shared/templateAssistant.ts";

const named = (field) => String(field?.name || "").trim();

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Conservative fallback suggestions from the draft and diagnostics; sample contents are unavailable here. */
export function suggestTemplateRequests({ draft, issues, action, job }) {
  const fields = Array.isArray(draft?.fields) ? draft.fields : [];
  const fieldName = (issue) => named(fields[issue.location.fieldIndex]) || `Field ${issue.location.fieldIndex + 1}`;

  const columnHeading = (issue) =>
    templateColumns(fields[issue.location.fieldIndex])[issue.location.columnIndex]?.heading ||
    `column ${issue.location.columnIndex + 1}`;

  const suggestions = [];
  const add = (id, label, reason, request = label) => suggestions.push({ id, label, request, reason });

  if (action === "explain") {
    if (issues.length)
      add("why-save", "Why won’t this Template save?", `${plural(issues.length, "problem")} found by the app`);

    for (const issue of issues) {
      if (issue.code === "field.duplicate_identity")
        add(
          `explain-${issue.id}`,
          `Why do two fields clash on “${templateIdentity(fieldName(issue))}”?`,
          `Fields ${issue.location.relatedFieldIndex + 1} and ${issue.location.fieldIndex + 1} share a key`,
        );

      if (issue.code === "field.type_unsupported")
        add(
          `explain-${issue.id}`,
          `Why isn’t “${fields[issue.location.fieldIndex]?.data_type}” a valid type?`,
          `Used by “${fieldName(issue)}”`,
        );

      if (issue.code === "template.multiple_tables")
        add(`explain-${issue.id}`, "Why is only one table allowed?", `“${fieldName(issue)}” is a second table`);

      if (issue.code === "column.description_required")
        add(
          `explain-${issue.id}`,
          `Why does the ${columnHeading(issue)} column need a description?`,
          `In “${fieldName(issue)}”`,
        );

      if (issue.code === "field.description_required" && named(fields[issue.location.fieldIndex]))
        add(
          `explain-${issue.id}`,
          `What should the “${fieldName(issue)}” instructions say?`,
          "It has no instructions yet",
        );
    }
  }

  suggestions.splice(4);

  const tables = fields.filter((field) => isTableType(field?.data_type));
  const table = tables.length === 1 && named(tables[0]) ? tables[0] : null;
  const columns = templateColumns(table);

  const dateField = fields.find(
    (field) =>
      field?.data_type === "date" && named(field) && !/day|dd|mm|month|yyyy|iso.?8601/i.test(field.description || ""),
  );

  const evidenceName = job ? job.original_filename || job.job_id : null;

  if (action === "explain") {
    if (job) {
      add(
        "job-result",
        `What can ${evidenceName} tell us about existing fields?`,
        `Review of version ${job.template_version} results, not verified answers`,
      );

      if (!job.source_available)
        add(
          "job-result-only",
          "What can you tell from the stored result alone?",
          "The original Source file isn’t available",
        );
    }

    if (!issues.length) {
      if (dateField)
        add(
          "date-order",
          `Is “${dateField.name}” clear about day and month order?`,
          "Review the date instructions for possible ambiguity",
        );

      if (table && !/page|continu/i.test(table.description || ""))
        add(
          "table-pages",
          `How will “${table.name}” handle tables that continue onto another page?`,
          `Review page handling for this ${plural(columns.length, "column")} table`,
        );

      const vague = fields.find(
        (field) => named(field) && field !== dateField && String(field.description || "").trim().length < 26,
      );

      if (vague)
        add(
          "vague",
          `Is “${vague.name}” specific enough to extract reliably?`,
          "Review its short instructions for possible ambiguity",
        );
    }
  } else if (
    table &&
    columns.length > 0 &&
    columns.length < MAX_TEMPLATE_OBJECT_COLUMNS &&
    fields.length <= MAX_TEMPLATE_FIELDS
  ) {
    // Inspect names and guidance for aliases; Unit Price does not capture a unit of measure.
    const hasColumn = (pattern) =>
      columns.some((column) => pattern.test(`${column?.heading || ""} ${column?.description || ""}`));

    const quantity = columns.find((column) =>
      /\b(quantity|qty|count)\b/i.test(`${column?.heading || ""} ${column?.description || ""}`),
    );

    const lineItems = /\b(line items?|products?|services?|invoice)\b/i.test(`${table.name} ${table.description || ""}`);

    if (lineItems && !hasColumn(/\b(description|item|product|service|sku)\b/i))
      add(
        "add-description",
        `Add a Description column to ${table.name}`,
        `Consider identifying the items in “${table.name}”`,
        `Add a Description column of type string to “${table.name}”. Extract the product or service description printed for each row; leave it empty when absent.`,
      );

    if (
      quantity &&
      !hasColumn(/\b(unit of measur(?:e|ement)|uom|measurement unit|pack size)\b/i) &&
      !columns.some((column) => /^units?$/i.test(String(column?.heading || "").trim()))
    )
      add(
        "add-uom",
        `Add a Unit of Measure column to ${table.name}`,
        `Consider capturing the unit alongside “${quantity.heading}”`,
        `Add a Unit of Measure column of type string to “${table.name}”. Extract the unit explicitly stated for each row's quantity, such as kg or hours; leave it empty when absent.`,
      );
  }

  const seen = new Set();

  return suggestions
    .filter(
      (suggestion) =>
        suggestion.label.length <= SUGGESTION_LIMITS.labelCharacters &&
        suggestion.request.length <= SUGGESTION_LIMITS.requestCharacters &&
        suggestion.reason.length <= SUGGESTION_LIMITS.reasonCharacters &&
        !seen.has(suggestion.label) &&
        seen.add(suggestion.label),
    )
    .slice(0, SUGGESTION_LIMITS.suggestions);
}
