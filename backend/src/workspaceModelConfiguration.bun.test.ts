import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocalWorkspaceProductStore, openLocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import {
  classificationModelEnvironment,
  assistantModelEnvironment,
  createWorkspaceCredentialVault,
  publicModelConfiguration,
  validateWorkspaceModelDraft,
} from "./workspaceModelConfiguration";

const directories: string[] = [];

const temporaryState = () => {
  const directory = mkdtempSync(join(tmpdir(), "workspace-model-test-"));
  directories.push(directory);

  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const draft = {
  gateway_url: "http://localhost:1234/v1",
  model_name: "example/model",
  sequential_calls: false,
  supports_pdf_input: false,
  supports_structured_output: false,
};

test("Workspace storage is lazy, encrypted, revision-safe across clear/recreate, and persistent", () => {
  const stateDirectory = temporaryState();
  const workspaceId = "workspace_a";
  expect(openLocalWorkspaceProductStore({ stateDirectory, workspaceId })).toBeNull();
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  expect(store.getModelConfiguration()).toBeNull();
  const vault = createWorkspaceCredentialVault(stateDirectory);
  const ciphertext = vault.encrypt(workspaceId, "dummy-secret");
  expect(ciphertext).not.toContain("dummy-secret");
  expect(vault.encrypt(workspaceId, "dummy-secret")).not.toBe(ciphertext);
  expect(vault.decrypt(workspaceId, ciphertext)).toBe("dummy-secret");
  expect(() => vault.decrypt("workspace_b", ciphertext)).toThrow();
  const configuration = { ...draft, credential_ciphertext: ciphertext };

  const first = store.putModelConfiguration({
    configuration,
    expectedRevision: null,
    updatedAt: "2026-09-02T10:00:00Z",
  })!;

  expect(first.revision).toBe(1);
  expect(
    store.putModelConfiguration({ configuration, expectedRevision: null, updatedAt: first.updated_at }),
  ).toBeNull();

  const replacement = store.putModelConfiguration({
    configuration: { ...configuration, model_name: "new/model" },
    expectedRevision: first.revision,
    updatedAt: "2026-09-02T10:01:00Z",
  })!;

  expect(replacement.created_at).toBe(first.created_at);
  expect(replacement.revision).toBeGreaterThan(first.revision);
  expect(store.clearModelConfiguration(first.revision)).toBe(false);
  expect(store.clearModelConfiguration(replacement.revision)).toBe(true);
  expect(store.getModelConfiguration()).toBeNull();

  const recreated = store.putModelConfiguration({
    configuration,
    expectedRevision: null,
    updatedAt: first.updated_at,
  })!;

  expect(recreated.revision).toBeGreaterThan(replacement.revision);
  store.close();
  const reopened = openLocalWorkspaceProductStore({ stateDirectory, workspaceId })!;
  expect(reopened.getModelConfiguration()).toEqual(recreated);
  reopened.close();
  const databasePath = join(stateDirectory, "data", "workspaces", `${workspaceId}.sqlite`);
  expect(readFileSync(databasePath).includes(Buffer.from("dummy-secret"))).toBe(false);
  expect(statSync(databasePath).mode & 0o777).toBe(0o600);
  expect(statSync(join(stateDirectory, "secrets", "model-gateway.key")).mode & 0o777).toBe(0o600);
});

test("credential failure preserves presence, redacts every representation, and permits explicit repair", () => {
  const stateDirectory = temporaryState();
  const vault = createWorkspaceCredentialVault(stateDirectory);

  const record = {
    ...draft,
    credential_ciphertext: vault.encrypt("workspace_a", "dummy-secret"),
    revision: 1,
    created_at: "now",
    updated_at: "now",
  };

  const publicRecord = publicModelConfiguration(record, "workspace_a", true, vault);
  expect(publicRecord).toMatchObject({ configured: true, credential_status: "configured" });
  expect(JSON.stringify(publicRecord)).not.toContain("dummy-secret");
  expect(publicRecord).not.toHaveProperty("credential_ciphertext");
  const path = join(stateDirectory, "secrets", "model-gateway.key");

  for (const mode of ["missing", "invalid", "changed"] as const) {
    if (mode === "missing") rmSync(path);
    else writeFileSync(path, mode === "invalid" ? "invalid" : Buffer.alloc(32, 9));
    expect(publicModelConfiguration(record, "workspace_a", false, vault)).toEqual({ configured: true });
    expect(publicModelConfiguration(record, "workspace_a", true, vault)).toMatchObject({
      credential_status: "unavailable",
    });
    expect(() => vault.decrypt("workspace_a", record.credential_ciphertext)).toThrow();
    const repaired = vault.encrypt("workspace_a", "replacement-secret");
    expect(vault.decrypt("workspace_a", repaired)).toBe("replacement-secret");
  }

  expect(() =>
    vault.decrypt("workspace_a", JSON.stringify({ ...JSON.parse(record.credential_ciphertext), version: 2 })),
  ).toThrow();
});

test("complete structural validation trims fields and rejects unsafe URLs, partial values, and managed files", () => {
  expect(validateWorkspaceModelDraft({ ...draft, model_name: " model ", credential: " key " })).toMatchObject({
    model_name: "model",
    credential: "key",
  });

  for (const gateway_url of [
    "relative",
    "file:///tmp/a",
    "https://user:secret@example.com",
    "https://example.com?key=a",
    "https://example.com#part",
  ]) {
    expect(() => validateWorkspaceModelDraft({ ...draft, gateway_url })).toThrow();
  }

  for (const invalid of [
    {},
    { ...draft, credential: " " },
    { ...draft, supports_pdf_input: undefined },
    { ...draft, use_managed_files: true },
  ]) {
    expect(() => validateWorkspaceModelDraft(invalid)).toThrow();
  }
});

test("an optional Template assistant model is validated strictly and defaults to the extraction model", () => {
  const assistant_model = {
    model_name: " assistant/model ",
    supports_pdf_input: true,
    supports_structured_output: false,
  };

  expect(validateWorkspaceModelDraft(draft).assistant_model).toBeNull();
  expect(validateWorkspaceModelDraft({ ...draft, assistant_model: null }).assistant_model).toBeNull();
  expect(validateWorkspaceModelDraft({ ...draft, assistant_model }).assistant_model).toEqual({
    ...assistant_model,
    model_name: "assistant/model",
  });

  for (const invalid of [
    [],
    "assistant/model",
    { ...assistant_model, model_name: " " },
    { ...assistant_model, model_name: "a".repeat(257) },
    { ...assistant_model, supports_pdf_input: undefined },
    { ...assistant_model, gateway_url: "http://elsewhere/v1" },
  ]) {
    expect(() => validateWorkspaceModelDraft({ ...draft, assistant_model: invalid })).toThrow();
  }
});

test("the assistant model persists with the configuration and replaces only the model and its capabilities", () => {
  const stateDirectory = temporaryState();
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "workspace_a" });
  const vault = createWorkspaceCredentialVault(stateDirectory);

  const configuration = {
    ...draft,
    sequential_calls: true,
    credential_ciphertext: vault.encrypt("workspace_a", "dummy-secret"),
  };

  const inherited = store.putModelConfiguration({
    configuration,
    expectedRevision: null,
    updatedAt: "2026-09-02T10:00:00Z",
  })!;

  expect(inherited.assistant_model).toBeNull();
  const assistant_model = { model_name: "assistant/model", supports_pdf_input: true, supports_structured_output: true };

  const overridden = store.putModelConfiguration({
    configuration: { ...configuration, assistant_model },
    expectedRevision: inherited.revision,
    updatedAt: "2026-09-02T10:01:00Z",
  })!;

  expect(overridden.assistant_model).toEqual(assistant_model);
  expect(publicModelConfiguration(overridden, "workspace_a", true, vault)).toMatchObject({ assistant_model });
  expect(publicModelConfiguration(overridden, "workspace_a", false, vault)).toEqual({ configured: true });
  const environment = { credential: "dummy-secret", workspaceId: "workspace_a", requestTimeoutMs: "1000" };
  expect(assistantModelEnvironment(overridden, environment)).toMatchObject({
    AI_MODEL: "assistant/model",
    MODEL_GATEWAY_URL: draft.gateway_url,
    LITELLM_KEY: "dummy-secret",
    MODEL_GATEWAY_SEQUENTIAL_CALLS: "true",
    MODEL_SUPPORTS_PDF_INPUT: "true",
    MODEL_SUPPORTS_STRUCTURED_OUTPUT: "true",
  });
  expect(assistantModelEnvironment(inherited, environment)).toMatchObject({
    AI_MODEL: draft.model_name,
    MODEL_SUPPORTS_PDF_INPUT: "false",
    MODEL_SUPPORTS_STRUCTURED_OUTPUT: "false",
  });

  const cleared = store.putModelConfiguration({
    configuration: { ...configuration, assistant_model: null },
    expectedRevision: overridden.revision,
    updatedAt: "2026-09-02T10:02:00Z",
  })!;

  expect(cleared.assistant_model).toBeNull();
  store.close();
});

