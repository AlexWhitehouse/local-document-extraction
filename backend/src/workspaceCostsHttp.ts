import { HttpError, toHttpError } from "./lib/http";
import type { LocalAuth } from "./localAuth";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import { LocalWorkspaceProductDataAccessError, type LocalWorkspaceProductDataAccess } from "./localWorkspaceProductDataAccess";
import { parseCostRange } from "../../shared/workspaceCosts";
import type { CostListQuery } from "./workspaceCostQueries";

export async function handleWorkspaceCosts(input: {
  request: Request; workspaceId: string; resource: string; documentId?: string;
  auth: LocalAuth; workspaceControl: LocalWorkspaceControl; access: LocalWorkspaceProductDataAccess;
}): Promise<Response> {
  const headers = { "cache-control": "private, no-store" };
  try {
    const session = await input.auth.getSession(input.request);
    if (!session) throw new HttpError(401, "unauthorized", "Authentication required");
    const workspace = input.workspaceControl.getAcceptedWorkspaceContext({ workspaceId: input.workspaceId, userId: session.id });
    if (!workspace || !["owner", "admin"].includes(workspace.role)) throw new HttpError(403, "forbidden", "Costs are visible to Workspace owners and admins.");
    if (input.request.method !== "GET") return Response.json({ error: { code: "method_not_allowed", message: "Use GET." } }, { status: 405, headers: { ...headers, allow: "GET" } });
    const params = new URL(input.request.url).searchParams;
    const range = input.documentId ? null : parseCostRange(params.get("start"), params.get("end"), params.get("unit"));
    const sort = params.get("sort") ?? "recent", kind = params.get("kind") ?? "all", search = (params.get("search") ?? "").trim();
    if (!["recent", "total", "perPage"].includes(sort) || !["all", "multi", "single"].includes(kind) || search.length > 200) throw new RangeError("Invalid cost filters.");
    return await input.access.run({ workspaceId: input.workspaceId, mode: "create" }, ({ store }) => {
      // Reads use already materialized summaries. The background worker owns bounded catch-up.
      const data = input.documentId ? store!.getCostUpload(input.documentId)
        : input.resource === "overview" ? store!.getCostOverview(range!)
        : store!.listCostUploads({ ...range!, sort, kind, search, cursor: params.get("cursor") } as CostListQuery);
      if (!data) throw new HttpError(404, "not_found", "Cost history is unavailable for this document.");
      return Response.json(data, { headers });
    });
  } catch (error) {
    if (error instanceof LocalWorkspaceProductDataAccessError) return Response.json({ error: { code: "workspace_product_store_unavailable", message: "Workspace cost history is temporarily unavailable." } }, { status: 503, headers });
    const failure = error instanceof RangeError ? new HttpError(400, "invalid_cost_query", error.message) : toHttpError(error);
    return Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status, headers });
  }
}
