import { HttpError } from "./http";
import { createAuth } from "./betterAuth";
import { authorizeWorkspaceForApiKey, authorizeWorkspaceForSession } from "./workspacePolicy";
import type { Env, Workspace } from "./types";

export type AuthContext = {
  workspace: Workspace;
  auth_mode: "api_key" | "session";
  user_id: string | null;
};

type SessionUser = {
  id: string;
  email: string;
  name: string;
};

export async function authenticate(request: Request, env: Env): Promise<AuthContext> {
  const apiKeyWorkspace = await authenticateViaApiKey(request, env.DB);
  if (apiKeyWorkspace) {
    return {
      workspace: apiKeyWorkspace,
      auth_mode: "api_key",
      user_id: null
    };
  }

  const session = await requireSession(request, env);
  const workspaceId = workspaceIdFromRequest(request);
  if (!workspaceId) {
    throw new HttpError(400, "missing_workspace", "Missing workspace context (x-workspace-id header)");
  }

  const memberWorkspace = await authorizeWorkspaceForSession(env.DB, { workspaceId, userId: session.id });

  if (!memberWorkspace) {
    throw new HttpError(403, "forbidden", "You do not have access to this workspace");
  }

  return {
    workspace: memberWorkspace,
    auth_mode: "session",
    user_id: session.id
  };
}

export async function requireSession(request: Request, env: Env): Promise<SessionUser> {
  const auth = createAuth(env, request);
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user?.id) {
    throw new HttpError(401, "unauthorized", "Authentication required");
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name
  };
}

function workspaceIdFromRequest(request: Request): string {
  const workspaceHeader = request.headers.get("x-workspace-id") || "";
  const workspaceId = workspaceHeader.trim();
  return workspaceId;
}

async function authenticateViaApiKey(request: Request, db: D1Database): Promise<Workspace | null> {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) {
    throw new HttpError(401, "unauthorized", "Missing API key");
  }

  const workspace = await authorizeWorkspaceForApiKey(db, { apiKey });

  if (!workspace) {
    throw new HttpError(401, "unauthorized", "Invalid API key");
  }

  return workspace;
}
