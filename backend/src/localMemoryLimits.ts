import { totalmem } from "node:os";
import { readLocalMemoryLimits } from "./localConfiguration";
export { readLocalMemoryLimits } from "./localConfiguration";

export const localMemoryLimits = readLocalMemoryLimits({
  LOCAL_MEMORY_LIMIT_RATIO: process.env.LOCAL_MEMORY_LIMIT_RATIO,
  MODEL_PREPARATION_MAX_BYTES: process.env.MODEL_PREPARATION_MAX_BYTES,
}, totalmem());
