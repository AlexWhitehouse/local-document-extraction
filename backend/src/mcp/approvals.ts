import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { HttpError } from "../lib/http";
import { nowIso } from "../lib/ids";
import { isJsonObject, parseJson, type JsonObject } from "../../../shared/json";
import { handleLocalJobRead, type ProductServices } from "../localApplication";
import { handleDocumentProcessingRequest } from "../localDocumentProcessingHttp";
import { handleWorkspaceModelConfiguration } from "../workspaceModelConfigurationHttp";
import { validateDocumentProcessingSettings } from "../workspaceDocumentProcessing";
import { modelConfigurationETag, validateWorkspaceModelDraft } from "../workspaceModelConfiguration";
import type { LocalWorkspaceProductStoreHandle } from "../localWorkspaceProductStoreRegistry";
import type { LocalSession } from "../localAuth";
import { boundLocalApiBody } from "../localApiBodyLimit";
import { assertMcpBrowserSession, mcpClient } from "./management";
import { mcpInputHash, type McpOperation } from "./operations";
import { registerMcpTool, toolResult, type McpToolContext } from "./server";
import type { McpScope } from "./scopes";

const id = z.string().min(1).max(200);

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("workspace.rename"), name: z.string().trim().min(1).max(200) }).strict(),
  z.object({ action: z.literal("workspace.retention"), disabled: z.boolean() }).strict(),
  z.object({ action: z.literal("workspace.processing"), enable_smart_splitting: z.boolean(), exclude_blank_pages: z.boolean() }).strict(),
  z.object({ action: z.literal("workspace.invite"), email: z.email().max(254), role: z.enum(["member", "admin"]) }).strict(),
  z.object({ action: z.literal("workspace.cancel_invitation"), invitation_id: id }).strict(),
  z.object({ action: z.literal("workspace.member"), user_id: id, change: z.enum(["remove_user", "make_admin", "make_member"]) }).strict(),
  z.object({ action: z.literal("workspace.transfer_ownership"), user_id: id }).strict(),
  z.object({ action: z.literal("workspace.rotate_api_key") }).strict(),
  z.object({ action: z.literal("workspace.delete") }).strict(),
  z.object({ action: z.literal("template.delete"), template_id: id, expected_version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("tag.delete"), tag_id: id, expected_name: z.string().min(1).max(80) }).strict(),
  z.object({ action: z.literal("document.delete"), document_id: id }).strict(),
  z.object({ action: z.literal("packet.delete"), packet_id: id }).strict(),
  z.object({ action: z.literal("gateway.clear"), expected_revision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("gateway.save"), expected_revision: z.number().int().positive().nullable(), configuration: z.record(z.string(), z.json()), replace_api_key: z.boolean() }).strict(),
  z.object({ action: z.literal("gateway.test"), expected_revision: z.number().int().positive() }).strict(),
]);

type Action = z.infer<typeof actionSchema>;

