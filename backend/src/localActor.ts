import type { LocalWorkspaceProductStoreHandle } from "./localWorkspaceProductStoreRegistry";
import type { JsonObject } from "../../shared/json";
import type { LocalAuth, LocalSession } from "./localAuth";
import type { LocalApiKeyWorkspace, LocalWorkspace, LocalWorkspaceControl } from "./localWorkspaceControl";
import type { DelegatedActor, McpGrantStore } from "./mcp/grants";
import type { McpScope } from "./mcp/scopes";
import { HttpError } from "./lib/http";

export type WorkspaceActor =
  | { kind: "browser"; session: LocalSession }
  | { kind: "api-key"; apiKey: string }
  | DelegatedActor;

export type DelegatedProductAccess = {
  actor: DelegatedActor; grants: McpGrantStore; scope: McpScope;
  assertCurrent?: (store: LocalWorkspaceProductStoreHandle) => void;
  receipt?: { id: string; inputHash: string; result: JsonObject };
};

/** Commit a delegated mutation and its recovery receipt in the same product transaction. */
export function commitDelegatedProductMutation<T>(delegation: DelegatedProductAccess | undefined, store: LocalWorkspaceProductStoreHandle, work: () => T): T {
  const receipt = delegation?.receipt;

  if (!receipt) return work();

  if (store.getMcpOperationReceipt(receipt.id)) throw new HttpError(409, "mcp_operation_pending", "The action was already committed. Retrieve its status.");
  const committed: T[] = [];
  store.runMcpProductOperation(receipt.id, receipt.inputHash, () => {
    delegation.assertCurrent?.(store);
    committed.push(work());

    return receipt.result;
  });

  return committed[0]!;
}

export async function authorizeWorkspaceUser(input: {
  request: Request; auth: LocalAuth; workspaceId: string; workspaceControl: LocalWorkspaceControl;
  delegation?: DelegatedProductAccess;
}) {
  const session = input.delegation ? null : await input.auth.getSession(input.request);

  if (!input.delegation && !session) throw new HttpError(401, "unauthorized", "Authentication required");
  const actor: WorkspaceActor = input.delegation?.actor ?? { kind: "browser", session: session! };
  const workspace = authorizeWorkspaceActor({ ...input, actor });

  if (!("role" in workspace)) throw new HttpError(403, "forbidden", "A user connection is required.");

  const assertAuthorized = () => {
    const current = authorizeWorkspaceActor({ ...input, actor });

    if (!("role" in current) || current.role !== workspace.role) {
      throw new HttpError(403, "workspace_role_changed", "Your workspace role changed. Try the request again.");
    }

    return current;
  };

  return { workspace, userId: actor.kind === "browser" ? actor.session.id : input.delegation!.actor.userId, assertAuthorized };
}

/**
 * Who may read processing costs: workspace owners and admins, as on the Costs page. An API key
 * carries no role, so it never may.
 */
export function canReadCosts(workspace: LocalWorkspace | LocalApiKeyWorkspace): boolean {
  return "role" in workspace && (workspace.role === "owner" || workspace.role === "admin");
}

/**
 * Whether the actor may read costs now. Browser sessions need an owner or admin role. Delegated
 * (MCP) connections also need the `workspace:costs` scope, as the MCP cost tools do.
 */
export function actorCanReadCosts(input: {
  actor: WorkspaceActor; workspaceId: string; workspaceControl: LocalWorkspaceControl;
  delegation?: DelegatedProductAccess;
}): boolean {
  const { actor } = input;

  if (actor.kind === "api-key") return false;

  if (actor.kind === "browser") return canReadCosts(authorizeWorkspaceActor(input));

  if (!input.delegation || actor.workspaceId !== input.workspaceId) return false;

  try {
    return canReadCosts(input.delegation.grants.authorize(actor, input.workspaceControl, "workspace:costs"));
  } catch (error) {
    if (error instanceof HttpError) return false;
    throw error;
  }
}

/** Resolve authority from persisted state, never a requested role or browser workspace selection. */
export function authorizeWorkspaceActor(input: {
  actor: WorkspaceActor; workspaceId: string; workspaceControl: LocalWorkspaceControl;
  delegation?: DelegatedProductAccess;
}): LocalWorkspace | LocalApiKeyWorkspace {
  const { actor, workspaceControl, workspaceId } = input;

  if (actor.kind === "delegated") {
    if (!input.delegation || actor.workspaceId !== workspaceId) throw new HttpError(403, "forbidden", "Workspace access denied.");

    return input.delegation.grants.authorize(actor, workspaceControl, input.delegation.scope);
  }

  if (actor.kind === "browser" && actor.session.isActive && !actor.session.isActive()) {
    throw new HttpError(401, "unauthorized", "Sign in again to continue.");
  }

  const workspace = actor.kind === "api-key"
    ? workspaceControl.authorizeApiKey({ apiKey: actor.apiKey })
    : workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId: actor.session.id });

  if (!workspace || workspace.id !== workspaceId) throw new HttpError(403, "forbidden", "Workspace access denied.");

  return workspace;
}
