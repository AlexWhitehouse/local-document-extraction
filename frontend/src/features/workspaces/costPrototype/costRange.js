import { HISTORY_DAYS, NOW, TODAY, addDays } from "./sampleCosts.js";

export const PRESETS = [
  { value: "1d", label: "1D", days: 1 },
  { value: "7d", label: "7D", days: 7 },
  { value: "14d", label: "14D", days: 14 },
  { value: "30d", label: "30D", days: 30 },
];
export const EARLIEST = addDays(TODAY, -(HISTORY_DAYS - 1));

const HOUR = 3600 * 1000;
const iso = time => new Date(time).toISOString().replace(".000Z", "Z");

function hourBuckets(start) {
  return Array.from({ length: 24 }, (_, index) => {
    const from = new Date(start).getTime() + index * HOUR;
    return { key: iso(from).slice(0, 13), start: iso(from), end: iso(from + HOUR), date: iso(from).slice(0, 10), hour: new Date(from).getUTCHours() };
  });
}

function dayBuckets(from, to) {
  const buckets = [];
  for (let date = from; date <= to; date = addDays(date, 1)) buckets.push({ key: date, start: `${date}T00:00:00Z`, end: `${addDays(date, 1)}T00:00:00Z`, date });
  return buckets;
}

/**
 * 1D is the rolling 24 hours, bucketed by hour. Day presets end today. A one-day custom
 * range is bucketed by hour as well. Previous is the same length immediately before.
 */
export function resolveRange(range) {
  let buckets;
  let unit;
  if (range.preset === "1d") {
    const end = Math.floor(new Date(NOW).getTime() / HOUR) * HOUR + HOUR;
    buckets = hourBuckets(iso(end - 24 * HOUR));
    unit = "hour";
  } else if (range.preset === "custom" && range.from === range.to) {
    buckets = hourBuckets(`${range.from}T00:00:00Z`);
    unit = "hour";
  } else {
    const days = PRESETS.find(item => item.value === range.preset)?.days;
    buckets = range.preset === "custom" ? dayBuckets(range.from, range.to) : dayBuckets(addDays(TODAY, 1 - days), TODAY);
    unit = "day";
  }
  const start = buckets[0].start;
  const end = buckets.at(-1).end;
  const length = new Date(end) - new Date(start);
  const previousStart = iso(new Date(start).getTime() - length);
  return {
    unit, buckets, start, end,
    previous: previousStart >= `${EARLIEST}T00:00:00Z` ? { start: previousStart, end: start } : null,
    contains: item => item.created_at >= start && item.created_at < end,
    bucketOf: item => unit === "hour" ? item.created_at.slice(0, 13) : item.created_at.slice(0, 10),
  };
}

export function rangeLabel(range) {
  if (range.preset === "1d") return "Last 24 hours";
  if (range.preset !== "custom") return `Last ${PRESETS.find(item => item.value === range.preset).days} days`;
  return range.from === range.to ? range.from : `${range.from} to ${range.to}`;
}
