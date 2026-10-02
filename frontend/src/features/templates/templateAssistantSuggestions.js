import { isTableType, templateColumns, templateIdentity } from "../../../../shared/templateAssistant.ts";

const named = field => String(field?.name || "").trim();
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Request suggestions from the open draft, its problems and any chosen evidence. Opening the panel never calls a model. */
export function suggestTemplateRequests({ draft, issues, action, job, file }) {
  const fields = Array.isArray(draft?.fields) ? draft.fields : [];
  const fieldName = issue => named(fields[issue.location.fieldIndex]) || `Field ${issue.location.fieldIndex + 1}`;
  const columnHeading = issue => templateColumns(fields[issue.location.fieldIndex])[issue.location.columnIndex]?.heading || `column ${issue.location.columnIndex + 1}`;
  const hasNamedFields = fields.some(named);
  const suggestions = [];
  const add = (id, label, reason, request = label) => suggestions.push({ id, label, request, reason });

  if (action === "explain") {
    if (issues.length) add("why-save", "Why won’t this Template save?", `${plural(issues.length, "problem")} found by the app`);
    for (const issue of issues) {
      if (issue.code === "field.duplicate_identity") add(`explain-${issue.id}`, `Why do two fields clash on “${templateIdentity(fieldName(issue))}”?`, `Fields ${issue.location.relatedFieldIndex + 1} and ${issue.location.fieldIndex + 1} share a key`);
      if (issue.code === "field.type_unsupported") add(`explain-${issue.id}`, `Why isn’t “${fields[issue.location.fieldIndex]?.data_type}” a valid type?`, `Used by “${fieldName(issue)}”`);
      if (issue.code === "template.multiple_tables") add(`explain-${issue.id}`, "Why is only one table allowed?", `“${fieldName(issue)}” is a second table`);
      if (issue.code === "column.description_required") add(`explain-${issue.id}`, `Why does the ${columnHeading(issue)} column need a description?`, `In “${fieldName(issue)}”`);
      if (issue.code === "field.description_required" && named(fields[issue.location.fieldIndex])) add(`explain-${issue.id}`, `What should the “${fieldName(issue)}” instructions say?`, "It has no instructions yet");
    }
  } else if (hasNamedFields) {
    if (issues.length > 1) add("fix-all", `Fix all ${plural(issues.length, "problem")}`, "Proposes the smallest change for each one", `Fix all ${plural(issues.length, "problem")} so the Template can save`);
    for (const issue of issues) {
      if (issue.code === "field.description_required") add(`fix-${issue.id}`, `Add instructions for “${fieldName(issue)}”`, "Blocks saving", `Fix the missing instructions for “${fieldName(issue)}”`);
      if (issue.code === "field.duplicate_identity") add(`fix-${issue.id}`, `Rename the second “${fieldName(issue)}”`, `Same key as Field ${issue.location.relatedFieldIndex + 1}`, `Fix the duplicate “${fieldName(issue)}” field`);
      if (issue.code === "field.type_unsupported") add(`fix-${issue.id}`, `Make “${fieldName(issue)}” a supported type`, `“${fields[issue.location.fieldIndex]?.data_type}” isn’t supported`, `Fix the unsupported type on “${fieldName(issue)}”`);
      if (issue.code === "template.multiple_tables") add(`fix-${issue.id}`, `Turn “${fieldName(issue)}” into a List`, "Only one table is allowed", `Fix the extra table “${fieldName(issue)}”`);
      if (issue.code === "column.description_required") add(`fix-${issue.id}`, `Describe the ${columnHeading(issue)} column`, `In “${fieldName(issue)}”`, `Fix the missing description on ${columnHeading(issue)}`);
    }
  }
  suggestions.splice(4);

  const table = fields.find(field => isTableType(field?.data_type) && named(field));
  const columns = templateColumns(table).map(column => String(column?.heading || ""));
  const hasColumn = pattern => columns.some(heading => pattern.test(heading));
  const dateField = fields.find(field => field?.data_type === "date" && named(field) && !/day|dd\/mm|month/i.test(field.description || ""));
  const evidenceName = job ? job.original_filename || job.job_id : null;

  if (action === "explain") {
    if (job) {
      add("job-result", `Why did ${evidenceName} come out this way?`, `Uses the stored result from version ${job.template_version}`);
      if (!job.source_available) add("job-result-only", "What can you tell from the stored result alone?", "The original Source file isn’t available");
    }
    if (file) add("sample-missing", `Does ${file.name} show anything this Template misses?`, "Reads the attached sample");
    if (!hasNamedFields) {
      add("empty-start", "What does a Template need before it can save?", "This draft is empty");
      add("empty-names", "How should I choose field names?", "Names become output keys");
      add("empty-table", "When should I use a Table instead of a List?", "Only one table is allowed");
    } else if (!issues.length) {
      if (dateField) add("date-order", `Is “${dateField.name}” clear about day and month order?`, "Its instructions don’t say");
      if (table) add("table-pages", `How will “${table.name}” handle tables that continue onto another page?`, `${plural(columns.length, "column")}, no guidance on page breaks`);
      const vague = fields.find(field => named(field) && field !== dateField && String(field.description || "").trim().length < 26);
      if (vague) add("vague", `Is “${vague.name}” specific enough to extract reliably?`, vague.description ? `Instructions are only “${String(vague.description).trim()}”` : "It has no instructions");
    }
  } else {
    if (!hasNamedFields) {
      const start = file ? `seen in ${file.name}` : "a common starting point";
      add("start-number", "Add a Document Number field", `Empty draft · ${start}`);
      add("start-date", "Add a Document Date field", `Empty draft · ${start}`);
      add("start-total", "Add a Total Amount field", `Empty draft · ${start}`);
    }
    if (table && hasColumn(/price|amount|total/i) && !hasColumn(/vat|tax/i)) add("vat", "Add VAT rate to each line item", `“${table.name}” has prices but no VAT column`);
    if (dateField) add("day-first", "Dates are day-first", `“${dateField.name}” doesn’t say which order dates use`);
    if (table && columns.length && !hasColumn(/description|item|product/i)) add("add-description", `Add a Description column to ${table.name}`, `Rows only have ${columns.join(" and ")}`);
    if (table && hasColumn(/quantity|qty/i) && !hasColumn(/unit|uom/i)) add("add-uom", `Add a Unit of Measure column to ${table.name}`, "Quantities have no unit");
    const vendor = fields.find(field => /^vendor/i.test(named(field)));
    if (vendor) add("rename-vendor", `Rename ${vendor.name} to Supplier Name`, "Only if your Documents say “Supplier”. Changes the output key");
  }
  const seen = new Set();
  return suggestions.filter(suggestion => !seen.has(suggestion.label) && seen.add(suggestion.label)).slice(0, 6);
}
