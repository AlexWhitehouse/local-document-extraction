export const display = value => value === undefined || value === null ? "—" : typeof value === "boolean" ? (value ? "Yes" : "No") : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
export const seconds = ms => `${(ms / 1000).toFixed(1)}s`;
export const percent = ratio => ratio === null || ratio === undefined ? "—" : `${Math.round(ratio * 100)}%`;
