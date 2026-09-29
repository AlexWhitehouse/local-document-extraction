export type LocalMemoryPressureLevel = "warning" | "critical";

type MemoryPressureEmitter = {
  off(event: "memoryPressure", listener: (level: LocalMemoryPressureLevel) => void): unknown;
  on(event: "memoryPressure", listener: (level: LocalMemoryPressureLevel) => void): unknown;
};

export function registerLocalMemoryPressureListener({
  emitter = process,
  onError = (error) => console.error("Local memory-pressure policy failed", error),
  onPressure,
}: {
  emitter?: MemoryPressureEmitter;
  onError?: (error: unknown) => void;
  onPressure: (level: LocalMemoryPressureLevel) => void | Promise<void>;
}): () => void {
  const listener = (level: LocalMemoryPressureLevel) => {
    void Promise.resolve(onPressure(level)).catch(onError);
  };
  emitter.on("memoryPressure", listener);
  return () => { emitter.off("memoryPressure", listener); };
}
