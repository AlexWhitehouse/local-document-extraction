export type LocalRuntimeShutdown = {
  request(): Promise<void>;
};

export function createLocalRuntimeShutdown({
  cancelTimeout = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
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
  cancelTimeout?: (timer: unknown) => void;
  closeAdmission: () => Promise<void>;
  closeAuth: () => void | Promise<void>;
  closeProductStores: () => void | Promise<void>;
  closeQueue: () => Promise<void>;
  flushAnalytics: () => Promise<void>;
  forceAfterMs?: number;
  scheduleTimeout?: (handler: () => void, delayMs: number) => unknown;
  stopRecurringWork: () => void | Promise<void>;
  stopServer: (force: boolean) => void | Promise<void>;
}): LocalRuntimeShutdown {
  let completion: Promise<void> | null = null;
  let deadline: unknown = null;
  let finished = false;
  let forced = false;
  let resolveServerStopped: (() => void) | null = null;
  let rejectServerStopped: ((error: unknown) => void) | null = null;

  const forceServerStop = () => {
    if (finished || forced || !completion) return;
    forced = true;
    try {
      Promise.resolve(stopServer(true)).then(
        () => resolveServerStopped?.(),
        (error) => rejectServerStopped?.(error),
      );
    } catch (error) {
      rejectServerStopped?.(error);
    }
  };

  return {
    request: () => {
      if (completion) {
        forceServerStop();
        return completion;
      }

      const admissionClosed = callBoundary(closeAdmission);
      const queueClosed = callBoundary(closeQueue);
      const recurringWorkStopped = callBoundary(stopRecurringWork);
      const serverStopped = new Promise<void>((resolve, reject) => {
        resolveServerStopped = resolve;
        rejectServerStopped = reject;
      });
      try {
        Promise.resolve(stopServer(false)).then(
          () => resolveServerStopped?.(),
          (error) => rejectServerStopped?.(error),
        );
      } catch (error) {
        rejectServerStopped?.(error);
      }
      completion = (async () => {
        const failures: unknown[] = [];
        const barriers = await Promise.allSettled([
          admissionClosed,
          queueClosed,
          recurringWorkStopped,
          serverStopped,
        ]);
        for (const result of barriers) {
          if (result.status === "rejected") failures.push(result.reason);
        }

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
      })()
        .finally(() => {
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
