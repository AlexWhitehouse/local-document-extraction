import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { createLinuxMemoryPressureVerifier, registerLocalMemoryPressureListener } from "./localMemoryPressure";

test("Linux ignores spurious PSI startup events but forwards accumulated stalls and low headroom", () => {
  let reading = { stalls: { host: 50_000_000, container: 1_000_000 }, lowHeadroom: false };
  const verify = createLinuxMemoryPressureVerifier(() => reading);
  reading = { ...reading, stalls: { host: 50_000_100, container: 1_000_100 } };
  expect(verify()).toBe(false);
  reading = { ...reading, stalls: { host: 50_100_000, container: 1_150_000 } };
  expect(verify()).toBe(true);
  expect(verify()).toBe(false);
  reading = { ...reading, lowHeadroom: true };
  expect(verify()).toBe(true);
});

test("Linux pressure verification forwards events when counters disappear, reset, or cannot be read", () => {
  let reading: { stalls: Record<string, number>; lowHeadroom: boolean } | null = {
    stalls: { host: 10 },
    lowHeadroom: false,
  };

  const verify = createLinuxMemoryPressureVerifier(() => reading);
  reading = { stalls: { host: 0 }, lowHeadroom: false };
  expect(verify()).toBe(true);
  reading = { stalls: {}, lowHeadroom: false };
  expect(verify()).toBe(true);
  reading = null;
  expect(verify()).toBe(true);
});

test("the runtime memory-pressure listener forwards supported levels and removes itself idempotently", async () => {
  const emitter = new EventEmitter();
  const levels: string[] = [];

  const remove = registerLocalMemoryPressureListener({
    emitter,
    onPressure: async (level) => {
      levels.push(level);
    },
  });

  expect(emitter.listenerCount("memoryPressure")).toBe(1);
  emitter.emit("memoryPressure", "warning");
  emitter.emit("memoryPressure", "critical");
  await Promise.resolve();
  expect(levels).toEqual(["warning", "critical"]);

  remove();
  remove();
  expect(emitter.listenerCount("memoryPressure")).toBe(0);
  emitter.emit("memoryPressure", "critical");
  await Promise.resolve();
  expect(levels).toEqual(["warning", "critical"]);
});
