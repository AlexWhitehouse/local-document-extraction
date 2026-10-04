import { sumCosts } from "../../../../../shared/processingCosts.ts";
import { STAGES } from "./sampleCosts.js";

/** Three significant digits below $1 so sub-cent document costs stay comparable. */
export function usd(amount) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—";
  if (amount === 0) return "$0.00";
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  if (amount < 0.0001) return "<$0.0001";
  if (amount >= 0.1) return `$${amount.toFixed(3).replace(/0$/, "")}`;
  return `$${amount.toPrecision(3)}`;
}

/** Production semantics: + marks a known subtotal, unavailable is never zero. */
export function costLabel(cost, unavailable = "Unavailable") {
  if (!cost || cost.amount === null) return unavailable;
  return `${usd(cost.amount)}${cost.complete ? "" : "+"}`;
}

export const percent = value => `${Math.round(value * 100)}%`;
export const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function sumItemCosts(items) {
  return Object.fromEntries([...STAGES, { id: "total" }].map(stage => [stage.id, sumCosts(items.map(item => item.costs[stage.id]))]));
}

export function shortDate(date) {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  return sorted[low] + (sorted[Math.min(low + 1, sorted.length - 1)] - sorted[low]) * (position - low);
}

export function niceMax(value) {
  if (!value) return 1;
  const step = 10 ** Math.floor(Math.log10(value));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(multiple => multiple * step).find(candidate => candidate >= value);
}
