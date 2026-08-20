import { expect, test } from "bun:test";

import { createLocalRuntimeRequestDrain } from "./localRuntimeRequestDrain";

test("closing runtime request handling waits for active work and rejects new handlers", async () => {
  const drain = createLocalRuntimeRequestDrain();
  const activeHandler = deferred<Response>();
  const first = drain.run(() => activeHandler.promise);
  expect(drain.snapshot()).toEqual({ accepting: true, active: 1 });

  let closed = false;
  const closing = drain.close().then(() => {
    closed = true;
  });
  expect(drain.snapshot()).toEqual({ accepting: false, active: 1 });
  expect(closed).toBe(false);

  let handledAfterClose = false;
  const rejected = await drain.run(() => {
    handledAfterClose = true;
    return new Response("unexpected");
  });
  expect(rejected.status).toBe(503);
  expect(await rejected.json()).toEqual({
    error: {
      code: "local_runtime_shutting_down",
      message: "The Local Bun Runtime is shutting down",
    },
  });
  expect(handledAfterClose).toBe(false);
  expect(closed).toBe(false);

  activeHandler.resolve(new Response("completed"));
  expect(await (await first).text()).toBe("completed");
  await closing;
  expect(closed).toBe(true);
  expect(drain.snapshot()).toEqual({ accepting: false, active: 0 });
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
