export function createLocalRuntimeShutdown({
  cancelTimeout = (timer) => clearTimeout(timer),
  closeAdmission,
  closeAuth,
  closeProductStores,
  closeQueue,
  flushAnalytics,
  forceAfterMs = 10_000,
  scheduleTimeout = (handler, delayMs) => {
    const timer = setTimeout(handler, delayMs);
    timer.unref?.();

    return timer;
  },
  stopRecurringWork,
  stopServer,
}: {
  cancelTimeout?: (timer: ReturnType<typeof setTimeout> | number | undefined) => void;
  closeAdmission: () => Promise<void>;
  closeAuth: () => void | Promise<void>;
  closeProductStores: () => void | Promise<void>;
  closeQueue: () => Promise<void>;
  flushAnalytics: () => Promise<void>;
  forceAfterMs?: number;
  scheduleTimeout?: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout> | number | undefined;
  stopRecurringWork: () => void | Promise<void>;
  stopServer: (force: boolean) => void | Promise<void>;
}) {
  let completion: Promise<void> | null = null;
  let deadline: ReturnType<typeof setTimeout> | number | undefined | null = null;
  let finished = false;
  let forced = false;
  const drainingBarriersReleased = Promise.withResolvers<void>();
  const serverStopped = Promise.withResolvers<void>();

  const requestServerStop = (force: boolean) => {
    void callBoundary(() => stopServer(force)).then(serverStopped.resolve, serverStopped.reject);
  };

  const forceServerStop = () => {
    if (finished || forced || !completion) return;
    forced = true;
    requestServerStop(true);
    drainingBarriersReleased.resolve();
  };

  return {
    request: (): Promise<void> => {
      if (completion) {
        forceServerStop();

        return completion;
      }

      const barriers = [
        callBoundary(closeAdmission),
        callBoundary(closeQueue),
        callBoundary(stopRecurringWork),
        serverStopped.promise,
      ];

      requestServerStop(false);
      completion = (async () => {
        const settled = await Promise.allSettled(
          barriers.map((barrier) => Promise.race([barrier, drainingBarriersReleased.promise])),
        );

        const failures: unknown[] = settled.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));

        for (const cleanup of [flushAnalytics, closeAuth, closeProductStores]) {
          try {
            await cleanup();
          } catch (error) {
            failures.push(error);
          }
        }

        if (failures.length > 0) {
          throw new AggregateError(failures, "Local Bun Runtime shutdown failed");
        }
      })().finally(() => {
        finished = true;

        if (deadline !== null) cancelTimeout(deadline);
      });
      deadline = scheduleTimeout(forceServerStop, forceAfterMs);

      return completion;
    },
  };
}

function callBoundary(action: () => void | Promise<void>): Promise<void> {
  try {
    return Promise.resolve(action());
  } catch (error) {
    return Promise.reject(error);
  }
}