const policies: Record<Action["action"], { scope: McpScope; title: string; description: string }> = {
  "workspace.rename": { scope: "workspace:settings", title: "Rename workspace", description: "Everyone in this workspace will see the new name." },
  "workspace.retention": { scope: "workspace:settings", title: "Change original retention", description: "This changes whether originals of future documents are retained." },
  "workspace.processing": { scope: "workspace:settings", title: "Change document processing", description: "These settings apply to future documents and may affect model charges." },
  "workspace.invite": { scope: "workspace:invitations", title: "Invite workspace member", description: "This person can access workspace data after accepting the invitation." },
  "workspace.cancel_invitation": { scope: "workspace:invitations", title: "Cancel workspace invitation", description: "This invitation will no longer grant workspace access." },
  "workspace.member": { scope: "workspace:members", title: "Change member access", description: "This changes the selected member's workspace access." },
  "workspace.transfer_ownership": { scope: "workspace:ownership", title: "Transfer workspace ownership", description: "The selected member becomes the workspace owner." },
  "workspace.rotate_api_key": { scope: "workspace:api-key", title: "Rotate workspace API key", description: "The current API key stops working immediately; the new key is shown here once." },
  "workspace.delete": { scope: "workspace:delete", title: "Delete workspace", description: "All workspace documents, templates and retained originals will be deleted. This can't be undone." },
  "template.delete": { scope: "templates:delete", title: "Delete template", description: "The selected template will be deleted. This can't be undone." },
  "tag.delete": { scope: "templates:delete", title: "Delete template tag", description: "The tag will be removed from every template that uses it. Templates remain available." },
  "document.delete": { scope: "documents:delete", title: "Delete document", description: "The selected document and its retained original will be deleted. This can't be undone." },
  "packet.delete": { scope: "documents:delete", title: "Delete document packet", description: "The packet and all of its documents will be deleted. This can't be undone." },
  "gateway.clear": { scope: "workspace:model-gateway", title: "Clear Model gateway", description: "New document processing stops until a Model gateway is configured." },
  "gateway.save": { scope: "workspace:model-gateway", title: "Change Model gateway", description: "Future documents and the API key will be sent to the displayed gateway address." },
  "gateway.test": { scope: "workspace:model-gateway", title: "Test Model gateway", description: "A test request will be sent to the current gateway and may incur a model charge." },
};

export function assertMcpApprovalAccess(context: McpToolContext, request: JsonObject): void {
  assertAction(context, actionSchema.parse(request));
}

export function mcpActionScope(request: JsonObject): McpScope | null {
  const parsed = actionSchema.safeParse(request);

  return parsed.success ? policies[parsed.data.action].scope : null;
}

function assertAction(context: McpToolContext, action: Action): void {
  if (!context.authorization.configuration.sensitiveActions) throw new HttpError(403, "mcp_sensitive_actions_disabled", "This installation has not enabled delegated actions that require approval.");
  const workspace = context.authorization.grants.authorize(context.actor, context.product.workspaceControl, policies[action.action].scope);

  if (action.action.startsWith("workspace.") || action.action.startsWith("gateway.")) {
    if (workspace.role === "member") throw new HttpError(403, "forbidden", "Only workspace owners and admins can request this action.");
  }

  if (["workspace.delete", "workspace.transfer_ownership", "workspace.rotate_api_key"].includes(action.action) && workspace.role !== "owner") {
    throw new HttpError(403, "forbidden", "Only the workspace owner can request this action.");
  }
}

async function snapshot(context: McpToolContext, action: Action): Promise<{ revision: string; targets: Array<{ id: string; label: string }> }> {
  return context.withStore(policies[action.action].scope, (store) => snapshotInStore(context, action, store));
}

