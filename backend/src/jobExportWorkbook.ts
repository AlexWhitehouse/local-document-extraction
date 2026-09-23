import ExcelJS from "exceljs";

import type { DataType, FieldDefinition } from "./lib/types";
import type {
  LocalWorkspaceExtractionJobExport,
  LocalWorkspaceExtractionResult,
} from "./localWorkspaceProductStore";

const EXCEL_MAX_SHEET_NAME_LENGTH = 31;
const OBJECT_SCHEMA_START = "[[OBJECT_SCHEMA]]";
const OBJECT_SCHEMA_END = "[[/OBJECT_SCHEMA]]";
const TABLE_DATA_TYPE = "array<object>";
const HEADER_SEPARATOR = " — ";
const EXCEL_MAX_CELL_TEXT_LENGTH = 32_767;
const TRUNCATED_CELL_SUFFIX = "… [truncated]";

type ExportField = FieldDefinition & { position: number };

type ExportColumn = {
  key: string;
  heading: string;
  dataType?: DataType;
  path?: string[];
  statusTarget?: boolean;
};

type TemplateGroup = {
  key: string;
  templateId: string;
  templateName: string;
  templateVersion: number;
  fields: ExportField[];
  jobs: LocalWorkspaceExtractionJobExport[];
};

type TableAnswer = {
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
};

export type JobExportWorkbook = {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
};

