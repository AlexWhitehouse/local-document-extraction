import { HttpError, toHttpError } from "./lib/http";
import type { LocalAuth } from "./localAuth";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import type { LocalLiveUpdateHub } from "./localLiveUpdateHub";
import { LocalWorkspaceOperationError, type LocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
import { LocalWorkspaceProductStoreRegistryError, type LocalWorkspaceProductStoreRegistry, type LocalWorkspaceProductStoreLease } from "./localWorkspaceProductStoreRegistry";
import { buildChatCompletionsUrl, readRunResultContent } from "./consumer/modelGateway";
import { createWorkspaceCredentialVault, modelConfigurationETag, publicModelConfiguration, validateWorkspaceModelDraft, configurationMissing, type WorkspaceModelDraft, type StoredWorkspaceModelConfiguration } from "./workspaceModelConfiguration";

const noStore = { "cache-control": "no-store" };
const failedCondition = () => new HttpError(412, "precondition_failed", "The configuration changed. Reload it before trying again.");
const missingCondition = () => new HttpError(428, "precondition_required", "A configuration precondition is required.");

export async function handleWorkspaceModelConfiguration(input: {
  request: Request;
  workspaceId: string;
  test: boolean;
  auth: LocalAuth;
  workspaceControl: LocalWorkspaceControl;
  registry: LocalWorkspaceProductStoreRegistry;
  operations: LocalWorkspaceProductOperations;
  stateDirectory: string;
  liveUpdateHub?: LocalLiveUpdateHub;
}): Promise<Response> {
  const { request, workspaceId, auth, workspaceControl } = input;
  let lease: LocalWorkspaceProductStoreLease | null = null;
  let operation: ReturnType<LocalWorkspaceProductOperations["acquire"]> | undefined;
  try {
    const session = await auth.getSession(request);
    if (!session) throw new HttpError(401, "unauthorized", "Authentication required");
    const workspace = workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId: session.id });
    if (!workspace) throw new HttpError(403, "forbidden", "You do not have access to this workspace");
    const canManage = workspace.role === "owner" || workspace.role === "admin";
    if ((input.test || request.method !== "GET") && !canManage) throw new HttpError(403, "insufficient_workspace_role", "Only Workspace owners and admins can manage model configuration.");
    const allowed = input.test ? ["POST"] : ["GET", "PUT", "DELETE"];
    if (!allowed.includes(request.method)) return Response.json({ error: { code: "method_not_allowed", message: "Method not allowed" } }, { status: 405, headers: { ...noStore, allow: allowed.join(", ") } });
    operation = input.operations.acquire({ workspaceId });
    lease = input.registry.acquire({ workspaceId, mode: request.method === "PUT" ? "create" : "existing" });
    const vault = createWorkspaceCredentialVault(input.stateDirectory);
    const represent = (record: StoredWorkspaceModelConfiguration | null, status = 200) => Response.json(publicModelConfiguration(record, workspaceId, canManage, vault), {
      status, headers: { ...noStore, ...(record && canManage ? { etag: modelConfigurationETag(record.revision) } : {}) },
    });
    if (request.method === "GET") return represent(lease?.store.getModelConfiguration() ?? null);
    const ifMatch = request.headers.get("if-match");
    const ifNoneMatch = request.headers.get("if-none-match");
    if (request.method === "DELETE") {
      if (!ifMatch && !ifNoneMatch) throw missingCondition();
      const current = lease?.store.getModelConfiguration();
      if (!current || ifNoneMatch || ifMatch !== modelConfigurationETag(current.revision) || !lease!.store.clearModelConfiguration(current.revision)) throw failedCondition();
      input.liveUpdateHub?.broadcastWorkspaceContextInvalidation({ workspaceId, reason: "model_configuration_changed", occurredAt: new Date().toISOString() });
      return new Response(null, { status: 204, headers: noStore });
    }
    let body: unknown;
    try { body = await request.json(); } catch { throw new HttpError(400, "invalid_workspace_model_configuration", "Provide valid JSON for the Workspace model configuration."); }
    const draft = validateWorkspaceModelDraft(body);
    if (input.test && draft.credential !== undefined) {
      return await testWorkspaceModelConnection(draft, draft.credential, request.signal);
    }
    const current = lease?.store.getModelConfiguration() ?? null;
    if (!ifMatch && !ifNoneMatch) throw missingCondition();
    const creating = request.method === "PUT" && ifNoneMatch === "*" && !ifMatch;
    if (creating ? current !== null : !current || ifNoneMatch || ifMatch !== modelConfigurationETag(current.revision)) throw failedCondition();
    if (input.test) {
      if (!current) throw configurationMissing();
      return await testWorkspaceModelConnection(draft, vault.decrypt(workspaceId, current.credential_ciphertext), request.signal);
    }
    if (!draft.credential && !current) throw new HttpError(400, "invalid_workspace_model_configuration", "A new configuration requires a credential.");
    const { credential, ...fields } = draft;
    // Checking usability before preserving ciphertext keeps replacement-with-a-new-key and clear as repair paths.
    if (!credential) vault.decrypt(workspaceId, current!.credential_ciphertext);
    const saved = lease!.store.putModelConfiguration({
      expectedRevision: current?.revision ?? null,
      configuration: { ...fields, credential_ciphertext: credential ? vault.encrypt(workspaceId, credential) : current!.credential_ciphertext },
      updatedAt: new Date().toISOString(),
    });
    if (!saved) throw failedCondition();
    input.liveUpdateHub?.broadcastWorkspaceContextInvalidation({ workspaceId, reason: "model_configuration_changed", occurredAt: saved.updated_at });
    return represent(saved, creating ? 201 : 200);
  } catch (error) {
    const safe = error instanceof LocalWorkspaceProductStoreRegistryError || error instanceof LocalWorkspaceOperationError
      ? new HttpError(503, "workspace_product_store_unavailable", "Workspace product storage is temporarily unavailable.")
      : toHttpError(error);
    return Response.json({ error: { code: safe.code, message: safe.message } }, { status: safe.status, headers: noStore });
  } finally {
    lease?.release();
    operation?.release();
  }
}

export async function testWorkspaceModelConnection(draft: WorkspaceModelDraft, credential: string, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(30_000);
  const error = (status: number, code: string, message: string, gateway_status?: number) => Response.json({ error: { code, message, ...(gateway_status === undefined ? {} : { gateway_status }) } }, { status, headers: noStore });
  try {
    const response = await fetch(buildChatCompletionsUrl({ MODEL_GATEWAY_URL: draft.gateway_url }), {
      method: "POST", redirect: "manual",
      headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
      body: JSON.stringify({ model: draft.model_name, messages: [{ role: "user", content: "Reply with OK." }] }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 408 || response.status === 429 || response.status >= 500) return error(503, "model_gateway_test_unavailable", "The Model gateway is temporarily unavailable.");
      return error(422, "model_gateway_test_rejected", "The Model gateway rejected the test request.", response.status);
    }
    const body = await response.text();
    try {
      readRunResultContent(JSON.parse(body));
    } catch {
      if (timeout.aborted) return error(504, "model_gateway_test_timeout", "The Model gateway test timed out.");
      return error(502, "model_gateway_test_invalid_response", "The Model gateway returned no readable assistant response.");
    }
    return Response.json({ status: "passed" }, { headers: noStore });
  } catch {
    return timeout.aborted
      ? error(504, "model_gateway_test_timeout", "The Model gateway test timed out.")
      : error(503, "model_gateway_test_unavailable", "The Model gateway is temporarily unavailable.");
  }
}
