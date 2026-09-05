import { expect, test } from "bun:test";
import { createByteBudget } from "./byteBudget";

test("shrinking a reservation admits waiting work while retaining the remaining bytes", async () => {
  const budget = createByteBudget(10);
  const firstGate = Promise.withResolvers<void>();
  const secondGate = Promise.withResolvers<void>();
  const firstStarted = Promise.withResolvers<{ shrinkTo(bytes: number): void }>();
  const secondStarted = Promise.withResolvers<void>();
  const first = budget.run(8, async (reservation) => {
    firstStarted.resolve(reservation);
    await firstGate.promise;
  });
  const reservation = await firstStarted.promise;
  const second = budget.run(8, async () => {
    secondStarted.resolve();
    await secondGate.promise;
  });
  let thirdStarted = false;
  const third = budget.run(3, async () => { thirdStarted = true; });
  try {
    expect(() => reservation.shrinkTo(9)).toThrow("only shrink");
    reservation.shrinkTo(2);
    await secondStarted.promise;
    expect(thirdStarted).toBe(false);
    firstGate.resolve();
    await first;
    expect(thirdStarted).toBe(false);
    expect(() => reservation.shrinkTo(0)).toThrow("only shrink");
  } finally {
    firstGate.resolve();
    secondGate.resolve();
    await Promise.all([first, second, third]);
  }
  expect(thirdStarted).toBe(true);
  await expect(budget.run(10, async () => "reused")).resolves.toBe("reused");
});

test("failure after shrinking releases exactly the remaining reservation", async () => {
  const budget = createByteBudget(10);
  await expect(budget.run(10, async (reservation) => {
    reservation.shrinkTo(2);
    throw new Error("failed after preparation");
  })).rejects.toThrow("failed after preparation");
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const active = budget.run(10, async () => { started.resolve(); await gate.promise; });
  await started.promise;
  let waitingStarted = false;
  const waiting = budget.run(1, async () => { waitingStarted = true; });
  await Bun.sleep(1);
  expect(waitingStarted).toBe(false);
  gate.resolve();
  await Promise.all([active, waiting]);
  expect(waitingStarted).toBe(true);
});

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
