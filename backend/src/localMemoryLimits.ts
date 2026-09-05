import { totalmem } from "node:os";

type MemoryEnvironment = {
  LOCAL_MEMORY_LIMIT_RATIO?: string;
  MODEL_PREPARATION_MAX_BYTES?: string;
};

export function readLocalMemoryLimits(env: MemoryEnvironment, totalMemoryBytes: number) {
  if (!Number.isSafeInteger(totalMemoryBytes) || totalMemoryBytes < 1) {
    throw new Error("System memory must be a positive integer byte count.");
  }
  const memoryLimitRatio = env.LOCAL_MEMORY_LIMIT_RATIO ? Number(env.LOCAL_MEMORY_LIMIT_RATIO) : 0.8;
  if (!Number.isFinite(memoryLimitRatio) || memoryLimitRatio <= 0 || memoryLimitRatio > 1) {
    throw new Error("LOCAL_MEMORY_LIMIT_RATIO must be greater than zero and no greater than one.");
  }
  const processLimitBytes = Math.floor(totalMemoryBytes * memoryLimitRatio);
  // Leave 10% of the process allowance for the runtime, uploads, exports and
  // allocations that the preparation estimates cannot account for precisely.
  const defaultPreparationBytes = Math.floor(processLimitBytes * 0.9);
  const preparationMaxBytes = env.MODEL_PREPARATION_MAX_BYTES
    ? Number(env.MODEL_PREPARATION_MAX_BYTES)
    : defaultPreparationBytes;
  if (!Number.isSafeInteger(preparationMaxBytes) || preparationMaxBytes < 1
    || preparationMaxBytes > defaultPreparationBytes) {
    throw new Error(`MODEL_PREPARATION_MAX_BYTES must be a positive integer no greater than ${defaultPreparationBytes}.`);
  }
  return { totalMemoryBytes, memoryLimitRatio, processLimitBytes, preparationMaxBytes };
}

export const localMemoryLimits = readLocalMemoryLimits({
  LOCAL_MEMORY_LIMIT_RATIO: process.env.LOCAL_MEMORY_LIMIT_RATIO,
  MODEL_PREPARATION_MAX_BYTES: process.env.MODEL_PREPARATION_MAX_BYTES,
}, totalmem());
