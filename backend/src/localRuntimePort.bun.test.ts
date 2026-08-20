import { expect, test } from "bun:test";

import { readLocalRuntimePort } from "./localRuntimePort";

test("the Local Bun Runtime accepts an operating-system-selected port", () => {
  expect(readLocalRuntimePort(undefined)).toBe(8787);
  expect(readLocalRuntimePort("0")).toBe(0);
  expect(readLocalRuntimePort("8788")).toBe(8788);
  expect(() => readLocalRuntimePort("-1")).toThrow();
  expect(() => readLocalRuntimePort("65536")).toThrow();
  expect(() => readLocalRuntimePort("not-a-port")).toThrow();
});
