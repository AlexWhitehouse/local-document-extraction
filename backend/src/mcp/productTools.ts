import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isJsonObject, type JsonObject } from "../../../shared/json";
import { HttpError } from "../lib/http";
import { newId, nowIso } from "../lib/ids";
import { normalizeTemplateTagName } from "../../../shared/templateTags";
import { createWorkspaceTemplate, updateWorkspaceTemplate } from "../workspaceTemplateOperations";
import { registerMcpTool, toolResult, type McpToolContext } from "./server";
import type { McpScope } from "./scopes";
import type { LocalWorkspaceProductStoreHandle } from "../localWorkspaceProductStoreRegistry";
import { createWorkspaceCredentialVault, publicModelConfiguration } from "../workspaceModelConfiguration";
import { parseCostRange } from "../../../shared/workspaceCosts";
import { handleDocumentProcessingRequest } from "../localDocumentProcessingHttp";
import { approvalResponse, assertMcpApprovalAccess } from "./approvals";
import { findMcpSubmissionResult } from "./operations";

export async function mutateMcpProduct(context: McpToolContext, scope: McpScope, action: string,
  key: string, input: JsonObject, work: (store: LocalWorkspaceProductStoreHandle) => JsonObject): Promise<JsonObject> {
  context.assert(scope);
  const operation = context.operations.prepare(context.actor, action, key, input, false);

  if (operation.status === "completed") return operation.result ?? {};

  return context.withStore(scope, (store) => {
    const previous = store.getMcpOperationReceipt(operation.id);

    if (previous) {
      context.operations.recover(context.actor, operation.id, previous);

      return previous;
    }

    if (!context.operations.claim(operation.id)) throw new HttpError(409, "mcp_operation_pending", "This operation is already being processed. Check its status before trying again.");

    try {
      const result = store.runMcpProductOperation(operation.id, operation.input_hash, () => {
        context.assert(scope);

        return work(store);
      });

      context.operations.transaction(() => {
        context.operations.complete(operation.id, result);
        context.authorization.grants.audit({ actor: context.actor, action, requestId: operation.id, outcome: "committed" });
      });

      return result;
    } catch (error) {
      context.operations.fail(operation.id, error instanceof HttpError ? error.code : "mcp_operation_failed");
      throw error;
    }
  });
}

