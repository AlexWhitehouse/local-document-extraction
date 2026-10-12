import { statusLabel } from "../../../lib/status.js";
import { Formatted } from "../../../lib/xlsx.js";
import { STAGES } from "./costConstants.js";
import { sumItemCosts } from "./costFormat.js";
import { fullyCosted } from "../../../../../shared/workspaceCosts.ts";

const STAGE_IDS = [...STAGES.map((stage) => stage.id), "total"];

const STAGE_COLUMNS = [...STAGES, { label: "Total" }].map((stage) => ({ header: stage.label, width: 18, format: "usd" }));

// Template groups are keyed by ID, so prefixes keep real templates apart from the synthetic rows.
const OVERHEAD = "overhead";

const PENDING = "pending";

const templateKey = (document) =>
  document.templateId ? `id:${document.templateId}` : document.template ? `name:${document.template}` : PENDING;

// Shares smaller than this are floating-point noise from dividing a split across documents.
const EPSILON = 1e-9;

const amounts = (costs) => STAGE_IDS.map((id) => costs[id]?.amount ?? null);

const complete = (costs) => (STAGE_IDS.every((id) => costs[id]?.complete !== false) ? "Yes" : "No");

const ratio = (amount, count) => (count && amount !== null ? amount / count : null);

const lastDay = (range) => new Date(Date.parse(range.end) - 86400000);

/** Day-stamped file name; the range end is exclusive. */
export const costExportFileName = (range) =>
  `costs-${range.start.slice(0, 10)}-to-${new Date(Date.parse(range.end) - 1).toISOString().slice(0, 10)}.xlsx`;

/**
 * One row per document. A split upload also gets a row for split cost not carried by its documents
 * (excluded or unassigned pages), so the rows add up to the upload's total. An upload without
 * documents yet appears as itself.
 */
export function documentRows(uploads) {
  return uploads.flatMap((upload) => {
    const uploaded = new Date(upload.created_at);

    if (!upload.children.length)
      return [
        {
          uploaded,
          upload,
          group: PENDING,
          name: upload.name,
          template: "",
          pages: upload.pages,
          status: upload.status,
          deleted: upload.deleted,
          costs: upload.costs,
        },
      ];

    const rows = upload.children.map((child) => ({
      uploaded,
      upload,
      group: templateKey(child),
      name: child.name,
      template: child.template,
      pages: child.pages,
      status: child.status,
      deleted: child.deleted,
      costs: child.costs,
    }));

    const carried = sumItemCosts(upload.children);

    const remainder = Object.fromEntries(
      STAGE_IDS.map((id) => [
        id,
        {
          ...upload.costs[id],
          amount: upload.costs[id].amount === null ? null : upload.costs[id].amount - (carried[id].amount ?? 0),
        },
      ]),
    );

    if (Math.abs(remainder.total.amount ?? 0) > EPSILON)
      rows.push({
        uploaded,
        upload,
        group: OVERHEAD,
        name: "Pages not in a document",
        template: "Split overhead",
        pages: Math.max(0, upload.pages - upload.children.reduce((sum, child) => sum + child.pages, 0)),
        status: upload.status,
        deleted: upload.deleted,
        costs: remainder,
      });

    return rows;
  });
}

function summarySheet({ overview, exported, label }) {
  const { totals, previous, range } = overview;
  const costs = totals.costs;
  const usd = (amount) => new Formatted(amount, "usd");
  const hourly = range.unit === "hour";

  const change =
    costs.total.complete && previous?.costs.total.complete && previous.costs.total.amount > 0
      ? (costs.total.amount - previous.costs.total.amount) / previous.costs.total.amount
      : null;

  const notes = [
    costs.total.complete ? null : "Some model calls have no reported cost, so totals are a minimum.",
    exported.updating ? "Cost history is still updating. Figures may be incomplete." : null,
    exported.truncated
      ? `The By template and Documents sheets cover only the first ${exported.uploads.length.toLocaleString("en-GB")} of ${exported.uploadCount.toLocaleString("en-GB")} uploads.`
      : null,
  ].filter(Boolean);

  return {
    name: "Summary",
    columns: [
      { header: "Item", width: 34 },
      { header: "Value", width: 22 },
    ],
    rows: [
      ["Period", label],
      ["From", new Formatted(new Date(range.start), hourly ? "datetime" : "date")],
      ["To", new Formatted(hourly ? new Date(range.end) : lastDay(range), hourly ? "datetime" : "date")],
      ["Total spend", usd(costs.total.amount)],
      ...STAGES.map((stage) => [stage.label, usd(costs[stage.id].amount)]),
      ["Uploads", exported.uploadCount],
      ["Documents", totals.documents],
      ["Pages", totals.pages],
      ["Average per document", usd(ratio(totals.fullyCostedAmount, totals.fullyCostedDocuments))],
      ["Average per page", usd(ratio(totals.fullyCostedAmount, totals.fullyCostedPages))],
      [hourly ? "Average per hour" : "Average per day", usd(ratio(costs.total.amount, overview.buckets.length))],
      ["Previous period spend", usd(previous?.costs.total.amount ?? null)],
      ["Change from previous period", new Formatted(change, "percent")],
      ["Exported", new Formatted(new Date(exported.generatedAt), "datetime")],
      ...notes.map((note) => ["Note", note]),
    ],
  };
}