export async function buildJobExportWorkbook({
  generatedAt = new Date(),
  jobs,
  workspaceName,
}: {
  generatedAt?: Date;
  jobs: LocalWorkspaceExtractionJobExport[];
  workspaceName: string;
}): Promise<JobExportWorkbook> {
  if (!jobs.length) {
    throw new Error("At least one exportable job is required");
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Document Extraction Studio";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;

  const groups = groupJobsByTemplateVersion(jobs);
  const templateVersionCounts = countTemplateVersions(groups);
  const usedSheetNames = new Set<string>();

  for (const group of groups) {
    const versionSuffix = (templateVersionCounts.get(group.templateId) || 0) > 1
      ? ` v${group.templateVersion}`
      : "";
    const groupLabel = `${group.templateName}${versionSuffix}`;
    addHeaderWorksheet({
      group,
      sheetName: uniqueSheetName(`${groupLabel}${HEADER_SEPARATOR}Headers`, usedSheetNames),
      workbook,
    });

    for (const field of group.fields) {
      if (field.data_type !== TABLE_DATA_TYPE || !hasCompletedFieldResult(group.jobs, field.id)) {
        continue;
      }
      addTableWorksheet({
        field,
        group,
        sheetName: uniqueSheetName(
          `${groupLabel}${HEADER_SEPARATOR}${field.name}`,
          usedSheetNames,
        ),
        workbook,
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    bytes: new Uint8Array(buffer),
    filename: exportFilename(workspaceName, generatedAt),
  };
}

function groupJobsByTemplateVersion(
  jobs: LocalWorkspaceExtractionJobExport[],
): TemplateGroup[] {
  const groups = new Map<string, TemplateGroup>();

  for (const job of jobs) {
    const key = `${job.template_id}::${job.template_version}`;
    const existing = groups.get(key);
    if (existing) {
      existing.jobs.push(job);
      continue;
    }
    groups.set(key, {
      key,
      templateId: job.template_id,
      templateName: job.template_name || job.template_id,
      templateVersion: job.template_version,
      fields: [...job.fields].sort((left, right) => left.position - right.position),
      jobs: [job],
    });
  }

  for (const group of groups.values()) {
    group.jobs.sort((left, right) => {
      const timestampOrder = String(right.created_at || "").localeCompare(
        String(left.created_at || ""),
      );
      return timestampOrder || right.job_id.localeCompare(left.job_id);
    });
  }

  return [...groups.values()].sort((left, right) => {
    const nameOrder = left.templateName.localeCompare(right.templateName, undefined, {
      sensitivity: "base",
    });
    return nameOrder || left.templateVersion - right.templateVersion ||
      left.templateId.localeCompare(right.templateId);
  });
}

function countTemplateVersions(groups: TemplateGroup[]): Map<string, number> {
  const versions = new Map<string, Set<number>>();
  for (const group of groups) {
    const existing = versions.get(group.templateId) || new Set<number>();
    existing.add(group.templateVersion);
    versions.set(group.templateId, existing);
  }
  return new Map([...versions].map(([templateId, values]) => [templateId, values.size]));
}

function addHeaderWorksheet({
  group,
  sheetName,
  workbook,
}: {
  group: TemplateGroup;
  sheetName: string;
  workbook: ExcelJS.Workbook;
}): void {
  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const extractionColumns = collectHeaderExtractionColumns(group);
  const columns: ExportColumn[] = [
    { key: "meta:job-id", heading: "Job ID" },
    { key: "meta:source-filename", heading: "Source Filename" },
    { key: "meta:source-page-count", heading: "Source Page Count", dataType: "number" },
    { key: "meta:job-status", heading: "Job Status" },
    { key: "meta:template-name", heading: "Template Name" },
    { key: "meta:template-id", heading: "Template ID" },
    { key: "meta:template-version", heading: "Template Version", dataType: "number" },
    { key: "meta:model-name", heading: "Model Name" },
    { key: "meta:created-at", heading: "Created At", dataType: "date" },
    { key: "meta:completed-at", heading: "Completed At", dataType: "date" },
    { key: "meta:error-code", heading: "Error Code" },
    { key: "meta:error-message", heading: "Error Message" },
    ...extractionColumns,
  ];
  setWorksheetColumns(worksheet, columns);

  for (const job of group.jobs) {
    const row: Record<string, unknown> = {
      "meta:job-id": job.job_id,
      "meta:source-filename": job.source_name,
      "meta:source-page-count": job.source_file_page_count,
      "meta:job-status": job.status,
      "meta:template-name": group.templateName,
      "meta:template-id": group.templateId,
      "meta:template-version": group.templateVersion,
      "meta:model-name": job.model_name,
      "meta:created-at": job.created_at,
      "meta:completed-at": job.completed_at,
      "meta:error-code": job.error_code,
      "meta:error-message": job.error_message,
    };
    const results = new Map(job.results.map((result) => [result.field_id, result]));

    for (const column of extractionColumns) {
      const fieldId = column.key.split(":", 2)[1] || "";
      const result = results.get(fieldId);
      row[column.key] = headerCellValue(result, column);
    }
    worksheet.addRow(row);
  }

  finishWorksheet(worksheet);
}

function collectHeaderExtractionColumns(group: TemplateGroup): ExportColumn[] {
  const columns: ExportColumn[] = [];

  for (const field of group.fields) {
    if (field.data_type === TABLE_DATA_TYPE) {
      continue;
    }
    if (field.data_type !== "object") {
      columns.push({
        key: `field:${field.id}`,
        heading: field.name,
        dataType: field.data_type,
        statusTarget: true,
      });
      continue;
    }

    const firstObjectColumnIndex = columns.length;
    const resultValues = group.jobs
      .map((job) => job.results.find((result) => result.field_id === field.id)?.answer)
      .filter((answer) => answer !== null && answer !== undefined);
    const discoveredPaths = new Map<
      string,
      { path: string[]; headingPath?: string[]; dataType?: DataType }
    >();
    const expectedColumns = readObjectSchemaColumns(field.description);
    for (const expected of expectedColumns) {
      const path = expected.path || [expected.key];
      discoveredPaths.set(pathKey(path), {
        path,
        headingPath: [expected.heading],
        dataType: expected.dataType,
      });
    }
    let needsParentColumn = resultValues.length === 0;

    for (const value of resultValues) {
      if (!isPlainObject(value) || Object.keys(value).length === 0) {
        needsParentColumn = true;
        continue;
      }
      for (const discovered of discoverObjectPaths(value)) {
        const key = pathKey(discovered.path);
        if (!discoveredPaths.has(key)) {
          discoveredPaths.set(key, discovered);
        }
      }
    }

    if (needsParentColumn || discoveredPaths.size === 0) {
      columns.push({
        key: `field:${field.id}:object`,
        heading: field.name,
        dataType: "object",
        path: [],
      });
    }
    for (const discovered of [...discoveredPaths.values()].sort((left, right) =>
      pathKey(left.path).localeCompare(pathKey(right.path), undefined, { sensitivity: "base" })
    )) {
      columns.push({
        key: `field:${field.id}:${pathKey(discovered.path)}`,
        heading: [
          field.name,
          ...(discovered.headingPath || discovered.path.map(readableObjectKey)),
        ].join(HEADER_SEPARATOR),
        dataType: discovered.dataType,
        path: discovered.path,
      });
    }
    if (columns[firstObjectColumnIndex]) {
      columns[firstObjectColumnIndex].statusTarget = true;
    }
  }

  return columns;
}

function headerCellValue(
  result: LocalWorkspaceExtractionResult | undefined,
  column: ExportColumn,
): unknown {
  if (!result) {
    return null;
  }
  if (result.answer === null || result.answer === undefined) {
    return column.statusTarget ? statusSentinel(result.status) : null;
  }
  if (!column.path) {
    return cellValue(result.answer, column.dataType);
  }
  if (column.path.length === 0) {
    return isPlainObject(result.answer) && Object.keys(result.answer).length === 0
      ? "{}"
      : null;
  }
  return cellValue(readPath(result.answer, column.path), column.dataType);
}

function addTableWorksheet({
  field,
  group,
  sheetName,
  workbook,
}: {
  field: ExportField;
  group: TemplateGroup;
  sheetName: string;
  workbook: ExcelJS.Workbook;
}): void {
  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const tableColumns = collectTableColumns(group.jobs, field);
  const columns: ExportColumn[] = [
    { key: "meta:job-id", heading: "Job ID" },
    { key: "meta:source-filename", heading: "Source Filename" },
    { key: "meta:row-number", heading: "Row Number", dataType: "number" },
    { key: "meta:table-status", heading: "Table Status" },
    ...tableColumns,
  ];
  setWorksheetColumns(worksheet, columns);

  for (const job of group.jobs) {
    if (job.status !== "completed") {
      continue;
    }
    const result = job.results.find((candidate) => candidate.field_id === field.id);
    if (!result) {
      continue;
    }
    const table = readTableAnswer(result.answer);
    if (table.rows.length === 0) {
      worksheet.addRow({
        "meta:job-id": job.job_id,
        "meta:source-filename": job.source_name,
        "meta:row-number": null,
        "meta:table-status": statusSentinel(result.status),
      });
      continue;
    }

    table.rows.forEach((sourceRow, index) => {
      const row: Record<string, unknown> = {
        "meta:job-id": job.job_id,
        "meta:source-filename": job.source_name,
        "meta:row-number": index + 1,
        "meta:table-status": null,
      };
      for (const column of tableColumns) {
        const sourceKey = column.path?.[0] || "";
        row[column.key] = cellValue(sourceRow[sourceKey], column.dataType);
      }
      worksheet.addRow(row);
    });
  }

  finishWorksheet(worksheet);
}

function hasCompletedFieldResult(
  jobs: LocalWorkspaceExtractionJobExport[],
  fieldId: string,
): boolean {
  return jobs.some(
    (job) => job.status === "completed" &&
      job.results.some((result) => result.field_id === fieldId),
  );
}

function collectTableColumns(
  jobs: LocalWorkspaceExtractionJobExport[],
  field: ExportField,
): ExportColumn[] {
  const columns = new Map<string, ExportColumn>();
  for (const expected of readObjectSchemaColumns(field.description)) {
    columns.set(expected.key, {
      ...expected,
      key: `table:${field.id}:${expected.key}`,
      path: [expected.key],
    });
  }

  const extras = new Set<string>();
  for (const job of jobs) {
    if (job.status !== "completed") {
      continue;
    }
    const result = job.results.find((candidate) => candidate.field_id === field.id);
    if (!result) {
      continue;
    }
    const table = readTableAnswer(result.answer);
    for (const answerColumn of table.columns) {
      const sourceKey = answerColumn.path?.[0] || answerColumn.key;
      if (!columns.has(sourceKey)) {
        columns.set(sourceKey, {
          ...answerColumn,
          key: `table:${field.id}:${sourceKey}`,
          path: [sourceKey],
        });
      }
    }
    for (const row of table.rows) {
      for (const sourceKey of Object.keys(row)) {
        if (!columns.has(sourceKey)) {
          extras.add(sourceKey);
        }
      }
    }
  }

  for (const sourceKey of [...extras].sort((left, right) => left.localeCompare(right))) {
    columns.set(sourceKey, {
      key: `table:${field.id}:${sourceKey}`,
      heading: sourceKey,
      path: [sourceKey],
    });
  }
  return [...columns.values()];
}

function readTableAnswer(answer: unknown): TableAnswer {
  if (Array.isArray(answer)) {
    return {
      columns: [],
      rows: answer.filter(isPlainObject),
    };
  }
  if (!isPlainObject(answer)) {
    return { columns: [], rows: [] };
  }
  const rows = Array.isArray(answer.rows) ? answer.rows.filter(isPlainObject) : [];
  const rawColumns = Array.isArray(answer.columns) ? answer.columns : [];
  const columns = rawColumns.flatMap((rawColumn, index): ExportColumn[] => {
    if (typeof rawColumn === "string" && rawColumn.trim()) {
      return [{
        key: rawColumn,
        heading: rawColumn,
        path: [rawColumn],
      }];
    }
    if (!isPlainObject(rawColumn)) {
      return [];
    }
    const sourceKey = String(rawColumn.key || index).trim();
    if (!sourceKey) {
      return [];
    }
    return [{
      key: sourceKey,
      heading: String(rawColumn.heading || sourceKey),
      dataType: readDataType(rawColumn.data_type || rawColumn.type),
      path: [sourceKey],
    }];
  });
  return { columns, rows };
}

function readObjectSchemaColumns(description: string): ExportColumn[] {
  const start = description.indexOf(OBJECT_SCHEMA_START);
  const end = description.indexOf(OBJECT_SCHEMA_END);
  if (start < 0 || end <= start) {
    return [];
  }
  const rawJson = description.slice(start + OBJECT_SCHEMA_START.length, end).trim();
  try {
    const schema = JSON.parse(rawJson) as { columns?: unknown };
    if (!Array.isArray(schema.columns)) {
      return [];
    }
    return schema.columns.flatMap((value): ExportColumn[] => {
      if (!isPlainObject(value)) {
        return [];
      }
      const key = String(value.key || "").trim();
      if (!key) {
        return [];
      }
      return [{
        key,
        heading: String(value.heading || key),
        dataType: readDataType(value.data_type || value.type),
        path: [key],
      }];
    });
  } catch {
    return [];
  }
}

function discoverObjectPaths(
  value: Record<string, unknown>,
  parent: string[] = [],
): Array<{ path: string[]; dataType?: DataType }> {
  const paths: Array<{ path: string[]; dataType?: DataType }> = [];
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    const child = value[key];
    const path = [...parent, key];
    if (isPlainObject(child) && Object.keys(child).length > 0) {
      paths.push(...discoverObjectPaths(child, path));
    } else {
      paths.push({ path });
    }
  }
  return paths;
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return null;
    }
    current = current[key];
  }
  return current;
}

function cellValue(value: unknown, dataType?: DataType): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value) || isPlainObject(value)) {
    return limitCellText(safeStringify(value));
  }
  if (dataType === "date" && typeof value === "string") {
    return limitCellText(isoDateText(value));
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "boolean") {
    return value;
  }
  return limitCellText(String(value));
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (typeof nestedValue === "bigint") {
      return nestedValue.toString();
    }
    if (nestedValue && typeof nestedValue === "object") {
      if (seen.has(nestedValue)) {
        return "[Circular]";
      }
      seen.add(nestedValue);
    }
    return nestedValue;
  });
  return serialized ?? String(value);
}