test("credential vault refuses linked key files and secret directories without reading, repairing or chmodding outside targets", () => {
  for (const mode of ["valid-key", "invalid-key", "directory"]) {
    const root = temporaryState();
    const stateDirectory = join(root, "state");
    const vault = createWorkspaceCredentialVault(stateDirectory);
    const ciphertext = vault.encrypt("workspace_a", "dummy-secret");
    const keyPath = join(stateDirectory, "secrets", "model-gateway.key");
    const key = mode === "invalid-key" ? Buffer.from("invalid") : readFileSync(keyPath);
    const outside = join(root, "outside");
    const outsideFile = mode === "directory" ? join(outside, "model-gateway.key") : outside;

    if (mode === "directory") {
      mkdirSync(outside);
      chmodSync(outside, 0o755);
      rmSync(join(stateDirectory, "secrets"), { recursive: true });
      symlinkSync(outside, join(stateDirectory, "secrets"));
    } else {
      rmSync(keyPath);
      symlinkSync(outside, keyPath);
    }

    writeFileSync(outsideFile, key);
    chmodSync(outsideFile, 0o644);
    expect(() => vault.decrypt("workspace_a", ciphertext)).toThrow("Workspace model credentials are unavailable");
    expect(() => vault.encrypt("workspace_a", "replacement-secret")).toThrow(
      "Workspace model credentials are unavailable",
    );
    expect(readFileSync(outsideFile)).toEqual(key);
    expect(statSync(outsideFile).mode & 0o777).toBe(0o644);

    if (mode === "directory") {
      expect(statSync(outside).mode & 0o777).toBe(0o755);
      expect(readdirSync(outside)).toEqual(["model-gateway.key"]);
    }
  }
});

