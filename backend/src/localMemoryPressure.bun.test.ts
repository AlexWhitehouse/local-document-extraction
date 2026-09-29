import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { registerLocalMemoryPressureListener } from "./localMemoryPressure";

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