export function registerMcpProductTools(server: McpServer, context: McpToolContext) {
  const id = z.string().min(1).max(200);
  const key = z.string().min(8).max(200).describe("A stable operation key reused unchanged when retrying this action.");
  const template = z.record(z.string(), z.json());

  registerMcpTool(server, context, "create_template", "templates:write", "Explicitly save a new template. No model call. Reuse operation_id on network retries to avoid duplicate templates.",
    z.object({ operation_id: key, template }).strict(), ({ operation_id, template }) =>
      mutateMcpProduct(context, "templates:write", "template.create", operation_id, { template }, (store) =>
        toolResult(createWorkspaceTemplate(store, template, newId("tpl")))), true);

  registerMcpTool(server, context, "update_template", "templates:write", "Explicitly save template edits only if expected_version and expected_updated_at still match. Read the template before editing; saving fields creates a new version. Existing documents keep their fixed version.",
    z.object({ operation_id: key, template_id: id, expected_version: z.number().int().positive(), expected_updated_at: z.string().min(1).max(40), patch: template }).strict(), (args) =>
      mutateMcpProduct(context, "templates:write", "template.update", args.operation_id, args, (store) =>
        toolResult(updateWorkspaceTemplate(store, args.template_id, args.patch, args.expected_version, args.expected_updated_at))), true);

  registerMcpTool(server, context, "rename_template_tag", "templates:write", "Rename a workspace template tag. The normal tag validation and uniqueness rules apply.",
    z.object({ operation_id: key, tag_id: id, name: z.string().min(1).max(80) }).strict(), (args) =>
      mutateMcpProduct(context, "templates:write", "tag.rename", args.operation_id, args, (store) => {
        const tag = store.renameTemplateTag({ tagId: args.tag_id, name: normalizeTemplateTagName(args.name), updatedAt: nowIso() });

        if (!tag) throw new HttpError(404, "not_found", "Tag not found.");

        return toolResult({ tag });
      }), true);

  registerMcpTool(server, context, "get_workspace_settings", "workspace:settings", "Read workspace processing and original-retention settings. Model gateway credentials are never returned.", z.object({}).strict(), () =>
    context.withStore("workspace:settings", (store) => {
      const workspace = context.authorization.grants.authorize(context.actor, context.product.workspaceControl, "workspace:settings");

      return toolResult({ name: workspace.name, source_retention_disabled: workspace.source_retention_disabled,
        processing: store.getDocumentProcessingSettings(), model_configuration_revision: store.getModelConfiguration()?.revision ?? null });
    }));

  registerMcpTool(server, context, "get_model_gateway", "workspace:model-gateway", "Read public Model gateway configuration and revision for a current workspace owner/admin. Credentials are never returned; changes require exact-action approval.",
    z.object({}).strict(), () => context.withStore("workspace:model-gateway", (store) => {
      const workspace = context.authorization.grants.authorize(context.actor, context.product.workspaceControl, "workspace:model-gateway");

      if (workspace.role === "member") throw new HttpError(403, "forbidden", "Only workspace owners and admins can read Model gateway settings.");

      return toolResult(publicModelConfiguration(store.getModelConfiguration(), workspace.id, true, createWorkspaceCredentialVault(context.product.stateDirectory)));
    }));

  registerMcpTool(server, context, "get_workspace_costs", "workspace:costs", "Read workspace cost totals over a bounded UTC date range, only for current owners/admins. No model calls.",
    z.object({ start: z.string(), end: z.string(), unit: z.enum(["hour", "day"]).default("day") }).strict(), ({ start, end, unit }) => {
      const workspace = context.authorization.grants.authorize(context.actor, context.product.workspaceControl, "workspace:costs");

      if (workspace.role === "member") throw new HttpError(403, "forbidden", "Costs are visible to workspace owners and admins.");

      return context.withStore("workspace:costs", (store) => {
        const current = context.authorization.grants.authorize(context.actor, context.product.workspaceControl, "workspace:costs");

        if (current.role === "member") throw new HttpError(403, "forbidden", "Costs are visible to workspace owners and admins.");

        return toolResult(store.getCostOverview(parseCostRange(start, end, unit)));
      });
    });

  registerMcpTool(server, context, "list_document_costs", "workspace:costs", "Read one page of document processing costs for a UTC date range. Only current workspace owners/admins may read costs. Use next_cursor to continue.",
    z.object({ start: z.string(), end: z.string(), unit: z.enum(["hour", "day"]).default("day"), sort: z.enum(["recent", "total", "perPage"]).default("recent"),
      kind: z.enum(["all", "multi", "single"]).default("all"), search: z.string().max(200).default(""), cursor: z.string().max(4000).optional() }).strict(),
    ({ start, end, unit, ...query }) => context.withStore("workspace:costs", (store) => {
      const workspace = context.authorization.grants.authorize(context.actor, context.product.workspaceControl, "workspace:costs");

      if (workspace.role === "member") throw new HttpError(403, "forbidden", "Costs are visible to workspace owners and admins.");

      return toolResult(store.listCostUploads({ ...parseCostRange(start, end, unit), ...query }));
    }));

  registerMcpTool(server, context, "get_document_costs", "workspace:costs", "Read recorded processing costs for one document or packet, including attempts. Only current owners/admins may read costs.",
    z.object({ document_id: id }).strict(), ({ document_id }) => context.withStore("workspace:costs", (store) => {
      const workspace = context.authorization.grants.authorize(context.actor, context.product.workspaceControl, "workspace:costs");

      if (workspace.role === "member") throw new HttpError(403, "forbidden", "Costs are visible to workspace owners and admins.");
      const costs = store.getCostUpload(document_id);

      if (!costs) throw new HttpError(404, "not_found", "Cost history is unavailable for this document.");

      return toolResult(costs);
    }));

  registerMcpTool(server, context, "get_operation", "workspace:read", "Read the status of your prior mutation or approval by its request ID. Never repeats the action.", z.object({ request_id: id }).strict(), async ({ request_id }) => {
    const operation = context.operations.get(request_id);

    if (!operation || operation.grant_id !== context.actor.grantId || operation.workspace_id !== context.actor.workspaceId) {
      throw new HttpError(404, "not_found", "Operation not found.");
    }

    const assertAccess = () => {
      if (operation.approval && isJsonObject(operation.input.request)) {
        assertMcpApprovalAccess(context, operation.input.request);
      } else {
        const operationScopes = new Map<string, McpScope>([
          ["template.create", "templates:write"], ["template.update", "templates:write"], ["tag.rename", "templates:write"],
          ["document.select_template", "documents:review"], ["document.submit", "documents:submit"],
        ]);

        const required = operationScopes.get(operation.action);

        if (!required) throw new HttpError(403, "forbidden", "This operation is not accessible.");
        context.assert(required);
      }
    };

    assertAccess();

    if (operation.status === "executing" || operation.status === "failed") {
      const receipt = await context.withStore("workspace:read", (store) => {
        assertAccess();

        return operation.action === "document.submit"
          ? findMcpSubmissionResult(store, operation.id)
          : store.getMcpOperationReceipt(operation.id);
      });

      assertAccess();

      if (receipt) context.operations.recover(context.actor, operation.id, receipt);
    }

    const current = context.operations.get(request_id)!;

    return { request_id, status: current.status, result: current.result };
  });

  registerMcpTool(server, context, "select_document_template", "documents:review", "Choose a template for a held document. Its current version is pinned and queued extraction may incur model charges. The document must still need a template.",
    z.object({ operation_id: key, document_id: id, template_id: id }).strict(), async (args) => {
      const output = await mutateMcpProduct(context, "documents:review", "document.select_template", args.operation_id, args, (store) => {
        if (!store.bindDocumentTemplate({ jobId: args.document_id, templateId: args.template_id, manual: true, updatedAt: nowIso() })) {
          throw new HttpError(409, "template_resolution_conflict", "The document no longer needs a template, or the template is unavailable.");
        }

        return toolResult({ document: store.getExtractionJobSummary(args.document_id) });
      });

      const job = await context.withStore("documents:review", (store) => store.getExtractionJobSummary(args.document_id));

      if (job) {
        context.runtime.liveUpdateHub?.broadcastJob(context.actor.workspaceId, job);

        try { await context.runtime.scheduleQueuedJob({ job_id: args.document_id, workspace_id: context.actor.workspaceId,
          template_id: job.template_id, template_version: job.template_version, enqueued_at: nowIso(), attempt: job.current_attempt + 1 }); }
        catch { /* The existing durable runner recovers queued extraction. */ }
      }

      return output;
    }, true);

  registerMcpTool(server, context, "confirm_split_plan", "documents:review", "Confirm the exact reviewed split plan and revision. Every selected page must be assigned once or explicitly excluded. Queued extraction may incur model charges. A stale plan must be read and reviewed again.",
    z.object({ packet_id: id, revision: z.number().int().nonnegative(), groups: z.array(z.object({ pages: z.array(z.number().int().positive()) }).strict()).max(1000),
      exclusions: z.array(z.object({ page: z.number().int().positive(), reason: z.string().max(1000) }).strict()).max(10000) }).strict(), async ({ packet_id, ...plan }) => {
      const request = new Request(context.url(`/v1/packets/${encodeURIComponent(packet_id)}/plan`), {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(plan), signal: context.signal,
      });

      return approvalResponse(await context.runtime.admission.run(request, () => handleDocumentProcessingRequest({
        product: { ...context.product, delegation: { actor: context.actor, grants: context.authorization.grants, scope: "documents:review" } },
        request, scheduleQueuedJob: context.runtime.scheduleQueuedJob, liveUpdateHub: context.runtime.liveUpdateHub,
      })));
    }, true);

  registerMcpTool(server, context, "export_results", "documents:read", "Read selected completed document results as bounded structured JSON, up to 20 documents. Missing or foreign document IDs are rejected.",
    z.object({ document_ids: z.array(id).min(1).max(20) }).strict(), ({ document_ids }) => context.withStore("documents:read", (store) => {
      const unique = [...new Set(document_ids)];
      const documents = store.getExtractionJobExports(unique);

      if (documents.length !== unique.length) throw new HttpError(404, "not_found", "One or more completed documents could not be found.");

      return toolResult({ documents });
    }));
}