function snapshotInStore(context: McpToolContext, action: Action, store?: LocalWorkspaceProductStoreHandle) {
  assertAction(context, action);
  const { actor, product } = context;
  const workspace = product.workspaceControl.getAcceptedWorkspaceContext({ workspaceId: actor.workspaceId, userId: actor.userId });

  if (!workspace) throw new HttpError(403, "mcp_workspace_unavailable", "The workspace is no longer accessible.");

  const targets = [{ id: workspace.id, label: workspace.name }];
  let state: JsonObject = { workspace: toolResult(workspace) };

  if (action.action === "template.delete") {
    const template = store!.getTemplate(action.template_id);

    if (!template) throw new HttpError(404, "not_found", "Template not found.");

    if (template.current_version !== action.expected_version) throw new HttpError(409, "mcp_approval_stale", "The template changed. Request approval again.");
    targets.push({ id: template.id, label: template.name });
    state = { template_id: template.id, version: template.current_version, updated_at: template.updated_at };
  } else if (action.action === "tag.delete") {
    const tag = store!.listTemplateTags().find((tag) => tag.id === action.tag_id);

    if (!tag) throw new HttpError(404, "not_found", "Tag not found.");

    if (tag.name !== action.expected_name) throw new HttpError(409, "mcp_approval_stale", "The tag changed. Request approval again.");
    targets.push({ id: tag.id, label: tag.name });
    state = toolResult(tag);
  } else if (action.action === "document.delete") {
    const document = store!.getExtractionJobSummary(action.document_id);

    if (!document) throw new HttpError(404, "not_found", "Document not found.");
    targets.push({ id: action.document_id, label: document.source_name ?? action.document_id });
    state = toolResult(document);
  } else if (action.action === "packet.delete") {
    const packet = store!.getDocumentPacket(action.packet_id);

    if (!packet) throw new HttpError(404, "not_found", "Document packet not found.");
    targets.push({ id: action.packet_id, label: packet.source_name ?? action.packet_id });
    state = { packet_id: packet.packet_id, revision: packet.plan_revision, status: packet.status, child_ids: packet.child_slots.map((child) => child.job_id) };
  } else if (action.action.startsWith("gateway.")) {
    const configuration = store!.getModelConfiguration();
    const expected = "expected_revision" in action ? action.expected_revision : null;

    if ((configuration?.revision ?? null) !== expected) throw new HttpError(409, "mcp_approval_stale", "The Model gateway changed. Request approval again.");

    if (action.action === "gateway.save") {
      if ("credential" in action.configuration) throw new HttpError(400, "mcp_secret_not_allowed", "Enter the API key in the application approval screen.");
      validateWorkspaceModelDraft(action.configuration);
    }

    state = { revision: configuration?.revision ?? null };
  } else if (action.action === "workspace.processing") {
    state = toolResult(store!.getDocumentProcessingSettings());
  } else {
    if (workspace.role !== "member") state.members = toolResult({ members: product.workspaceControl.listWorkspaceUsers({ workspaceId: workspace.id, userId: actor.userId }) });

    if ("user_id" in action) {
      const member = product.workspaceControl.listWorkspaceUsers({ workspaceId: workspace.id, userId: actor.userId }).find((member) => member.user_id === action.user_id);

      if (!member) throw new HttpError(404, "not_found", "Member not found.");
      targets.push({ id: member.user_id, label: `${member.name} (${member.email})` });
    }

    if (action.action === "workspace.cancel_invitation") {
      const invitation = product.workspaceControl.listWorkspaceInvitations({ workspaceId: workspace.id, userId: actor.userId }).find((invitation) => invitation.id === action.invitation_id);

      if (!invitation) throw new HttpError(404, "not_found", "Invitation not found.");
      targets.push({ id: invitation.id, label: invitation.email });
      state.invitation = toolResult(invitation);
    }

    if (action.action === "workspace.delete") product.workspaceControl.assertWorkspaceDeletion({ workspaceId: workspace.id, userId: actor.userId });
  }

  return { revision: mcpInputHash(state), targets };
}

export function registerMcpApprovalTools(server: McpServer, context: McpToolContext) {
  if (!context.authorization.configuration.sensitiveActions) return;

  registerMcpTool(server, context, "request_action_approval", "workspace:read",
    "Request exact-action approval in the application. The user must open approval_url and approve; a client confirmation never executes an action. Required capabilities depend on the action. Secrets must be entered in the application. Reuse operation_id for retries.",
    z.object({ operation_id: z.string().min(8).max(200), request: actionSchema }).strict(), async ({ operation_id, request }) => {
      const scope = policies[request.action].scope;
      context.assert(scope);
      const previous = context.operations.find(context.actor, request.action, operation_id);

      if (previous) {
        assertAction(context, request);

        if (mcpInputHash({ request }) !== mcpInputHash({ request: previous.input.request })) {
          throw new HttpError(409, "mcp_idempotency_conflict", "This operation key was already used with different inputs.");
        }

        return { status: previous.status, request_id: previous.id, approval_required: previous.status === "pending",
          approval_url: context.url(`/mcp/approvals/${previous.id}`), expires_at: previous.expires_at };
      }

      const current = await snapshot(context, request);
      context.assert(scope);

      const operation = context.operations.prepare(context.actor, request.action, operation_id,
        { request, revision: current.revision, targets: current.targets }, true);

      return { status: operation.status, request_id: operation.id, approval_required: operation.status === "pending",
        approval_url: context.url(`/mcp/approvals/${operation.id}`), expires_at: operation.expires_at };
    }, true);
}

