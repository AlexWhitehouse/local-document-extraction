import { isJsonObject, isNumber, isString, type JsonValue } from "../../shared/json";
import { dayMonthYearToIso, EXPORT_FORMATS, type ExportFormat } from "../../shared/documentSearch";
import { HttpError } from "./lib/http";
import { exportFilename } from "./jobExportWorkbook";
import type { LocalWorkspaceExtractionJobExport } from "./localWorkspaceProductStore";

export function readJobExportFormat(input: JsonValue | undefined): ExportFormat {
  const format = isJsonObject(input) ? input.format : undefined;

  if (format === undefined) return "xlsx";

  const known = EXPORT_FORMATS.find((candidate) => candidate === format);

  if (!known) throw new HttpError(400, "invalid_job_export", "format must be xlsx, csv or json");

  return known;
}

type TextExport = { body: string; contentType: string; filename: string };

/** Builds a CSV or JSON export of terminal jobs. The workbook format has its own worker. */
export function buildTextJobExport({
  format,
  generatedAt = new Date(),
  jobs,
  workspaceName,
}: {
  format: Exclude<ExportFormat, "xlsx">;
  generatedAt?: Date;
  jobs: LocalWorkspaceExtractionJobExport[];
  workspaceName: string;
}): TextExport {
  const ordered = [...jobs].sort(
    (left, right) => right.created_at.localeCompare(left.created_at) || right.job_id.localeCompare(left.job_id),
  );

  const filename = exportFilename(workspaceName, generatedAt, format);

  if (format === "json") {
    return {
      body: JSON.stringify({ generated_at: generatedAt.toISOString(), documents: ordered.map(jsonDocument) }, null, 2),
      contentType: "application/json; charset=utf-8",
      filename,
    };
  }

  return { body: csvDocument(ordered), contentType: "text/csv; charset=utf-8", filename };
}

function jsonDocument(job: LocalWorkspaceExtractionJobExport) {
  return {
    job_id: job.job_id,
    source_name: job.source_name,
    template_id: job.template_id,
    template_name: job.template_name,
    template_version: job.template_version,
    status: job.status,
    created_at: job.created_at,
    results: Object.fromEntries(
      job.results.map((result) => [
        result.field_id,
        { name: result.name, data_type: result.data_type, status: result.status, answer: result.answer },
      ]),
    ),
  };
}

type CsvColumn = { templateId: string; fieldId: string; heading: string };

const FIXED_HEADINGS = ["Document", "Template", "Version", "Status", "Uploaded"];

/** One row per document; field columns follow each Template's field order. */
function csvDocument(jobs: LocalWorkspaceExtractionJobExport[]): string {
  const severalTemplates = new Set(jobs.map((job) => job.template_id)).size > 1;
  const columns = new Map<string, CsvColumn>();

  for (const job of jobs) {
    for (const field of [...job.fields].sort((left, right) => left.position - right.position)) {
      const key = `${job.template_id}\u0000${field.id}`;

      if (columns.has(key)) continue;
      columns.set(key, {
        templateId: job.template_id,
        fieldId: field.id,
        heading: severalTemplates ? `${job.template_name} — ${field.name}` : field.name,
      });
    }
  }

  const lines = [[...FIXED_HEADINGS, ...[...columns.values()].map((column) => neutralizeFormula(column.heading))]];

  for (const job of jobs) {
    const results = new Map(job.results.map((result) => [result.field_id, result]));

    lines.push([
      neutralizeFormula(job.source_name ?? job.job_id),
      neutralizeFormula(job.template_name),
      String(job.template_version),
      job.status,
      job.created_at,
      ...[...columns.values()].map((column) => {
        const result = column.templateId === job.template_id ? results.get(column.fieldId) : undefined;

        return result ? csvValue(result.answer, result.data_type) : "";
      }),
    ]);
  }

  // A byte order mark lets spreadsheet applications read the file as UTF-8.
  return `\uFEFF${lines.map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvValue(answer: JsonValue, dataType: string): string {
  if (answer === null) return "";

  if (isNumber(answer)) return String(answer);

  if (isString(answer)) {
    const iso = dataType === "date" ? dayMonthYearToIso(answer) : null;

    return neutralizeFormula(iso ?? answer);
  }

  if (answer === true || answer === false) return String(answer);

  // Tables, objects and arrays are written as JSON text.
  return neutralizeFormula(JSON.stringify(answer));
}

/** Spreadsheet applications evaluate cells that start with these characters as formulas. */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
