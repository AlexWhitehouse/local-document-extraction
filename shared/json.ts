/** Values carried by JSON payloads. Optional object members may be absent before encoding. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export type JsonObject = { [key: string]: JsonValue | undefined };

export function parseJson(text: string): JsonValue {
  // SAFETY: JSON.parse without a reviver produces only JSON primitives, arrays and objects.
  return JSON.parse(text) as JsonValue;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Narrow an already decoded JSON value without erasing its member types. */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isJsonArray(value: JsonValue | undefined): value is JsonValue[] {
  return Array.isArray(value);
}

/** Validate arbitrary external values before admitting them to a JSON contract. */
export function isJsonValue(value: unknown): value is JsonValue {
  const ancestors = new WeakSet<object>();

  function visit(candidate: unknown): candidate is JsonValue {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return true;

    if (typeof candidate === "number") return Number.isFinite(candidate);

    if (typeof candidate !== "object" || candidate === null || ancestors.has(candidate)) return false;

    if (
      !Array.isArray(candidate) &&
      Object.getPrototypeOf(candidate) !== Object.prototype &&
      Object.getPrototypeOf(candidate) !== null
    )
      return false;
    ancestors.add(candidate);

    try {
      return Array.isArray(candidate)
        ? candidate.every(visit)
        : Object.values(candidate).every((entry) => entry === undefined || visit(entry));
    } finally {
      ancestors.delete(candidate);
    }
  }

  return visit(value);
}
