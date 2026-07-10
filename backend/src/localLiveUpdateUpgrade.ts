import type { LocalAuth } from "./localAuth";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";

export type LocalLiveUpdateUpgradeServer = {
  upgrade(request: Request, options: { data: { workspaceId: string } }): boolean;
};

export async function upgradeLocalLiveUpdate({
  auth,
  request,
  server,
  workspaceControl,
}: {
  auth: LocalAuth;
  request: Request;
  server: LocalLiveUpdateUpgradeServer;
  workspaceControl: LocalWorkspaceControl;
}): Promise<Response | undefined> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/live$/);
  if (!match) {
    return Response.json({ error: { code: "not_found", message: "Route not found" } }, { status: 404 });
  }
  if (request.method !== "GET") {
    return Response.json(
      { error: { code: "method_not_allowed", message: "Workspace live updates require GET" } },
      { status: 405 },
    );
  }
  if (bearerApiKey(request)) {
    return Response.json(
      { error: { code: "unsupported_auth_mode", message: "Workspace API keys cannot open live updates" } },
      { status: 403 },
    );
  }
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json(
      { error: { code: "invalid_websocket_upgrade", message: "Expected WebSocket upgrade" } },
      { status: 400 },
    );
  }

  const session = await auth.getSession(request);
  if (!session) {
    return Response.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 });
  }
  const workspaceId = decodeURIComponent(match[1] || "");
  const workspace = workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId: session.id });
  if (!workspace) {
    return Response.json(
      { error: { code: "forbidden", message: "You do not have access to this workspace" } },
      { status: 403 },
    );
  }
  if (server.upgrade(request, { data: { workspaceId: workspace.id } })) {
    return undefined;
  }
  return Response.json(
    { error: { code: "websocket_upgrade_failed", message: "WebSocket upgrade failed" } },
    { status: 500 },
  );
}

function bearerApiKey(request: Request): string | null {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