function limitCellText(value: string): string {
  if (value.length <= EXCEL_MAX_CELL_TEXT_LENGTH) {
    return value;
  }
  const maximumPrefixLength = EXCEL_MAX_CELL_TEXT_LENGTH - TRUNCATED_CELL_SUFFIX.length;
  let prefix = value.slice(0, maximumPrefixLength);
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    prefix = prefix.slice(0, -1);
  }
  return `${prefix}${TRUNCATED_CELL_SUFFIX}`;
}

function isoDateText(value: string): string {
  const raw = value.trim();
  const dayFirst = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dayFirst) {
    return `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}`;
  }
  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return isoDate ? `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}` : raw;
}

function statusSentinel(status: string): string {
  const normalized = String(status || "not_found")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return `[${normalized || "not_found"}]`;
}

function setWorksheetColumns(
  worksheet: ExcelJS.Worksheet,
  columns: ExportColumn[],
): void {
  worksheet.columns = columns.map((column) => ({
    header: column.heading,
    key: column.key,
    width: Math.min(Math.max(column.heading.length + 2, 12), 42),
  }));
}

function finishWorksheet(worksheet: ExcelJS.Worksheet): void {
  const header = worksheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "top", wrapText: true };
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: "top", wrapText: true };
    }
  });

  worksheet.columns.forEach((column) => {
    let width = Number(column.width || 12);
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const value = cell.value === null || cell.value === undefined ? "" : String(cell.value);
      width = Math.max(width, Math.min(value.length + 2, 42));
    });
    column.width = Math.min(Math.max(width, 12), 42);
  });

  if (worksheet.columnCount > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(worksheet.rowCount, 1), column: worksheet.columnCount },
    };
  }
}

