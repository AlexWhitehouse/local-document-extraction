import { expect, test } from "bun:test";
import { createByteBudget } from "./byteBudget";

test("byte reservations bound concurrent work and release capacity after cancellation or failure", async () => {
  const budget = createByteBudget(10);
  let release!: () => void;
  const active = budget.run(8, () => new Promise<void>((resolve) => { release = resolve; }));
  await Bun.sleep(1);
  const controller = new AbortController();
  let started = false;
  const cancelled = budget.run(5, async () => { started = true; }, controller.signal);
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  expect(started).toBe(false);
  release();
  await active;
  await expect(budget.run(10, async () => { throw new Error("failure"); })).rejects.toThrow("failure");
  await expect(budget.run(10, async () => "reused")).resolves.toBe("reused");
  await expect(budget.run(11, async () => {})).rejects.toThrow("byte budget");
});
