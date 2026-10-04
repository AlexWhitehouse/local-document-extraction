import { describe, expect, it, vi } from "vitest";
import { createResultCache } from "./resultCache.js";
import { FakeKeyRange, createFakeIndexedDB } from "../../test/fakeIndexedDB.js";

const detail = {
  raw: [{ field_id: "total", status: "ok", answer: "SECRET-INVOICE-4242" }],
  values: { total: "SECRET-INVOICE-4242" },
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("Temporary Evaluation result cache", () => {
  it("round-trips encrypted details and stores no plaintext or key material", async () => {
    const database = createFakeIndexedDB();
    const generateKey = vi.spyOn(crypto.subtle, "generateKey");
    const cache = createResultCache({ indexedDB: database, keyRange: FakeKeyRange, hotLimit: 1 });
    await cache.put("one", detail);
    await cache.put("two", { raw: [] });
    expect(cache.peek("one")).toBeNull(); // evicted from the hot set, still retained encrypted
    expect(await cache.load("one")).toEqual(detail);
    const stored = database.records();
    expect(stored.map((record) => Object.keys(record).sort())).toEqual([
      ["data", "iv", "namespace", "recordId"],
      ["data", "iv", "namespace", "recordId"],
    ]);
    const serialized = JSON.stringify(stored) + stored.map((record) => new TextDecoder().decode(record.data)).join("");
    expect(serialized).not.toContain("SECRET-INVOICE");
    expect(
      stored.some((record) => Object.values(record).some((value) => value?.constructor?.name === "CryptoKey")),
    ).toBe(false);
    expect(generateKey).toHaveBeenCalledWith({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  });
  it("uses a unique IV for every write, including rewrites of the same record", async () => {
    const database = createFakeIndexedDB();
    const cache = createResultCache({ indexedDB: database, keyRange: FakeKeyRange });
    await Promise.all(Array.from({ length: 20 }, (_, i) => cache.put(`r${i % 5}`, { raw: [i] })));
    const ivs = database.writes.map((record) => hex(record.iv));
    expect(ivs).toHaveLength(20);
    expect(new Set(ivs).size).toBe(20);
    expect(database.writes.every((record) => record.iv.length === 12)).toBe(true);
  });
  it("binds ciphertext to its namespace and record, so moved or corrupted records are rejected", async () => {
    const database = createFakeIndexedDB();
    const cache = createResultCache({ indexedDB: database, keyRange: FakeKeyRange, hotLimit: 0 });
    await cache.put("one", detail);
    await cache.put("two", { raw: [] });
    const records = database.stores.get("records").records;
    const [first, second] = [...records.values()];
    first.value.data = second.value.data;
    first.value.iv = second.value.iv;
    await expect(cache.load("one")).rejects.toMatchObject({ code: "corrupt" });
    await expect(cache.load("missing")).rejects.toMatchObject({ code: "missing" });
  });
  it("reports storage failures explicitly and drops the unretained detail", async () => {
    const database = createFakeIndexedDB();
    database.failWrites = "QuotaExceededError";
    const cache = createResultCache({ indexedDB: database, keyRange: FakeKeyRange });
    await expect(cache.put("one", detail)).rejects.toMatchObject({ code: "quota" });
    expect(cache.peek("one")).toBeNull();
    await expect(createResultCache({ indexedDB: undefined }).put("x", detail)).rejects.toMatchObject({
      code: "unavailable",
    });
    database.failWrites = null;
    await expect(cache.probe()).resolves.toBeUndefined();
  });
  it("bounds pending writes in bytes", async () => {
    const database = createFakeIndexedDB();
    const cache = createResultCache({ indexedDB: database, keyRange: FakeKeyRange, pendingLimit: 10 });
    const write = cache.put("big", { raw: ["x".repeat(50)] });
    expect(cache.hasCapacity()).toBe(false);
    let drained = false;
    cache.drained().then(() => {
      drained = true;
    });
    await write;
    await Promise.resolve();
    expect(drained).toBe(true);
    expect(cache.hasCapacity()).toBe(true);
  });
  it("invalidates synchronously, then deletes only its own namespace", async () => {
    const database = createFakeIndexedDB();
    const mine = createResultCache({ indexedDB: database, keyRange: FakeKeyRange });
    const other = createResultCache({ indexedDB: database, keyRange: FakeKeyRange });
    await mine.put("one", detail);
    await other.put("one", { raw: ["other tab"] });
    const late = mine.put("late", detail);
    mine.invalidate();
    expect(mine.peek("one")).toBeNull();
    await expect(mine.load("one")).rejects.toMatchObject({ code: "invalidated" });
    await expect(late).rejects.toMatchObject({ code: "invalidated" });
    await settle();
    expect(database.records().map((record) => record.namespace)).toEqual([other.namespace]);
    expect(await other.load("one")).toEqual({ raw: ["other tab"] });
    expect(mine.namespace).not.toBe(other.namespace);
  });
  it("deletes a record only after its in-flight write settles, so a removed result cannot reappear", async () => {
    const database = createFakeIndexedDB();
    const cache = createResultCache({ indexedDB: database, keyRange: FakeKeyRange });
    const writing = cache.put("previous", detail);
    cache.remove("previous");
    await writing;
    await settle();
    expect(database.records().filter((record) => record.recordId === "previous")).toEqual([]);
  });
  it("opens storage again on retry after a failed open", async () => {
    const database = createFakeIndexedDB();
    let failures = 1;

    const flaky = {
      open: (...args) => {
        if (failures-- <= 0) return database.open(...args);
        const request = { error: Object.assign(new Error("Open failed"), { name: "UnknownError" }) };
        setTimeout(() => request.onerror?.(), 0);

        return request;
      },
    };

    const cache = createResultCache({ indexedDB: flaky, keyRange: FakeKeyRange });
    await expect(cache.put("one", detail)).rejects.toMatchObject({ code: "unavailable" });
    await cache.probe();
    await cache.put("one", detail);
    expect(await cache.load("one")).toEqual(detail);
  });
});