test("Workspace databases refuse linked database, sidecar and parent paths without changing outside targets", () => {
  for (const suffix of ["", "-journal", "-wal", "-shm", "directory"]) {
    const root = temporaryState();
    const stateDirectory = join(root, "state");
    const workspaceId = "workspace_a";
    createLocalWorkspaceProductStore({ stateDirectory, workspaceId }).close();
    const outside = join(root, "outside");
    const productDirectory = join(stateDirectory, "data", "workspaces");

    const destination =
      suffix === "directory" ? productDirectory : join(productDirectory, `${workspaceId}.sqlite${suffix}`);

    rmSync(destination, { recursive: true, force: true });

    if (suffix === "directory") {
      mkdirSync(outside);
      chmodSync(outside, 0o755);
    } else {
      writeFileSync(outside, "unchanged external file");
      chmodSync(outside, 0o644);
    }

    symlinkSync(outside, destination);
    expect(() => createLocalWorkspaceProductStore({ stateDirectory, workspaceId })).toThrow("Local state");
    expect(() => openLocalWorkspaceProductStore({ stateDirectory, workspaceId })).toThrow("Local state");
    expect(statSync(outside).mode & 0o777).toBe(suffix === "directory" ? 0o755 : 0o644);

    if (suffix === "directory") expect(readdirSync(outside)).toEqual([]);
    else expect(readFileSync(outside, "utf8")).toBe("unchanged external file");
  }
});

