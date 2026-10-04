import { expect, test } from "bun:test";
import { isJsonValue, parseJson, type JsonObject, type JsonValue } from "../../../shared/json";

test("JSON boundaries accept nested data and optional members without admitting executable or native values", () => {
  expect(isJsonValue(parseJson('{"items":[null,true,12,"text",{}]}'))).toBe(true);
  expect(isJsonValue({ optional: undefined, fields: [] })).toBe(true);

  for (const input of [
    undefined,
    Number.NaN,
    Infinity,
    1n,
    Symbol("value"),
    () => "value",
    new Date(),
    new Map(),
    { nested: () => "value" },
  ]) {
    expect(isJsonValue(input)).toBe(false);
  }
});

test("JSON validation rejects cycles while preserving shared subtrees", () => {
  const object: JsonObject = {};
  object.self = object;
  const array: JsonValue[] = [];
  array.push(array);
  expect(isJsonValue(object)).toBe(false);
  expect(isJsonValue(array)).toBe(false);
  const shared = { value: "same object in two places" };
  expect(isJsonValue({ first: shared, second: shared })).toBe(true);
});
