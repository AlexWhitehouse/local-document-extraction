import { HttpError, toHttpError } from "./lib/http";
import type { LocalAuth } from "./localAuth";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import { LocalWorkspaceProductDataAccessError, type LocalWorkspaceProductDataAccess } from "./localWorkspaceProductDataAccess";
import { DEFAULT_DOCUMENT_PROCESSING_SETTINGS, validateDocumentProcessingSettings } from "./workspaceDocumentProcessing";

const noStore = { "cache-control": "no-store" };

/** Session settings endpoint; the product admission path separately reads a policy snapshot. */
export async function handleWorkspaceDocumentProcessingSettings(input: {
  request: Request;
  workspaceId: string;
  auth: LocalAuth;
  workspaceControl: LocalWorkspaceControl;
  access: LocalWorkspaceProductDataAccess;
}): Promise<Response> {
  const { request, workspaceId } = input;
  try {
    const session = await input.auth.getSession(request);
    if (!session) throw new HttpError(401, "unauthorized", "Authentication required");
    const workspace = input.workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId: session.id });
    if (!workspace) throw new HttpError(403, "forbidden", "You do not have access to this workspace");
    if (request.method !== "GET" && workspace.role !== "owner" && workspace.role !== "admin") {
      throw new HttpError(403, "insufficient_workspace_role", "Only Workspace owners and admins can manage document processing settings.");
    }
    if (request.method !== "GET" && request.method !== "PUT") {
      return Response.json({ error: { code: "method_not_allowed", message: "Method not allowed" } }, { status: 405, headers: { ...noStore, allow: "GET, PUT" } });
    }
    const settings = request.method === "PUT"
      ? validateDocumentProcessingSettings(await request.json().catch(() => { throw new HttpError(400, "invalid_document_processing_settings", "Provide valid JSON for document processing settings."); }))
      : null;
    return await input.access.run({ workspaceId, mode: settings ? "create" : "existing" }, ({ store }) => {
      const result = settings ? store!.putDocumentProcessingSettings(settings) : store?.getDocumentProcessingSettings() ?? DEFAULT_DOCUMENT_PROCESSING_SETTINGS;
      return Response.json(result, { headers: noStore });
    });
  } catch (error) {
    const safe = error instanceof LocalWorkspaceProductDataAccessError
      ? error.code === "unexpected" ? toHttpError(error.cause) : new HttpError(503, "workspace_product_store_unavailable", "Workspace product storage is temporarily unavailable.")
      : toHttpError(error);
    return Response.json({ error: { code: safe.code, message: safe.message } }, { status: safe.status, headers: noStore });
  }
}
