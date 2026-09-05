export function createByteBudget(maxBytes: number) {
  let used = 0;
  const waiting: Array<{ bytes: number; start(): void }> = [];
  const pump = () => {
    while (waiting.length && used + waiting[0]!.bytes <= maxBytes) {
      const next = waiting.shift()!;
      used += next.bytes;
      next.start();
    }
  };
  return {
    snapshot: () => ({ maxBytes, reservedBytes: used, waiting: waiting.length }),
    async run<T>(bytes: number, task: (reservation: { shrinkTo(bytes: number): void }) => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (!Number.isFinite(bytes) || bytes < 0 || bytes > maxBytes) throw new Error("Work exceeds the local byte budget");
      signal?.throwIfAborted();
      let abort: (() => void) | undefined;
      await new Promise<void>((resolve, reject) => {
        const entry = { bytes, start: resolve };
        abort = () => {
          const index = waiting.indexOf(entry);
          if (index < 0) return;
          waiting.splice(index, 1);
          reject(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
          pump();
        };
        signal?.addEventListener("abort", abort, { once: true });
        waiting.push(entry);
        pump();
      }).finally(() => { if (abort) signal?.removeEventListener("abort", abort); });
      let reserved = bytes;
      let released = false;
      try {
        signal?.throwIfAborted();
        return await task({
          shrinkTo(nextBytes) {
            if (released || !Number.isFinite(nextBytes) || nextBytes < 0 || nextBytes > reserved) {
              throw new Error("Byte reservations may only shrink while work is active");
            }
            used -= reserved - nextBytes;
            reserved = nextBytes;
            pump();
          },
        });
      } finally { released = true; used -= reserved; pump(); }
    },
  };
}
