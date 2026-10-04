import type { LocalWorkspace, LocalWorkspaceControl } from "../localWorkspaceControl";

function unexpectedControlCall(): never {
  throw new Error("This test did not configure the requested Workspace control operation");
}

/** A complete dependency seam: unexpected control operations fail the test immediately. */
export function workspaceControlFixture(overrides: Partial<LocalWorkspaceControl>): LocalWorkspaceControl {
  return {
    acceptInvitation: unexpectedControlCall,
    applyWorkspaceMemberAction: unexpectedControlCall,
    assertWorkspaceDeletion: unexpectedControlCall,
    authorizeApiKey: unexpectedControlCall,
    createInvitation: unexpectedControlCall,
    cancelInvitation: unexpectedControlCall,
    completeWorkspaceDeletionIntent: unexpectedControlCall,
    declineInvitation: unexpectedControlCall,
    completeStarterTemplateBootstrap: unexpectedControlCall,
    createWorkspace: unexpectedControlCall,
    deleteWorkspace: unexpectedControlCall,
    revokeWorkspaceForDeletion: unexpectedControlCall,
    getAcceptedWorkspaceContext: unexpectedControlCall,
    hasPendingStarterTemplateBootstrap: unexpectedControlCall,
    listPendingInvitations: unexpectedControlCall,
    leaveWorkspace: unexpectedControlCall,
    listWorkspaceInvitations: unexpectedControlCall,
    listWorkspaceUsers: unexpectedControlCall,
    listWorkspaceDeletionIntents: unexpectedControlCall,
    recordWorkspaceDeletionIntent: unexpectedControlCall,
    listAcceptedWorkspaces: unexpectedControlCall,
    renameWorkspace: unexpectedControlCall,
    setWorkspaceSourceRetention: unexpectedControlCall,
    rotateApiKey: unexpectedControlCall,
    workspaceExists: unexpectedControlCall,
    ...overrides,
  };
}

export function workspaceFixture(overrides: Partial<LocalWorkspace> = {}): LocalWorkspace {
  return {
    id: "workspace_a",
    name: "A",
    created_at: "2026-01-01T00:00:00.000Z",
    max_source_file_bytes: null,
    source_retention_disabled: false,
    has_api_key: true,
    role: "owner",
    ...overrides,
  };
}

export function isWorkspaceRole(value: string): value is LocalWorkspace["role"] {
  return value === "owner" || value === "admin" || value === "member";
}
