import { createLocalWorkspaceProductStore } from "../localWorkspaceProductStore";
import { createWorkspaceCredentialVault } from "../workspaceModelConfiguration";

/** Explicit dummy configuration for existing extraction tests. Never used by production bootstrap. */
export function configureTestWorkspace(input: { stateDirectory: string; workspaceId: string; modelName?: string; gatewayUrl?: string }) {
  const store = createLocalWorkspaceProductStore(input);
  try {
    const current = store.getModelConfiguration();
    return store.putModelConfiguration({
      expectedRevision: current?.revision ?? null,
      configuration: {
        model_name: input.modelName ?? "test/model",
        gateway_url: input.gatewayUrl ?? "http://127.0.0.1:1/v1",
        credential_ciphertext: createWorkspaceCredentialVault(input.stateDirectory).encrypt(input.workspaceId, "dummy-test-key"),
        sequential_calls: false,
        supports_pdf_input: true,
        supports_structured_output: true,
      },
      updatedAt: new Date().toISOString(),
    })!;
  } finally { store.close(); }
}

export function createConfiguredTestProductStore(input: { stateDirectory: string; workspaceId: string }) {
  configureTestWorkspace(input);
  return createLocalWorkspaceProductStore(input);
}
