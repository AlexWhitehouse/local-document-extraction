import { COST_MAX_DAYS } from "../../../../../shared/workspaceCosts.ts";

export const PRESETS = [
  { value: "1d", label: "1D", days: 1 },
  { value: "7d", label: "7D", days: 7 },
  { value: "14d", label: "14D", days: 14 },
  { value: "30d", label: "30D", days: 30 },
  { value: "12m", label: "12M", days: 365 },
];

const DAY = 86400000;

const date = (time) => new Date(time).toISOString().slice(0, 10);

export const todayUTC = () => date(Date.now());

export const addDays = (value, days) => date(Date.parse(value) + days * DAY);

export function validCustomRange(from, to, today = todayUTC()) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to) &&
    Number.isFinite(Date.parse(from)) &&
    Number.isFinite(Date.parse(to)) &&
    date(Date.parse(from)) === from &&
    date(Date.parse(to)) === to &&
    from <= to &&
    to <= today &&
    (Date.parse(to) - Date.parse(from)) / DAY < COST_MAX_DAYS
  );
}

export function resolveRange(range, now = Date.now()) {
  let start,
    end,
    unit = "day";

  if (range.preset === "1d") {
    end = Math.floor(now / 3600000) * 3600000 + 3600000;
    start = end - DAY;
    unit = "hour";
  } else if (range.preset === "custom") {
    if (!validCustomRange(range.from, range.to, date(now))) throw new Error("Choose a valid range of up to 366 days.");
    start = Date.parse(range.from);
    end = Date.parse(range.to) + DAY;

    if (range.from === range.to) unit = "hour";
  } else {
    end = Date.parse(date(now)) + DAY;
    const days = PRESETS.find((preset) => preset.value === range.preset)?.days ?? 30;
    start = end - days * DAY;

    if (range.preset === "12m") {
      const beginning = new Date(end);
      beginning.setUTCFullYear(beginning.getUTCFullYear() - 1);
      start = beginning.getTime();
    }
  }

  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), unit };
}

export function rangeLabel(range) {
  if (range.preset === "1d") return "Last 24 hours";

  if (range.preset === "12m") return "Last 12 months";

  if (range.preset !== "custom")
    return `Last ${PRESETS.find((preset) => preset.value === range.preset)?.days ?? 30} days`;

  return range.from === range.to ? range.from : `${range.from} to ${range.to}`;
}
