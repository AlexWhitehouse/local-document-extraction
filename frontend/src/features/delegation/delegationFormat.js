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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Where Studio sends the authorization result. The server reads it from the signed request,
// so unlike the app's name and website it is the address that actually receives access.
export function callbackDestination(uri) {
  if (!isString(uri) || !uri) return null;

  try {
    const url = new URL(uri);

    if (url.username || url.password) return null;

    return {
      host: url.host || url.protocol.slice(0, -1),
      url: url.href,
      local: LOOPBACK_HOSTS.has(url.hostname),
    };
  } catch {
    return null;
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

// Yes/no switches whose names look like secrets. Only a boolean value is shown.
const SECRET_NAMED_FLAGS = new Set(["replace_api_key"]);

function isHiddenParameter(name, value) {
  return SECRET_NAME.test(name) && !(SECRET_NAMED_FLAGS.has(name) && isBoolean(value));
}

// Approval parameters arrive redacted. Anything named like a secret stays hidden regardless,
// including inside nested values.
export function parameterRows(parameters) {
  if (!isPlainObject(parameters)) return [];

  return Object.entries(parameters).map(([name, value]) => ({
    name,
    value: isHiddenParameter(name, value) ? "Hidden" : displayValue(value),
  }));
}

// The Model gateway address a configuration change sends documents and the API key to.
export function approvalGatewayUrl(parameters) {
  const url = isPlainObject(parameters) && isPlainObject(parameters.configuration) ? parameters.configuration.gateway_url : null;

  return isString(url) ? url : "";
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";

  if (isBoolean(value)) return value ? "Yes" : "No";

  if (isString(value) || isNumber(value)) return String(value);

  return JSON.stringify(value, (key, nested) => (key && isHiddenParameter(key, nested) ? "Hidden" : nested));
}

function isPlainObject(value) {
  return Boolean(value) && Object.getPrototypeOf(value) === Object.prototype;
}
