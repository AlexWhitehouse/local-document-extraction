import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import {
  getExtractionModelName,
  getModelGatewayBaseUrl,
  supportsPdfInput,
  usesSequentialModelCalls,
  type ModelGatewayConfiguration,
} from "./consumer/modelGateway";

const MODEL_SETTINGS_FILENAME = "model-gateway.json";

type StoredModelSettings = {
  version: 1 | 2;
  gateway_url: string;
  model_name: string;
  api_key: string | null;
  sequential_calls?: boolean;
  supports_pdf_input?: boolean;
};

export type PublicLocalModelSettings = {
  gateway_url: string;
  model_name: string;
  has_api_key: boolean;
  sequential_calls: boolean;
  supports_pdf_input: boolean;
};

export type LocalModelSettings = {
  getConfiguration(): ModelGatewayConfiguration;
  getPublicSettings(): PublicLocalModelSettings;
  update(input: {
    gatewayUrl: string;
    modelName: string;
    apiKey?: string | null;
    sequentialCalls?: boolean;
    supportsPdfInput?: boolean;
  }): Promise<PublicLocalModelSettings>;
};

export async function createLocalModelSettings({
  environment = process.env as ModelGatewayConfiguration,
  stateDirectory,
}: {
  environment?: ModelGatewayConfiguration;
  stateDirectory: string;
}): Promise<LocalModelSettings> {
  const settingsPath = join(stateDirectory, "data", MODEL_SETTINGS_FILENAME);
  const environmentConfiguration = configurationFromEnvironment(environment);
  const stored = await readStoredSettings(settingsPath);
  let configuration = stored
    ? configurationFromStoredSettings(stored, environmentConfiguration)
    : environmentConfiguration;

  return {
    getConfiguration: () => ({ ...configuration }),
    getPublicSettings: () => publicSettings(configuration),
    update: async ({
      gatewayUrl,
      modelName,
      apiKey,
      sequentialCalls,
      supportsPdfInput: nextSupportsPdfInput,
    }) => {
      const nextConfiguration: ModelGatewayConfiguration = {
        ...configuration,
        AI_MODEL: modelName,
        MODEL_GATEWAY_ROUTE_LABEL: undefined,
        MODEL_GATEWAY_SEQUENTIAL_CALLS: String(
          sequentialCalls ?? usesSequentialModelCalls(configuration),
        ),
        MODEL_GATEWAY_URL: gatewayUrl,
        MODEL_SUPPORTS_PDF_INPUT: String(
          nextSupportsPdfInput ?? supportsPdfInput(configuration),
        ),
        ...(apiKey !== undefined
          ? { LITELLM_KEY: apiKey === null ? undefined : apiKey }
          : {}),
      };
      const nextStoredSettings: StoredModelSettings = {
        version: 2,
        gateway_url: gatewayUrl,
        model_name: modelName,
        api_key: nextConfiguration.LITELLM_KEY || null,
        sequential_calls: usesSequentialModelCalls(nextConfiguration),
        supports_pdf_input: supportsPdfInput(nextConfiguration),
      };

      await writeStoredSettings(settingsPath, nextStoredSettings);
      configuration = nextConfiguration;
      return publicSettings(configuration);
    },
  };
}

function configurationFromEnvironment(
  environment: ModelGatewayConfiguration,
): ModelGatewayConfiguration {
  return {
    AI_MODEL: environment.AI_MODEL?.trim() || undefined,
    LITELLM_KEY: environment.LITELLM_KEY?.trim() || undefined,
    MODEL_GATEWAY_REQUEST_TIMEOUT_MS:
      environment.MODEL_GATEWAY_REQUEST_TIMEOUT_MS,
    MODEL_GATEWAY_ROUTE_LABEL: environment.MODEL_GATEWAY_ROUTE_LABEL,
    MODEL_GATEWAY_SEQUENTIAL_CALLS:
      environment.MODEL_GATEWAY_SEQUENTIAL_CALLS?.trim() || undefined,
    MODEL_GATEWAY_USE_MANAGED_FILES:
      environment.MODEL_GATEWAY_USE_MANAGED_FILES?.trim() || undefined,
    MODEL_GATEWAY_URL: environment.MODEL_GATEWAY_URL?.trim() || undefined,
    MODEL_SUPPORTS_PDF_INPUT:
      environment.MODEL_SUPPORTS_PDF_INPUT?.trim() || undefined,
  };
}

function configurationFromStoredSettings(
  stored: StoredModelSettings,
  environment: ModelGatewayConfiguration,
): ModelGatewayConfiguration {
  return {
    ...environment,
    AI_MODEL: stored.model_name,
    LITELLM_KEY: stored.api_key || undefined,
    MODEL_GATEWAY_ROUTE_LABEL: undefined,
    MODEL_GATEWAY_SEQUENTIAL_CALLS: String(
      stored.sequential_calls ?? usesSequentialModelCalls(environment),
    ),
    MODEL_GATEWAY_URL: stored.gateway_url,
    MODEL_SUPPORTS_PDF_INPUT: String(
      stored.supports_pdf_input ?? supportsPdfInput(environment),
    ),
  };
}

function publicSettings(
  configuration: ModelGatewayConfiguration,
): PublicLocalModelSettings {
  return {
    gateway_url: getModelGatewayBaseUrl(configuration),
    model_name: getExtractionModelName(configuration),
    has_api_key: Boolean(configuration.LITELLM_KEY),
    sequential_calls: usesSequentialModelCalls(configuration),
    supports_pdf_input: supportsPdfInput(configuration),
  };
}

async function readStoredSettings(path: string): Promise<StoredModelSettings | null> {
  const contents = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  if (!contents.trim()) {
    return null;
  }

  const parsed = JSON.parse(contents) as Partial<StoredModelSettings>;
  if (
    (parsed.version !== 1 && parsed.version !== 2) ||
    typeof parsed.gateway_url !== "string" ||
    !parsed.gateway_url.trim() ||
    typeof parsed.model_name !== "string" ||
    !parsed.model_name.trim() ||
    (parsed.api_key !== null && typeof parsed.api_key !== "string") ||
    (parsed.sequential_calls !== undefined &&
      typeof parsed.sequential_calls !== "boolean") ||
    (parsed.supports_pdf_input !== undefined &&
      typeof parsed.supports_pdf_input !== "boolean")
  ) {
    throw new Error("Local model settings file is invalid.");
  }

  return {
    version: parsed.version,
    gateway_url: parsed.gateway_url.trim(),
    model_name: parsed.model_name.trim(),
    api_key: parsed.api_key?.trim() || null,
    sequential_calls: parsed.sequential_calls,
    supports_pdf_input: parsed.supports_pdf_input,
  };
}

async function writeStoredSettings(
  path: string,
  settings: StoredModelSettings,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}