test("classification and splitting use one strictly validated role independently of assistant and extraction", () => {
  const classification_model = {
    model_name: " classify/model ",
    supports_pdf_input: true,
    supports_structured_output: true,
  };

  expect(validateWorkspaceModelDraft(draft).classification_model).toBeNull();
  expect(validateWorkspaceModelDraft({ ...draft, classification_model: null }).classification_model).toBeNull();
  expect(validateWorkspaceModelDraft({ ...draft, classification_model }).classification_model).toEqual({
    ...classification_model,
    model_name: "classify/model",
  });

  for (const invalid of [
    [],
    "classify/model",
    {},
    { ...classification_model, model_name: " " },
    { ...classification_model, credential: "different-key" },
    { ...classification_model, supports_pdf_input: "true" },
  ]) {
    expect(() => validateWorkspaceModelDraft({ ...draft, classification_model: invalid })).toThrow();
  }

  const input = { credential: "dummy-secret", workspaceId: "workspace_a", requestTimeoutMs: "1500" };

  const configuration = {
    ...draft,
    sequential_calls: true,
    classification_model: { ...classification_model, model_name: "classify/model" },
    assistant_model: { model_name: "assistant/model", supports_pdf_input: false, supports_structured_output: false },
  };

  expect(classificationModelEnvironment(configuration, input)).toEqual({
    AI_MODEL: "classify/model",
    MODEL_GATEWAY_URL: draft.gateway_url,
    LITELLM_KEY: "dummy-secret",
    MODEL_GATEWAY_SEQUENTIAL_CALLS: "true",
    MODEL_SUPPORTS_PDF_INPUT: "true",
    MODEL_SUPPORTS_STRUCTURED_OUTPUT: "true",
    MODEL_GATEWAY_WORKSPACE_ID: "workspace_a",
    MODEL_GATEWAY_REQUEST_TIMEOUT_MS: "1500",
  });
  expect(assistantModelEnvironment(configuration, input).AI_MODEL).toBe("assistant/model");
  expect(classificationModelEnvironment({ ...configuration, classification_model: null }, input)).toMatchObject({
    AI_MODEL: draft.model_name,
    MODEL_SUPPORTS_PDF_INPUT: "false",
    MODEL_SUPPORTS_STRUCTURED_OUTPUT: "false",
  });
});

test("classification model survives reopening and clearing restores extraction inheritance", () => {
  const stateDirectory = temporaryState();
  const workspaceId = "workspace_classification";
  let store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });

  const classification_model = {
    model_name: "classify/model",
    supports_pdf_input: true,
    supports_structured_output: false,
  };

  const configuration = {
    ...draft,
    classification_model,
    credential_ciphertext: createWorkspaceCredentialVault(stateDirectory).encrypt(workspaceId, "dummy-secret"),
  };

  const saved = store.putModelConfiguration({
    configuration,
    expectedRevision: null,
    updatedAt: "2026-10-02T10:00:00Z",
  })!;

  store.close();
  store = openLocalWorkspaceProductStore({ stateDirectory, workspaceId })!;
  expect(store.getModelConfiguration()?.classification_model).toEqual(classification_model);
  expect(
    publicModelConfiguration(
      store.getModelConfiguration(),
      workspaceId,
      true,
      createWorkspaceCredentialVault(stateDirectory),
    ),
  ).toMatchObject({ classification_model });

  const inherited = store.putModelConfiguration({
    configuration: { ...configuration, classification_model: null },
    expectedRevision: saved.revision,
    updatedAt: "2026-10-02T10:01:00Z",
  });

  expect(inherited?.classification_model).toBeNull();
  store.close();
});