export async function approvalResponse(response: Response): Promise<JsonObject> {
  if (response.status === 204) return { ok: true };
  const parsed = parseJson(await response.text());

  if (!response.ok) {
    const error = isJsonObject(parsed) && isJsonObject(parsed.error) ? parsed.error : null;

    throw new HttpError(response.status, z.string().parse(error?.code ?? "mcp_operation_failed"), z.string().parse(error?.message ?? "The action could not be completed."));
  }

  if (!isJsonObject(parsed)) throw new Error("Invalid operation response");

  return parsed;
}

function delegatedProduct(context: McpToolContext, scope: McpScope): ProductServices {
  return { ...context.product, delegation: { actor: context.actor, grants: context.authorization.grants, scope } };
}

async function execute(context: McpToolContext, operation: McpOperation, action: Action, session: LocalSession, secret?: string): Promise<{ result: JsonObject; secret?: string }> {
  const { actor, product, operations } = context;
  const scope = policies[action.action].scope;
  const workspaceId = actor.workspaceId;
  const userId = actor.userId;

  const assertCommit = (store?: LocalWorkspaceProductStoreHandle) => {
    assertMcpBrowserSession(session);

    if (operation.expires_at <= nowIso()) throw new HttpError(410, "mcp_approval_expired", "This approval expired. Request approval again.");

    if (snapshotInStore(context, action, store).revision !== operation.input.revision) {
      throw new HttpError(409, "mcp_approval_stale", "The target changed. Request approval again.");
    }
  };

  const target = delegatedProduct(context, scope);

  if (target.delegation) {
    target.delegation.assertCurrent = assertCommit;

    const receiptResult = action.action === "document.delete" ? { deleted: true, job_id: action.document_id }
      : action.action === "packet.delete" ? { deleted: true, packet_id: action.packet_id }
      : { ok: true, management_url: context.url(`/workspaces/${workspaceId}`) };

    target.delegation.receipt = { id: operation.id, inputHash: operation.input_hash, result: receiptResult };
  }

  const controlMutation = (work: () => JsonObject) => operations.transaction(() => {
    assertCommit();
    const result = work();
    operations.complete(operation.id, result);
    context.authorization.grants.audit({ actor, action: action.action, requestId: operation.id, approvalId: operation.id, outcome: "committed" });

    return { result };
  });

  switch (action.action) {
    case "workspace.rename": return controlMutation(() => toolResult(product.workspaceControl.renameWorkspace({ workspaceId, userId, name: action.name })));
    case "workspace.retention": return controlMutation(() => toolResult(product.workspaceControl.setWorkspaceSourceRetention({ workspaceId, userId, disabled: action.disabled })));
    case "workspace.invite": return controlMutation(() => toolResult(product.workspaceControl.createInvitation({ workspaceId, inviterUserId: userId, email: action.email, role: action.role })));
    case "workspace.cancel_invitation": return controlMutation(() => toolResult(product.workspaceControl.cancelInvitation({ workspaceId, userId, invitationId: action.invitation_id })));
    case "workspace.member": return controlMutation(() => toolResult(product.workspaceControl.applyWorkspaceMemberAction({ workspaceId, actorUserId: userId, targetUserId: action.user_id, action: action.change })));
    case "workspace.transfer_ownership": return controlMutation(() => toolResult(product.workspaceControl.applyWorkspaceMemberAction({ workspaceId, actorUserId: userId, targetUserId: action.user_id, action: "make_owner" })));
    case "workspace.rotate_api_key": {
      let secret: string | undefined;

      const completed = controlMutation(() => {
        const rotated = product.workspaceControl.rotateApiKey({ workspaceId, userId });
        secret = rotated.api_key;

        return { workspace_id: workspaceId, rotated: true };
      });

      return { ...completed, secret };
    }

    case "template.delete":
    case "tag.delete":
    case "workspace.processing": {
      const result = await context.withStore(scope, (store) => store.runMcpProductOperation(operation.id, operation.input_hash, () => {
        assertCommit(store);

        if (action.action === "workspace.processing") return toolResult(store.putDocumentProcessingSettings(validateDocumentProcessingSettings({ enable_smart_splitting: action.enable_smart_splitting, exclude_blank_pages: action.exclude_blank_pages })));

        if (action.action === "tag.delete") {
          if (!store.deleteTemplateTag({ tagId: action.tag_id, updatedAt: nowIso() })) throw new HttpError(404, "not_found", "Tag not found.");

          return { deleted: true, tag_id: action.tag_id };
        }

        const current = store.getTemplate(action.template_id);

        if (current?.current_version !== action.expected_version) throw new HttpError(409, "mcp_approval_stale", "The template changed. Request approval again.");

        if (!store.deleteTemplate({ templateId: action.template_id, deletedAt: nowIso() })) throw new HttpError(404, "not_found", "Template not found.");

        return { deleted: true, template_id: action.template_id };
      }));

      return { result };
    }

    case "workspace.delete": {
      if (!context.runtime.workspaceDeletion) throw new HttpError(503, "mcp_operation_unavailable", "Workspace deletion is unavailable.");
      await context.runtime.workspaceDeletion.deleteWorkspace({ workspaceId, userId, assertAuthorized: () => assertCommit(),
        commit: (work) => { controlMutation(() => { work();

 return { deleted: true, workspace_id: workspaceId }; }); },
      });

      return { result: { deleted: true, workspace_id: workspaceId } };
    }

    case "document.delete": return { result: await approvalResponse(await handleLocalJobRead({ product: target, jobId: action.document_id,
      jobCursorSecret: new Uint8Array(32), jobPageSize: 25, request: new Request(context.url(`/v1/jobs/${encodeURIComponent(action.document_id)}`), { method: "DELETE", signal: context.signal }) })) };
    case "packet.delete": return { result: await approvalResponse(await handleDocumentProcessingRequest({ product: target,
      request: new Request(context.url(`/v1/packets/${encodeURIComponent(action.packet_id)}`), { method: "DELETE", signal: context.signal }), scheduleQueuedJob: context.runtime.scheduleQueuedJob })) };
    case "gateway.clear":
    case "gateway.save":
    case "gateway.test": {
      const current = await context.withStore(scope, (store) => store.getModelConfiguration());
      const headers = new Headers({ "content-type": "application/json" });
      headers.set(action.expected_revision === null ? "if-none-match" : "if-match", action.expected_revision === null ? "*" : modelConfigurationETag(action.expected_revision));
      let body: JsonObject | undefined;

      if (action.action === "gateway.save") {
        body = { ...action.configuration };

        if (action.replace_api_key) {
          if (!secret) throw new HttpError(400, "mcp_secret_required", "Enter an API key to approve this action.");
          body.credential = secret;
        }
      } else if (action.action === "gateway.test") {
        if (!current) throw new HttpError(409, "mcp_approval_stale", "The Model gateway is no longer configured.");
        const { credential_ciphertext: _secret, revision: _revision, created_at: _created, updated_at: _updated, ...draft } = current;
        body = toolResult(draft);
      }

      const requestOptions: RequestInit = {
        method: action.action === "gateway.clear" ? "DELETE" : action.action === "gateway.test" ? "POST" : "PUT",
        headers, signal: context.signal,
      };

      if (body) requestOptions.body = JSON.stringify(body);
      const request = new Request(context.url(`/v1/workspaces/${workspaceId}/model-configuration`), requestOptions);

      const response = await handleWorkspaceModelConfiguration({ request, workspaceId, test: action.action === "gateway.test",
        auth: product.auth, workspaceControl: product.workspaceControl, access: product.access, stateDirectory: product.stateDirectory,
        delegation: target.delegation, onModelConfigurationChanged: context.runtime.onWorkspaceModelConfigurationChanged,
        liveUpdateHub: context.runtime.liveUpdateHub });

      await approvalResponse(response);

      return { result: { ok: true, management_url: context.url(`/workspaces/${workspaceId}`) } };
    }
  }
}

