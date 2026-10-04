import { isJsonObject, parseJson, type JsonObject, type JsonValue, isString, isBoolean } from "../../shared/json";
import {
  hasFilesystemErrorCode,
  assertRealStateDirectorySync,
  assertRegularStateFileSync,
  ensurePrivateStateDirectorySync,
} from "./localStatePaths";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { HttpError } from "./lib/http";

/** A task-specific model sharing the extraction gateway URL, credential and call behavior. */
export type WorkspaceAssistantModel = {
  model_name: string;
  supports_pdf_input: boolean;
  supports_structured_output: boolean;
};

export type WorkspaceModelDraft = {
  gateway_url: string;
  model_name: string;
  credential?: string;
  sequential_calls: boolean;
  supports_pdf_input: boolean;
  supports_structured_output: boolean;
  /** Absent or null: Template authoring uses the extraction model. */
  assistant_model?: WorkspaceAssistantModel | null;
  /** Absent or null: document classification and splitting use the extraction model. */
  classification_model?: WorkspaceAssistantModel | null;
};

export type StoredWorkspaceModelConfiguration = Omit<WorkspaceModelDraft, "credential"> & {
  credential_ciphertext: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

export function validateWorkspaceModelDraft(value: JsonValue | undefined): WorkspaceModelDraft {
  const invalid = () =>
    new HttpError(
      400,
      "invalid_workspace_model_configuration",
      "Provide a complete, valid Workspace model configuration.",
    );

  if (!isJsonObject(value)) throw invalid();

  const allowed = [
    "gateway_url",
    "model_name",
    "credential",
    "sequential_calls",
    "supports_pdf_input",
    "supports_structured_output",
    "assistant_model",
    "classification_model",
  ];

  if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalid();

  const bounded = (key: string, limit: number, source: JsonObject = value) => {
    const raw = source[key];

    if (!isString(raw) || !raw.trim() || raw.trim().length > limit || /[\r\n\0]/.test(raw)) throw invalid();

    return raw.trim();
  };

  const gateway_url = bounded("gateway_url", 2048);
  let url: URL;

  try {
    url = new URL(gateway_url);
  } catch {
    throw invalid();
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    gateway_url.includes("?") ||
    gateway_url.includes("#")
  )
    throw invalid();
  const { sequential_calls, supports_pdf_input, supports_structured_output } = value;

  if (!isBoolean(sequential_calls) || !isBoolean(supports_pdf_input) || !isBoolean(supports_structured_output))
    throw invalid();

  const taskModel = (raw: JsonValue | undefined): WorkspaceAssistantModel | null => {
    if (raw === undefined || raw === null) return null;

    if (!isJsonObject(raw)) throw invalid();
    const keys = ["model_name", "supports_pdf_input", "supports_structured_output"];

    if (Object.keys(raw).some((key) => !keys.includes(key))) throw invalid();

    if (!isBoolean(raw.supports_pdf_input) || !isBoolean(raw.supports_structured_output)) throw invalid();

    return {
      model_name: bounded("model_name", 256, raw),
      supports_pdf_input: raw.supports_pdf_input,
      supports_structured_output: raw.supports_structured_output,
    };
  };

  const draft: WorkspaceModelDraft = {
    gateway_url,
    model_name: bounded("model_name", 256),
    sequential_calls,
    supports_pdf_input,
    supports_structured_output,
    assistant_model: taskModel(value.assistant_model),
    classification_model: taskModel(value.classification_model),
  };

  if (Object.hasOwn(value, "credential")) draft.credential = bounded("credential", 8192);

  return draft;
}

/** The model Template authoring (assistant, suggestions, Auto generate) should call. */
export function assistantModelOf(
  configuration: Omit<WorkspaceModelDraft, "credential">,
): Omit<WorkspaceModelDraft, "credential" | "assistant_model" | "classification_model"> {
  const { assistant_model, classification_model: _classification, ...extraction } = configuration;

  return assistant_model ? { ...extraction, ...assistant_model } : extraction;
}

/** The shared model for document classification, splitting and targeted reassessment. */
export function classificationModelOf(
  configuration: Omit<WorkspaceModelDraft, "credential">,
): Omit<WorkspaceModelDraft, "credential" | "assistant_model" | "classification_model"> {
  const { classification_model, assistant_model: _assistant, ...extraction } = configuration;

  return classification_model ? { ...extraction, ...classification_model } : extraction;
}

type ModelEnvironmentInput = { credential: string; workspaceId: string; requestTimeoutMs: string };

/** Gateway environment for a Template authoring call; extraction keeps its own job-scoped setup. */
export function assistantModelEnvironment(
  configuration: Omit<WorkspaceModelDraft, "credential">,
  input: ModelEnvironmentInput,
) {
  return taskModelEnvironment(assistantModelOf(configuration), input);
}

/** Uses the effective classification role without changing final field extraction. */
export function classificationModelEnvironment(
  configuration: Omit<WorkspaceModelDraft, "credential">,
  input: ModelEnvironmentInput,
) {
  return taskModelEnvironment(classificationModelOf(configuration), input);
}

function taskModelEnvironment(model: Omit<WorkspaceModelDraft, "credential">, input: ModelEnvironmentInput) {
  return {
    AI_MODEL: model.model_name,
    MODEL_GATEWAY_URL: model.gateway_url,
    LITELLM_KEY: input.credential,
    MODEL_GATEWAY_SEQUENTIAL_CALLS: String(model.sequential_calls),
    MODEL_SUPPORTS_PDF_INPUT: String(model.supports_pdf_input),
    MODEL_SUPPORTS_STRUCTURED_OUTPUT: String(model.supports_structured_output),
    MODEL_GATEWAY_WORKSPACE_ID: input.workspaceId,
    MODEL_GATEWAY_REQUEST_TIMEOUT_MS: input.requestTimeoutMs,
  };
}

export function configurationUnavailable(): HttpError {
  return new HttpError(
    503,
    "workspace_model_configuration_unavailable",
    "Workspace model credentials are unavailable. Replace the credential or clear the configuration in Workspace settings.",
  );
}

export function configurationMissing(): HttpError {
  return new HttpError(
    409,
    "workspace_model_not_configured",
    "Configure the Model gateway in Workspace settings before processing documents.",
  );
}

export function modelConfigurationETag(revision: number): string {
  return `"workspace-model-${revision}"`;
}

/** Dedicated machine secret; reads never create or repair it. Explicit credential replacement can repair it. */
export function createWorkspaceCredentialVault(stateDirectory: string) {
  const directory = join(stateDirectory, "secrets");
  const path = join(directory, "model-gateway.key");

  const readKey = (protect = false) => {
    assertRealStateDirectorySync(stateDirectory);
    assertRealStateDirectorySync(directory);
    assertRegularStateFileSync(path);
    const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);

    try {
      const stat = fstatSync(file);

      if (!stat.isFile() || stat.size !== 32) throw configurationUnavailable();
      const key = readFileSync(file);

      if (key.length !== 32) throw configurationUnavailable();

      if (protect) fchmodSync(file, 0o600);

      return key;
    } finally {
      closeSync(file);
    }
  };

  const encryptionKey = () => {
    ensurePrivateStateDirectorySync(stateDirectory, { recursive: true });
    ensurePrivateStateDirectorySync(directory);

    try {
      return readKey(true);
    } catch (error) {
      const missing = hasFilesystemErrorCode(error, "ENOENT");

      if (!missing && !(error instanceof HttpError)) throw configurationUnavailable();
      const key = randomBytes(32);

      try {
        assertRegularStateFileSync(path);

        const file = openSync(
          path,
          constants.O_WRONLY | constants.O_NOFOLLOW | (missing ? constants.O_CREAT | constants.O_EXCL : 0),
          0o600,
        );

        try {
          if (!fstatSync(file).isFile()) throw configurationUnavailable();
          fchmodSync(file, 0o600);
          ftruncateSync(file, 0);
          writeFileSync(file, key);
        } finally {
          closeSync(file);
        }

        return key;
      } catch (writeError) {
        if (hasFilesystemErrorCode(writeError, "EEXIST")) return readKey();
        throw configurationUnavailable();
      }
    }
  };

  return {
    encrypt(workspaceId: string, credential: string): string {
      try {
        const nonce = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
        cipher.setAAD(Buffer.from(`workspace-model-credential:1:${workspaceId}`));
        const encrypted = Buffer.concat([cipher.update(credential, "utf8"), cipher.final()]);

        return JSON.stringify({
          version: 1,
          nonce: nonce.toString("base64"),
          ciphertext: encrypted.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
        });
      } catch {
        throw configurationUnavailable();
      }
    },
    decrypt(workspaceId: string, envelope: string): string {
      try {
        const value = parseJson(envelope);

        if (
          !isJsonObject(value) ||
          value.version !== 1 ||
          !isString(value.nonce) ||
          !isString(value.tag) ||
          !isString(value.ciphertext)
        )
          throw configurationUnavailable();
        const nonce = Buffer.from(value.nonce, "base64");
        const tag = Buffer.from(value.tag, "base64");

        if (nonce.length !== 12 || tag.length !== 16) throw configurationUnavailable();
        const decipher = createDecipheriv("aes-256-gcm", readKey(), nonce);
        decipher.setAAD(Buffer.from(`workspace-model-credential:1:${workspaceId}`));
        decipher.setAuthTag(tag);

        const credential = Buffer.concat([
          decipher.update(Buffer.from(value.ciphertext, "base64")),
          decipher.final(),
        ]).toString("utf8");

        if (!credential.trim()) throw configurationUnavailable();

        return credential;
      } catch {
        throw configurationUnavailable();
      }
    },
  };
}

export type WorkspaceCredentialVault = ReturnType<typeof createWorkspaceCredentialVault>;

export function publicModelConfiguration(
  record: StoredWorkspaceModelConfiguration | null,
  workspaceId: string,
  canManage: boolean,
  vault: WorkspaceCredentialVault,
) {
  if (!record) return { configured: false };

  if (!canManage) return { configured: true };
  let credential_status: "configured" | "unavailable" = "configured";

  try {
    vault.decrypt(workspaceId, record.credential_ciphertext);
  } catch {
    credential_status = "unavailable";
  }

  return {
    configured: true,
    gateway_url: record.gateway_url,
    model_name: record.model_name,
    sequential_calls: record.sequential_calls,
    supports_pdf_input: record.supports_pdf_input,
    supports_structured_output: record.supports_structured_output,
    assistant_model: record.assistant_model ?? null,
    classification_model: record.classification_model ?? null,
    revision: record.revision,
    created_at: record.created_at,
    updated_at: record.updated_at,
    credential_status,
  };
}
