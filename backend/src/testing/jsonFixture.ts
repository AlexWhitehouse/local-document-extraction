import { isJsonArray, isJsonObject, isString, type JsonValue } from "../../../shared/json";

/** Read fixture members with runtime evidence instead of asserting an unparsed response contract. */
export function jsonPath(value: JsonValue | undefined, ...path: Array<string | number>): JsonValue | undefined {
  let current = value;

  for (const segment of path) {
    if (isString(segment)) {
      if (!isJsonObject(current)) throw new Error(`Expected an object before ${segment}`);
      current = current[segment];
    } else {
      if (!isJsonArray(current)) throw new Error(`Expected an array before index ${segment}`);
      current = current[segment];
    }
  }

  return current;
}

export function jsonObject(value: JsonValue | undefined) {
  if (!isJsonObject(value)) throw new Error("Expected a JSON object");

  return value;
}

export function jsonArray(value: JsonValue | undefined) {
  if (!isJsonArray(value)) throw new Error("Expected a JSON array");

  return value;
}

export function jsonText(value: JsonValue | undefined): string {
  if (!isString(value)) throw new Error("Expected JSON text");

  return value;
}
