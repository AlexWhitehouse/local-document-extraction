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

export const percent = (ratio) => (ratio === null || ratio === undefined ? "—" : `${Math.round(ratio * 100)}%`);
