import type { ProcessingCosts } from "./processingCosts";

export const COST_STAGES = ["split", "auto_template", "extraction"] as const;

export const COST_MAX_DAYS = 366;

export type CostRange = { start: string; end: string; unit: "hour" | "day" };

export type CostDocument = {
  id: string;
  kind: "document";
  name: string;
  template: string;
  templateId: string | null;
  pages: number;
  pageNumbers: number[];
  created_at: string;
  status: string;
  deleted: boolean;
  costs: ProcessingCosts;
  retried: boolean;
};

export type CostUpload = {
  id: string;
  kind: "document" | "packet";
  name: string;
  created_at: string;
  status: string;
  pages: number;
  pageNumbers: number[];
  excludedPages: number;
  excludedPageNumbers: number[];
  deleted: boolean;
  documentCount: number;
  costs: ProcessingCosts;
};

export type CostMetrics = {
  costs: ProcessingCosts;
  documents: number;
  pages: number;
  fullyCostedDocuments: number;
  fullyCostedPages: number;
  fullyCostedAmount: number;
};

export function costRangeDays(range: CostRange): string[] {
  const days: string[] = [];

  for (let time = Date.parse(range.start.slice(0, 10)); time < Date.parse(range.end); time += 86400000)
    days.push(new Date(time).toISOString().slice(0, 10));

  return days;
}

/** Whole UTC buckets keep each query bounded and allow exact rollup reads. End is exclusive. */
export function parseCostRange(start: string | null, end: string | null, unit: string | null): CostRange {
  const from = Date.parse(start ?? ""),
    to = Date.parse(end ?? "");

  const step = unit === "hour" ? 3600000 : 86400000;
  const utcDatePattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/;

  if (
    (unit !== "hour" && unit !== "day") ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    !utcDatePattern.test(start ?? "") ||
    !utcDatePattern.test(end ?? "") ||
    new Date(from).toISOString().slice(0, 10) !== start?.slice(0, 10) ||
    new Date(to).toISOString().slice(0, 10) !== end?.slice(0, 10) ||
    from % step ||
    to % step ||
    to <= from ||
    to - from > (unit === "hour" ? 24 * 3600000 : COST_MAX_DAYS * 86400000)
  ) {
    throw new RangeError("Choose whole UTC hours (up to 24) or days (up to 366). The end is exclusive.");
  }

  return { start: new Date(from).toISOString(), end: new Date(to).toISOString(), unit };
}
