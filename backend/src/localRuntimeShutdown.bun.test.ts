import { expect, test } from "bun:test";

import { createLocalRuntimeShutdown } from "./localRuntimeShutdown";

test("Local Bun Runtime shutdown drains active work before durable resources close", async () => {
  const events: string[] = [];
  const admission = deferred();
  const extraction = deferred();
  const server = deferred();
  const analytics = deferred();
  const analyticsStarted = deferred();
  const shutdown = createLocalRuntimeShutdown({
    closeAdmission: () => {
      events.push("admission:closed");
      return admission.promise;
    },
    closeAuth: () => {
      events.push("auth:closed");
    },
    closeProductStores: () => {
      events.push("stores:closed");
    },
    closeQueue: () => {
      events.push("queue:closed");
      return extraction.promise;
    },
    flushAnalytics: () => {
      events.push("analytics:flushing");
      analyticsStarted.resolve();
      return analytics.promise;
    },
    stopRecurringWork: () => {
      events.push("recurring:stopped");
    },
    stopServer: (force) => {
      events.push(force ? "server:forced" : "server:graceful");
      return server.promise;
    },
  });

  const completed = shutdown.request();

  expect(events).toEqual([
    "admission:closed",
    "queue:closed",
    "recurring:stopped",
    "server:graceful",
  ]);

  admission.resolve();
  extraction.resolve();
  server.resolve();
  await analyticsStarted.promise;
  expect(events).toContain("analytics:flushing");
  expect(events).not.toContain("auth:closed");
  expect(events).not.toContain("stores:closed");

  analytics.resolve();
  await completed;
  expect(events).toEqual([
    "admission:closed",
    "queue:closed",
    "recurring:stopped",
    "server:graceful",
    "analytics:flushing",
    "auth:closed",
    "stores:closed",
  ]);
});

test("a repeated shutdown request forces the server without duplicating cleanup", async () => {
  const events: string[] = [];
  const server = deferred();
  let forceDeadline: (() => void) | undefined;
  const shutdown = createLocalRuntimeShutdown({
    cancelTimeout: () => {
      events.push("deadline:cancelled");
    },
    closeAdmission: async () => {},
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
    forceAfterMs: 250,
    scheduleTimeout: (handler, delayMs) => {
      events.push(`deadline:scheduled:${delayMs}`);
      forceDeadline = handler;
      return Symbol("deadline");
    },
    stopRecurringWork: () => {
      events.push("recurring:stopped");
    },
    stopServer: (force) => {
      events.push(force ? "server:forced" : "server:graceful");
      if (force) server.resolve();
      return server.promise;
    },
  });

  const first = shutdown.request();
  const second = shutdown.request();

  expect(second).toBe(first);
  expect(events).toEqual([
    "recurring:stopped",
    "server:graceful",
    "deadline:scheduled:250",
    "server:forced",
  ]);

  await first;
  forceDeadline?.();
  shutdown.request();
  expect(events).toEqual([
    "recurring:stopped",
    "server:graceful",
    "deadline:scheduled:250",
    "server:forced",
    "analytics:flushed",
    "auth:closed",
    "stores:closed",
    "deadline:cancelled",
  ]);
});

test("the shutdown deadline forces a stalled network stop", async () => {
  const events: string[] = [];
  const gracefulServer = deferred();
  let forceDeadline: (() => void) | undefined;
  const shutdown = createLocalRuntimeShutdown({
    closeAdmission: async () => {},
    closeAuth: () => {},
    closeProductStores: () => {},
    closeQueue: async () => {},
    flushAnalytics: async () => {},
    forceAfterMs: 500,
    scheduleTimeout: (handler) => {
      forceDeadline = handler;
      return Symbol("deadline");
    },
    stopRecurringWork: () => {},
    stopServer: (force) => {
      events.push(force ? "server:forced" : "server:graceful");
      return force ? undefined : gracefulServer.promise;
    },
  });

  const completed = shutdown.request();
  forceDeadline?.();
  await completed;

  expect(events).toEqual(["server:graceful", "server:forced"]);
});

test("shutdown waits for recurring runtime work before flushing analytics", async () => {
  const recurring = deferred();
  let analyticsFlushed = false;
  const shutdown = createLocalRuntimeShutdown({
    closeAdmission: async () => {},
    closeAuth: () => {},
    closeProductStores: () => {},
    closeQueue: async () => {},
    flushAnalytics: async () => {
      analyticsFlushed = true;
    },
    stopRecurringWork: () => recurring.promise,
    stopServer: () => {},
  });

  const completed = shutdown.request();
  await drainMicrotasks();
  expect(analyticsFlushed).toBe(false);

  recurring.resolve();
  await completed;
  expect(analyticsFlushed).toBe(true);
});

test("shutdown attempts every durable cleanup and reports all failures", async () => {
  const events: string[] = [];
  const shutdown = createLocalRuntimeShutdown({
    closeAdmission: async () => {
      throw new Error("admission drain failed");
    },
    closeAuth: () => {
      events.push("auth:closed");
      throw new Error("auth close failed");
    },
    closeProductStores: () => {
      events.push("stores:closed");
    },
    closeQueue: async () => {},
    flushAnalytics: async () => {
      events.push("analytics:flushed");
      throw new Error("analytics flush failed");
    },
    stopRecurringWork: () => {},
    stopServer: () => {},
  });

  let failure: unknown;
  try {
    await shutdown.request();
  } catch (error) {
    failure = error;
  }

  expect(events).toEqual(["analytics:flushed", "auth:closed", "stores:closed"]);
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors.map((error) => (error as Error).message)).toEqual([
    "admission drain failed",
    "analytics flush failed",
    "auth close failed",
  ]);
});

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}