function uniqueSheetName(label: string, usedNames: Set<string>): string {
  const cleaned = replaceControlCharacters(label)
    .replace(/[\\/*?:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s']+|[\s']+$/g, "") || "Export";
  let candidate = cleaned.slice(0, EXCEL_MAX_SHEET_NAME_LENGTH).replace(/[\s']+$/g, "") || "Export";
  let suffixNumber = 2;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    const suffix = ` (${suffixNumber})`;
    candidate = `${cleaned.slice(0, EXCEL_MAX_SHEET_NAME_LENGTH - suffix.length).trim()}${suffix}`;
    suffixNumber += 1;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

function replaceControlCharacters(value: string): string {
  return [...value]
    .map((character) => character.charCodeAt(0) < 32 ? " " : character)
    .join("");
}

function exportFilename(workspaceName: string, generatedAt: Date): string {
  const workspaceSlug = workspaceName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
  const timestamp = generatedAt.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  return `${workspaceSlug}-job-export-${timestamp}.xlsx`;
}

function pathKey(path: string[]): string {
  return path.join(".");
}

function readableObjectKey(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.map((word) => `${word[0]?.toUpperCase() || ""}${word.slice(1)}`).join(" ") || value;
}

function readDataType(value: unknown): DataType | undefined {
  const normalized = String(value || "").trim() as DataType;
  return ["string", "number", "boolean", "date", "object", "array", TABLE_DATA_TYPE]
    .includes(normalized)
    ? normalized
    : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
