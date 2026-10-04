import { fileURLToPath } from "node:url";

export type PdfProcessWorker = {
  child: Bun.Subprocess<"pipe", "pipe", "ignore">;
  reader: ReturnType<typeof createPdfFrameReader>;
  idleTimer?: ReturnType<typeof setTimeout>;
};

/** Callers admit bounded work before taking a process. Idle processes never keep the API alive. */
export function createPdfProcessPool(script: URL, idleMs: number) {
  const idle: PdfProcessWorker[] = [];
  let spawned = 0;

  const stop = async (worker: PdfProcessWorker) => {
    clearTimeout(worker.idleTimer);
    worker.child.kill("SIGKILL");
    await worker.child.exited;
    await worker.reader.close();
  };

  return {
    snapshot: () => ({ idle: idle.length, spawned }),
    stop,
    async take(): Promise<PdfProcessWorker> {
      for (;;) {
        const worker = idle.pop();

        if (!worker) break;
        clearTimeout(worker.idleTimer);

        if (worker.child.exitCode !== null) {
          await stop(worker);
          continue;
        }

        worker.child.ref();

        return worker;
      }

      const child = Bun.spawn([process.execPath, "--no-env-file", "--smol", fileURLToPath(script)], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
        env: {},
      });

      spawned++;

      return { child, reader: createPdfFrameReader(child.stdout) };
    },
    put(worker: PdfProcessWorker) {
      worker.child.unref();
      idle.push(worker);
      worker.idleTimer = setTimeout(() => {
        const index = idle.indexOf(worker);

        if (index < 0) return;
        idle.splice(index, 1);
        void stop(worker);
      }, idleMs);
      worker.idleTimer.unref();
    },
    async close() {
      await Promise.all(idle.splice(0).map(stop));
    },
  };
}

/** Exact framing across arbitrary pipe chunk boundaries, with no accumulating input history. */
export function createPdfFrameReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let pending: Uint8Array = new Uint8Array(0);

  return {
    async read(length: number): Promise<Uint8Array | null> {
      const output = new Uint8Array(length);
      let offset = 0;

      while (offset < length) {
        if (!pending.byteLength) {
          const next = await reader.read();

          if (next.done) {
            if (!offset) return null;
            throw new Error("Incomplete PDF frame");
          }

          pending = next.value;
        }

        const count = Math.min(pending.byteLength, length - offset);
        output.set(pending.subarray(0, count), offset);
        pending = pending.subarray(count);
        offset += count;
      }

      if (!pending.byteLength) pending = new Uint8Array(0);

      return output;
    },
    async close() {
      pending = new Uint8Array(0);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    },
  };
}