export async function handleMcpApproval(request: Request, session: LocalSession, contextFor: (grantId: string) => McpToolContext): Promise<Response | null> {
  const match = /^\/v1\/mcp\/approvals\/([^/]+)$/.exec(new URL(request.url).pathname);

  if (!match) return null;
  // A context lookup with the approval ID first is supplied by the runtime;
  // it never accepts a user/client/grant from browser input.
  const context = contextFor(decodeURIComponent(match[1]!));
  const operation = context.operations.get(decodeURIComponent(match[1]!));

  if (!operation || !operation.approval || context.actor.userId !== session.id) throw new HttpError(404, "mcp_approval_not_found", "Approval request not found.");
  const action = actionSchema.parse(operation.input.request);
  const policy = policies[action.action];

  const represent = (secret?: string) => {
    const latest = context.operations.get(operation.id) ?? operation;
    const grant = context.authorization.grants.get(operation.grant_id);

    if (!grant) throw new HttpError(404, "mcp_approval_not_found", "Approval request not found.");
    const workspace = context.product.workspaceControl.getAcceptedWorkspaceContext({ workspaceId: operation.workspace_id, userId: session.id });

    const response: JsonObject = { id: operation.id, client: mcpClient(grant), workspace: { id: operation.workspace_id, name: workspace?.name ?? "Unavailable workspace" },
      action: action.action, title: policy.title, description: policy.description, targets: operation.input.targets,
      parameters: action, expires_at: operation.expires_at,
      status: latest.status === "pending" && operation.expires_at <= nowIso() ? "expired" : latest.status,
      result: secret ? { ...latest.result, api_key: secret } : latest.result,
      requires_secret: action.action === "gateway.save" && action.replace_api_key ? { field: "api_key", label: "API key" } : null };

    return Response.json(response);
  };

  if (request.method === "GET") return represent();

  if (request.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use GET or POST.");
  assertMcpBrowserSession(session);
  const body = z.object({ decision: z.enum(["approve", "deny"]), secret: z.string().max(8192).optional() }).strict().parse(await (await boundLocalApiBody(request, 16384)).json());

  if (operation.status === "executing" || operation.status === "failed") {
    assertAction(context, action);
    const recovered = await context.withStore(policy.scope, (store) => store.getMcpOperationReceipt(operation.id));

    if (recovered) context.operations.recover(context.actor, operation.id, recovered);
  }

  if (operation.status !== "pending") return represent();

  if (body.decision === "deny") {
    context.operations.deny(operation.id);

    return represent();
  }

  const current = await snapshot(context, action);

  if (current.revision !== operation.input.revision) throw new HttpError(409, "mcp_approval_stale", "The target changed. Ask the app to request approval again.");
  assertMcpBrowserSession(session);
  assertAction(context, action);

  if (action.action === "gateway.save" && action.replace_api_key && !body.secret) {
    throw new HttpError(400, "mcp_secret_required", "Enter an API key to approve this action.");
  }

  if (!context.operations.claim(operation.id)) return represent();

  try {
    const completed = await execute(context, operation, action, session, body.secret);
    context.operations.transaction(() => {
      context.operations.complete(operation.id, completed.result);
      context.authorization.grants.audit({ actor: context.actor, action: action.action, requestId: operation.id, approvalId: operation.id, outcome: "completed" });
    });
    context.runtime.liveUpdateHub?.broadcastWorkspaceContextInvalidation({ workspaceId: context.actor.workspaceId, reason: "workspace_access", occurredAt: nowIso() });

    assertMcpBrowserSession(session);

    return represent(completed.secret);
  } catch (error) {
    context.operations.fail(operation.id, error instanceof HttpError ? error.code : "mcp_operation_failed");
    throw error;
  }
}