function periodSheet({ buckets, range }) {
  const hourly = range.unit === "hour";

  return {
    name: hourly ? "Hourly" : "Daily",
    columns: [
      { header: hourly ? "Hour (UTC)" : "Date", width: 18, format: hourly ? "datetime" : "date" },
      { header: "Documents", width: 12 },
      { header: "Pages", width: 10 },
      ...STAGE_COLUMNS,
      { header: "Average per document", width: 22, format: "usd" },
      { header: "Costs complete", width: 16 },
    ],
    rows: buckets.map((bucket) => [
      new Date(`${bucket.date}T${hourly ? String(bucket.hour).padStart(2, "0") : "00"}:00:00Z`),
      bucket.documents,
      bucket.pages,
      ...amounts(bucket.costs),
      ratio(bucket.fullyCostedAmount, bucket.fullyCostedDocuments),
      complete(bucket.costs),
    ]),
  };
}

const GROUP_LABELS = { [OVERHEAD]: "Split overhead", [PENDING]: "No template yet" };

// Partial sheets say so in their tab name, since their totals come from capped rows.
const sheetName = (name, truncated) => (truncated ? `${name} (partial)` : name);

function templateSheet(rows, truncated) {
  const groups = new Map();

  for (const row of rows) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
  }

  const summaries = [...groups].map(([group, members]) => {
    const costs = sumItemCosts(members);
    const documents = group === OVERHEAD ? 0 : members.length;
    const pages = members.reduce((sum, member) => sum + member.pages, 0);
    const priced = group === OVERHEAD ? [] : members.filter(fullyCosted);
    const pricedAmount = priced.reduce((sum, member) => sum + member.costs.total.amount, 0);
    const pricedPages = priced.reduce((sum, member) => sum + member.pages, 0);
    // Rows are oldest first, so the newest name wins after a rename.
    const template = GROUP_LABELS[group] ?? members.at(-1).template;

    return {
      template,
      documents,
      pages,
      costs,
      perDocument: ratio(pricedAmount, priced.length),
      perPage: ratio(pricedAmount, pricedPages),
    };
  });

  summaries.sort((a, b) => (b.costs.total.amount ?? 0) - (a.costs.total.amount ?? 0));

  return {
    name: sheetName("By template", truncated),
    columns: [
      { header: "Template", width: 34 },
      { header: "Documents", width: 12 },
      { header: "Pages", width: 10 },
      ...STAGE_COLUMNS,
      { header: "Average per document", width: 22, format: "usd" },
      { header: "Average per page", width: 18, format: "usd" },
      { header: "Costs complete", width: 16 },
    ],
    rows: summaries.map(({ template, documents, pages, costs, perDocument, perPage }) => [
      template,
      documents,
      pages,
      ...amounts(costs),
      perDocument,
      perPage,
      complete(costs),
    ]),
  };
}

function documentSheet(rows, truncated) {
  return {
    name: sheetName("Documents", truncated),
    columns: [
      { header: "Uploaded (UTC)", width: 18, format: "datetime" },
      { header: "Upload", width: 34 },
      { header: "Document", width: 34 },
      { header: "Template", width: 26 },
      { header: "Pages", width: 10 },
      { header: "Status", width: 16 },
      { header: "Deleted", width: 10 },
      ...STAGE_COLUMNS,
      { header: "Costs complete", width: 16 },
    ],
    rows: rows.map((row) => [
      row.uploaded,
      row.upload.name,
      row.name,
      row.template,
      row.pages,
      statusLabel(row.status),
      row.deleted ? "Yes" : "No",
      ...amounts(row.costs),
      complete(row.costs),
    ]),
  };
}

/** Summary, per-period, per-template and per-document sheets for one date range. */
export function costWorkbookSheets({ overview, exported, label }) {
  const rows = documentRows(exported.uploads);

  return [summarySheet({ overview, exported, label }), periodSheet(overview), templateSheet(rows, exported.truncated), documentSheet(rows, exported.truncated)];
}
