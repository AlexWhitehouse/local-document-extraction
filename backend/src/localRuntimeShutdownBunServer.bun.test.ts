import { expect, test } from "bun:test";

import { createLocalRuntimeRequestDrain } from "./localRuntimeRequestDrain";
import { createLocalRuntimeShutdown } from "./localRuntimeShutdown";

test("runtime shutdown settles an in-flight request after closing idle server connections", async () => {
  const activeRequest = deferred<void>();
  const requestStarted = deferred<void>();
  const events: string[] = [];
  const requestDrain = createLocalRuntimeRequestDrain();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const pathname = new URL(request.url).pathname;
      return requestDrain.run(async () => {
        if (pathname === "/slow") {
          requestStarted.resolve();
          await activeRequest.promise;
          return new Response("completed");
        }
        return new Response("idle");
      });
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;

  try {
    expect(await (await fetch(`${origin}/idle`)).text()).toBe("idle");
    const slowResponse = fetch(`${origin}/slow`);
    await requestStarted.promise;

    const shutdown = createLocalRuntimeShutdown({
      closeAdmission: requestDrain.close,
      closeAuth: () => {
        events.push("auth:closed");
      },
      closeProductStores: () => {
        events.push("stores:closed");
      },
      closeQueue: async () => {},
      flushAnalytics: async () => {
        events.push("analytics:flushed");
      },
      stopRecurringWork: () => {},
      stopServer: (force) => {
        events.push(force ? "server:forced" : "server:graceful");
        return server.stop(force);
      },
    });

    const completed = shutdown.request();
    expect(requestDrain.snapshot()).toEqual({ accepting: false, active: 1 });
    activeRequest.resolve();

    expect(await (await slowResponse).text()).toBe("completed");
    await completed;
    expect(events).toEqual([
      "server:graceful",
      "analytics:flushed",
      "auth:closed",
      "stores:closed",
    ]);
  } finally {
    await server.stop(true);
  }
});

function deferred<T = void>(): { promise: Promise<T>; resolve(value?: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
