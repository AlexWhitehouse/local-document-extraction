import { isBoolean, isJsonObject } from "../../../../shared/json.ts";

export const display = (value) =>
  value === undefined || value === null
    ? "—"
    : isBoolean(value)
      ? value
        ? "Yes"
        : "No"
      : Array.isArray(value) || isJsonObject(value)
        ? JSON.stringify(value, null, 2)
        : String(value);

export const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

const compactDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 3,
});

const fullDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
});

/** Run cost in USD; "+" marks a known subtotal when some calls did not report cost. */
export const dollars = (cost, { full = false } = {}) => {
  if (!cost || cost.amount === null || !Number.isFinite(cost.amount)) return "Unavailable";
  const amount = (full ? fullDollars : compactDollars).format(cost.amount);

  return `${amount}${cost.complete ? "" : "+"}`;
};

export const percent = (ratio) => (ratio === null || ratio === undefined ? "—" : `${Math.round(ratio * 100)}%`);

export const templateLabel = (template) =>
  `${template.name}${template.source ? ` · fields v${template.source.version}` : ""}${template.source?.modified ? " · edited" : ""}`;
