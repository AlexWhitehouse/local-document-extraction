export type LocalRuntimeRequestDrain = {
  close(): Promise<void>;
  run<T extends Response | undefined>(handle: () => T | Promise<T>): Promise<T | Response>;
  snapshot(): { accepting: boolean; active: number };
};

export function createLocalRuntimeRequestDrain(): LocalRuntimeRequestDrain {
  let accepting = true;
  let active = 0;
  const closeWaiters: Array<() => void> = [];

  const settleClose = () => {
    if (accepting || active !== 0) return;
    for (const resolve of closeWaiters.splice(0)) resolve();
  };

  return {
    close: async () => {
      accepting = false;
      if (active === 0) return;
      await new Promise<void>((resolve) => closeWaiters.push(resolve));
    },
    run: async (handle) => {
      if (!accepting) {
        return Response.json(
          {
            error: {
              code: "local_runtime_shutting_down",
              message: "The Local Bun Runtime is shutting down",
            },
          },
          {
            status: 503,
            headers: { "cache-control": "no-store" },
          },
        );
      }

      active += 1;
      try {
        return await handle();
      } finally {
        active -= 1;
        settleClose();
      }
    },
    snapshot: () => ({ accepting, active }),
  };
}
