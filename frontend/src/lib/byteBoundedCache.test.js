import { expect, it } from "vitest";
import { createByteBoundedCache } from "./byteBoundedCache";
import { createCompletedDocumentCache } from "./completedDocumentCache";

it("evicts the least recently read values within entry and byte limits", () => {
  const cache = createByteBoundedCache({ maxBytes: 30, maxEntries: 2 });
  cache.set("a", "123");
  cache.set("b", "123");
  expect(cache.get("a")).toBe("123");
  cache.set("c", "123");
  expect(cache.get("b")).toBeUndefined();
  expect(cache.values()).toEqual(["123", "123"]);
  expect(cache.set("a", "too large for this cache")).toBe(false);
  expect(cache.get("a")).toBeUndefined();
  expect(cache.get("c")).toBe("123");
  cache.delete("missing");
  cache.clear();
  expect(cache.values()).toEqual([]);
});

it("does not persist an oversized completed result or load an oversized legacy cache", () => {
  let raw = "{}";
  const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  const cache = createCompletedDocumentCache({ storage, maxBytes: 1000 });
  cache.store("ws", { job_id: "small", status: "completed", results: [] });
  expect(cache.store("ws", { job_id: "large", status: "completed", results: [{ answer: "x".repeat(1000) }] })).toBeNull();
  expect(cache.get("ws", "small")?.job_id).toBe("small");
  expect(raw.length * 2).toBeLessThan(1000);
  raw = JSON.stringify({ ws: [{ job_id: "old", status: "completed", results: [{ answer: "x".repeat(1000) }] }] });
  expect(createCompletedDocumentCache({ storage, maxBytes: 1000 }).get("ws", "old")).toBeNull();
});
