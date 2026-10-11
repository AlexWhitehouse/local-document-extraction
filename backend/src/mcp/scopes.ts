export const MCP_SCOPE_DESCRIPTIONS = [
  { id: "workspace:read", label: "Workspace context", description: "Read the workspace and your current permissions.", requires_approval: false },
  { id: "documents:read", label: "Read documents", description: "Read document details and extracted answers.", requires_approval: false },
  { id: "sources:read", label: "Read originals", description: "Download retained originals and assigned document pages.", requires_approval: false },
  { id: "documents:submit", label: "Process documents", description: "Submit documents for processing, which may incur model charges.", requires_approval: false },
  { id: "documents:review", label: "Review documents", description: "Choose templates and confirm document splits.", requires_approval: false },
  { id: "documents:delete", label: "Delete documents", description: "Request approval to permanently delete documents.", requires_approval: true },
  { id: "templates:read", label: "Read templates", description: "Read templates, versions and tags.", requires_approval: false },
  { id: "templates:write", label: "Edit templates", description: "Create and update templates and request model assistance.", requires_approval: false },
  { id: "templates:delete", label: "Delete templates", description: "Request approval to permanently delete templates.", requires_approval: true },
  { id: "workspace:settings", label: "Workspace settings", description: "Read settings and request approval to change them.", requires_approval: true },
  { id: "workspace:costs", label: "Read costs", description: "Read workspace processing costs when your role permits it.", requires_approval: false },
  { id: "workspace:members", label: "Manage members", description: "Read members and request approval to change their access.", requires_approval: true },
  { id: "workspace:invitations", label: "Manage invitations", description: "Read invitations and request approval to invite or cancel.", requires_approval: true },
  { id: "workspace:ownership", label: "Transfer ownership", description: "Request approval to transfer workspace ownership.", requires_approval: true },
  { id: "workspace:delete", label: "Delete workspace", description: "Request approval to permanently delete the workspace.", requires_approval: true },
  { id: "workspace:api-key", label: "Rotate API key", description: "Request approval to replace the workspace API key.", requires_approval: true },
  { id: "workspace:model-gateway", label: "Model gateway", description: "Request approval to change or test the Model gateway.", requires_approval: true },
  { id: "offline_access", label: "Stay connected", description: "Keep access after you sign out, until the connection expires or you revoke it.", requires_approval: false },
] as const;

export type McpScope = (typeof MCP_SCOPE_DESCRIPTIONS)[number]["id"];

export const MCP_SCOPES = MCP_SCOPE_DESCRIPTIONS.map((scope) => scope.id);

export function isMcpScope(value: string): value is McpScope {
  return MCP_SCOPES.some((scope) => scope === value);
}
