import { rm } from "node:fs/promises";
import { join } from "node:path";

export const RETIRED_MODEL_ENVIRONMENT_VARIABLES = [
  "MODEL_GATEWAY_URL", "AI_MODEL", "LITELLM_KEY", "MODEL_GATEWAY_ROUTE_LABEL",
  "MODEL_GATEWAY_SEQUENTIAL_CALLS", "MODEL_SUPPORTS_PDF_INPUT", "MODEL_SUPPORTS_STRUCTURED_OUTPUT", "MODEL_GATEWAY_USE_MANAGED_FILES",
] as const;

/** Never read, import, or archive legacy credentials. Retry cleanup on each successful initialization. */
export async function retireGlobalModelConfiguration(stateDirectory: string, environment: Record<string, string | undefined> = process.env): Promise<void> {
  const ignored = RETIRED_MODEL_ENVIRONMENT_VARIABLES.filter((name) => environment[name] !== undefined);
  if (ignored.length) console.warn(`Ignored retired model configuration variables: ${ignored.join(", ")}. Configure each Workspace in the frontend.`);
  try { await rm(join(stateDirectory, "data", "model-gateway.json"), { force: true }); }
  catch { console.warn("Legacy model configuration cleanup could not complete; it will be retried on the next startup."); }
}
