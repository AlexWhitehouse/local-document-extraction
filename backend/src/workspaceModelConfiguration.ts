import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HttpError } from "./lib/http";

export type WorkspaceModelDraft = {
  gateway_url: string;
  model_name: string;
  credential?: string;
  sequential_calls: boolean;
  supports_pdf_input: boolean;
  supports_structured_output: boolean;
};

export type StoredWorkspaceModelConfiguration = Omit<WorkspaceModelDraft, "credential"> & {
  credential_ciphertext: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

export function validateWorkspaceModelDraft(value: unknown): WorkspaceModelDraft {
  const invalid = () => new HttpError(400, "invalid_workspace_model_configuration", "Provide a complete, valid Workspace model configuration.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const input = value as Record<string, unknown>;
  const allowed = ["gateway_url", "model_name", "credential", "sequential_calls", "supports_pdf_input", "supports_structured_output"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw invalid();
  const bounded = (key: string, limit: number) => {
    const raw = input[key];
    if (typeof raw !== "string" || !raw.trim() || raw.trim().length > limit || /[\r\n\0]/.test(raw)) throw invalid();
    return raw.trim();
  };
  const gateway_url = bounded("gateway_url", 2048);
  let url: URL;
  try { url = new URL(gateway_url); } catch { throw invalid(); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || gateway_url.includes("?") || gateway_url.includes("#")) throw invalid();
  for (const key of allowed.slice(3)) if (typeof input[key] !== "boolean") throw invalid();
  return {
    gateway_url,
    model_name: bounded("model_name", 256),
    ...(Object.hasOwn(input, "credential") ? { credential: bounded("credential", 8192) } : {}),
    sequential_calls: input.sequential_calls as boolean,
    supports_pdf_input: input.supports_pdf_input as boolean,
    supports_structured_output: input.supports_structured_output as boolean,
  };
}

export function configurationUnavailable(): HttpError {
  return new HttpError(503, "workspace_model_configuration_unavailable", "Workspace model credentials are unavailable. Replace the credential or clear the configuration in Workspace settings.");
}

export function configurationMissing(): HttpError {
  return new HttpError(409, "workspace_model_not_configured", "Configure the Model gateway in Workspace settings before processing documents.");
}

export function modelConfigurationETag(revision: number): string {
  return `"workspace-model-${revision}"`;
}

/** Dedicated machine secret; reads never create or repair it. Explicit credential replacement can repair it. */
export function createWorkspaceCredentialVault(stateDirectory: string) {
  const directory = join(stateDirectory, "secrets");
  const path = join(directory, "model-gateway.key");
  const readKey = () => {
    const key = readFileSync(path);
    if (key.length !== 32) throw configurationUnavailable();
    return key;
  };
  const encryptionKey = () => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    try {
      const key = readKey();
      chmodSync(path, 0o600);
      return key;
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      if (!missing && !(error instanceof HttpError)) throw configurationUnavailable();
      const key = randomBytes(32);
      try {
        writeFileSync(path, key, { flag: missing ? "wx" : "w", mode: 0o600 });
        chmodSync(path, 0o600);
        return key;
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code === "EEXIST") return readKey();
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
        return JSON.stringify({ version: 1, nonce: nonce.toString("base64"), ciphertext: encrypted.toString("base64"), tag: cipher.getAuthTag().toString("base64") });
      } catch { throw configurationUnavailable(); }
    },
    decrypt(workspaceId: string, envelope: string): string {
      try {
        const value = JSON.parse(envelope);
        if (value.version !== 1 || typeof value.nonce !== "string" || typeof value.tag !== "string" || typeof value.ciphertext !== "string") throw configurationUnavailable();
        const nonce = Buffer.from(value.nonce, "base64");
        const tag = Buffer.from(value.tag, "base64");
        if (nonce.length !== 12 || tag.length !== 16) throw configurationUnavailable();
        const decipher = createDecipheriv("aes-256-gcm", readKey(), nonce);
        decipher.setAAD(Buffer.from(`workspace-model-credential:1:${workspaceId}`));
        decipher.setAuthTag(tag);
        const credential = Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
        if (!credential.trim()) throw configurationUnavailable();
        return credential;
      } catch { throw configurationUnavailable(); }
    },
  };
}

export type WorkspaceCredentialVault = ReturnType<typeof createWorkspaceCredentialVault>;

export function publicModelConfiguration(record: StoredWorkspaceModelConfiguration | null, workspaceId: string, canManage: boolean, vault: WorkspaceCredentialVault) {
  if (!record) return { configured: false };
  if (!canManage) return { configured: true };
  let credential_status: "configured" | "unavailable" = "configured";
  try { vault.decrypt(workspaceId, record.credential_ciphertext); } catch { credential_status = "unavailable"; }
  return {
    configured: true,
    gateway_url: record.gateway_url,
    model_name: record.model_name,
    sequential_calls: record.sequential_calls,
    supports_pdf_input: record.supports_pdf_input,
    supports_structured_output: record.supports_structured_output,
    revision: record.revision,
    created_at: record.created_at,
    updated_at: record.updated_at,
    credential_status,
  };
}
