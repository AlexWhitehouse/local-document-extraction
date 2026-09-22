import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocalWorkspaceProductStore, openLocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { createWorkspaceCredentialVault, publicModelConfiguration, validateWorkspaceModelDraft } from "./workspaceModelConfiguration";

const directories: string[] = [];
const temporaryState = () => { const directory = mkdtempSync(join(tmpdir(), "workspace-model-test-")); directories.push(directory); return directory; };
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const draft = { gateway_url: "http://localhost:1234/v1", model_name: "example/model", sequential_calls: false, supports_pdf_input: false, supports_structured_output: false };

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
  const first = store.putModelConfiguration({ configuration, expectedRevision: null, updatedAt: "2026-09-02T10:00:00Z" })!;
  expect(first.revision).toBe(1);
  expect(store.putModelConfiguration({ configuration, expectedRevision: null, updatedAt: first.updated_at })).toBeNull();
  const replacement = store.putModelConfiguration({ configuration: { ...configuration, model_name: "new/model" }, expectedRevision: first.revision, updatedAt: "2026-09-02T10:01:00Z" })!;
  expect(replacement.created_at).toBe(first.created_at);
  expect(replacement.revision).toBeGreaterThan(first.revision);
  expect(store.clearModelConfiguration(first.revision)).toBe(false);
  expect(store.clearModelConfiguration(replacement.revision)).toBe(true);
  expect(store.getModelConfiguration()).toBeNull();
  const recreated = store.putModelConfiguration({ configuration, expectedRevision: null, updatedAt: first.updated_at })!;
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
  const record = { ...draft, credential_ciphertext: vault.encrypt("workspace_a", "dummy-secret"), revision: 1, created_at: "now", updated_at: "now" };
  const publicRecord = publicModelConfiguration(record, "workspace_a", true, vault);
  expect(publicRecord).toMatchObject({ configured: true, credential_status: "configured" });
  expect(JSON.stringify(publicRecord)).not.toContain("dummy-secret");
  expect(publicRecord).not.toHaveProperty("credential_ciphertext");
  const path = join(stateDirectory, "secrets", "model-gateway.key");
  for (const mode of ["missing", "invalid", "changed"] as const) {
    if (mode === "missing") rmSync(path);
    else writeFileSync(path, mode === "invalid" ? "invalid" : Buffer.alloc(32, 9));
    expect(publicModelConfiguration(record, "workspace_a", false, vault)).toEqual({ configured: true });
    expect(publicModelConfiguration(record, "workspace_a", true, vault)).toMatchObject({ credential_status: "unavailable" });
    expect(() => vault.decrypt("workspace_a", record.credential_ciphertext)).toThrow();
    const repaired = vault.encrypt("workspace_a", "replacement-secret");
    expect(vault.decrypt("workspace_a", repaired)).toBe("replacement-secret");
  }
  expect(() => vault.decrypt("workspace_a", JSON.stringify({ ...JSON.parse(record.credential_ciphertext), version: 2 }))).toThrow();
});

test("complete structural validation trims fields and rejects unsafe URLs, partial values, and managed files", () => {
  expect(validateWorkspaceModelDraft({ ...draft, model_name: " model ", credential: " key " })).toMatchObject({ model_name: "model", credential: "key" });
  for (const gateway_url of ["relative", "file:///tmp/a", "https://user:secret@example.com", "https://example.com?key=a", "https://example.com#part"]) {
    expect(() => validateWorkspaceModelDraft({ ...draft, gateway_url })).toThrow();
  }
  for (const invalid of [{}, { ...draft, credential: " " }, { ...draft, supports_pdf_input: undefined }, { ...draft, use_managed_files: true }]) {
    expect(() => validateWorkspaceModelDraft(invalid)).toThrow();
  }
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
    expect(() => vault.encrypt("workspace_a", "replacement-secret")).toThrow("Workspace model credentials are unavailable");
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
    const destination = suffix === "directory" ? productDirectory : join(productDirectory, `${workspaceId}.sqlite${suffix}`);
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
