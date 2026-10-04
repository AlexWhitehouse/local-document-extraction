import { readFileSync } from "node:fs";

export type LocalMemoryPressureLevel = "warning" | "critical";

type MemoryPressureEmitter = {
  off(event: "memoryPressure", listener: (level: LocalMemoryPressureLevel) => void): void;
  on(event: "memoryPressure", listener: (level: LocalMemoryPressureLevel) => void): void;
};

export function registerLocalMemoryPressureListener({
  emitter = process,
  onError = (error) => console.error("Local memory-pressure policy failed", error),
  onPressure,
}: {
  emitter?: MemoryPressureEmitter;
  onError?: (cause: unknown) => void;
  onPressure: (level: LocalMemoryPressureLevel) => void | Promise<void>;
}): () => void {
  const verify = emitter === process && process.platform === "linux" ? createLinuxMemoryPressureVerifier() : () => true;

  const listener = (level: LocalMemoryPressureLevel) => {
    if (!verify()) return;
    void Promise.resolve(onPressure(level)).catch(onError);
  };

  emitter.on("memoryPressure", listener);

  return () => {
    emitter.off("memoryPressure", listener);
  };
}

type PressureReading = { stalls: Record<string, number>; lowHeadroom: boolean };

/** Linux can seed a newly armed PSI trigger from the wrong counter (oven-sh/bun#42783). */
export function createLinuxMemoryPressureVerifier(read: () => PressureReading | null = readLinuxPressure) {
  let previous = read();

  return () => {
    const current = read();

    // Unavailable/changed counters must never suppress an actual pressure signal.
    const confirmed =
      !previous ||
      !current ||
      current.lowHeadroom ||
      Object.keys(previous.stalls).some(
        (key) =>
          current.stalls[key] === undefined ||
          current.stalls[key]! < previous!.stalls[key]! ||
          current.stalls[key]! - previous!.stalls[key]! >= 150_000,
      );

    if (confirmed) previous = current;

    return confirmed;
  };
}

function readLinuxPressure(): PressureReading | null {
  try {
    const read = (path: string) => readFileSync(path, "utf8");

    const total = (text: string) => {
      const value = Number(/^some .*\btotal=(\d+)/m.exec(text)?.[1]);

      if (!Number.isSafeInteger(value)) throw new Error("Missing PSI counter");

      return value;
    };

    const stalls: Record<string, number> = {};
    stalls.host = total(read("/proc/pressure/memory"));
    const info = read("/proc/meminfo");
    const memory = Number(/^MemTotal:\s+(\d+)/m.exec(info)?.[1]);
    const available = Number(/^MemAvailable:\s+(\d+)/m.exec(info)?.[1]);

    if (!Number.isFinite(memory) || !Number.isFinite(available)) return null;
    let lowHeadroom = available < memory * 0.15;
    const group = /^0::(\/.*)$/m.exec(read("/proc/self/cgroup"))?.[1];

    if (group && group !== "/") {
      // Include ancestors because a container/service may inherit its memory limit.
      const segments = group.split("/").filter(Boolean);

      for (let count = segments.length; count > 0; count--) {
        const directory = `/sys/fs/cgroup/${segments.slice(0, count).join("/")}`;
        stalls[directory] = total(read(`${directory}/memory.pressure`));
        const maximum = read(`${directory}/memory.max`).trim();

        if (maximum !== "max") {
          const limit = Number(maximum);
          const used = Number(read(`${directory}/memory.current`).trim());

          if (!Number.isFinite(limit) || !Number.isFinite(used)) return null;
          lowHeadroom ||= used >= limit * 0.85;
        }
      }
    }

    return { stalls, lowHeadroom };
  } catch {
    return null;
  }
}
