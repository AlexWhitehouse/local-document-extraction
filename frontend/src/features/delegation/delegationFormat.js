import { isBoolean, isNumber, isString } from "../../../../shared/json.ts";

// How the app identified itself to Studio. Only an operator-registered client is vouched for.
export function provenanceLabel(provenance) {
  if (provenance === "registered") return { tone: "neutral", label: "Registered app" };

  if (provenance === "metadata") return { tone: "neutral", label: "Published app details" };

  return { tone: "warning", label: "Unverified app" };
}

// The host an app names as its website. Shown as text, never as a link, because the app supplied it.
export function clientHost(uri) {
  if (!isString(uri) || !uri) return "";

  try {
    const url = new URL(uri);

    return url.protocol === "https:" || url.protocol === "http:" ? url.host : "";
  } catch {
    return "";
  }
}

export function clientName(client) {
  return (isString(client?.name) && client.name.trim()) || "This app";
}

export function formatDateTime(value) {
  if (!value) return "Never";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function scopeDescriptors(scopes) {
  const descriptors = new Map();

  for (const scope of Array.isArray(scopes) ? scopes : []) {
    if (isString(scope?.id)) descriptors.set(scope.id, scope);
  }

  return descriptors;
}

const SECRET_NAME = /secret|password|token|api[_-]?key|credential/i;

// Approval parameters arrive redacted. Anything named like a secret stays hidden regardless.
export function parameterRows(parameters) {
  if (!isPlainObject(parameters)) return [];

  return Object.entries(parameters).map(([name, value]) => ({
    name,
    value: SECRET_NAME.test(name) ? "Hidden" : displayValue(value),
  }));
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";

  if (isString(value) || isNumber(value) || isBoolean(value)) return String(value);

  return JSON.stringify(value);
}

function isPlainObject(value) {
  return Boolean(value) && Object.getPrototypeOf(value) === Object.prototype;
}
