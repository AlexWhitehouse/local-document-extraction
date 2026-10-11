const sections = new Set(["documents", "templates", "evaluations", "packets"]);

export function parseAppRoute(pathname) {
  if (pathname === "/") return { page: "workspace", root: true };

  if (pathname === "/reset-password") return { page: "reset-password" };

  if (pathname === "/admin") return { page: "admin" };

  if (pathname === "/connected-apps") return { page: "connected-apps" };

  if (pathname === "/mcp/connect") return { page: "mcp-connect", delegated: true };

  try {
    const parts = pathname.replace(/\/$/, "").split("/").slice(1).map(decodeURIComponent);

    if (parts.some((part) => !part || /[/\\]/.test(part) || [...part].some((char) => char.charCodeAt(0) < 32)))
      return { page: "not-found" };

    if (parts[0] === "invitations" && parts.length === 2) return { page: "workspace", invitationId: parts[1] };

    // Delegated access pages open from links an MCP client shows; they sit outside Workspace routes.
    if (parts[0] === "mcp" && parts.length === 3 && parts[1] === "approvals")
      return { page: "mcp-approval", delegated: true, approvalId: parts[2] };

    if (parts[0] === "mcp" && parts.length === 3 && parts[1] === "uploads")
      return { page: "mcp-upload", delegated: true, uploadId: parts[2] };

    if (parts[0] !== "workspaces" || !parts[1]) return { page: "not-found" };
    const workspaceId = parts[1];

    if (parts.length === 2) return { page: "workspace", workspaceId };
    const section = parts[2];

    if (section === "costs" && (parts.length === 3 || (parts.length === 4 && parts[3] === "documents"))) {
      return { page: "costs", workspaceId, costTab: parts[3] === "documents" ? "documents" : "overview" };
    }

    if (section === "packets" && parts.length === 6 && parts[4] === "documents") {
      return { page: "documents", workspaceId, packetId: parts[3], documentId: parts[5] };
    }

    if (
      !sections.has(section) ||
      parts.length > 4 ||
      (section === "evaluations" && parts.length !== 3) ||
      (section === "packets" && parts.length !== 4)
    )
      return { page: "not-found" };

    const route = { page: section === "packets" ? "documents" : section, workspaceId };

    if (section === "packets") route.packetId = parts[3];

    if (section === "documents") route.documentId = parts[3] || "";

    if (section === "templates") route.templateId = parts[3] || "";

    return route;
  } catch {
    return { page: "not-found" };
  }
}

export function appPath({
  page = "workspace",
  workspaceId,
  documentId,
  templateId,
  packetId,
  invitationId,
  costTab,
} = {}) {
  if (page === "admin") return "/admin";

  if (page === "connected-apps") return "/connected-apps";

  if (invitationId) return `/invitations/${encodeURIComponent(invitationId)}`;

  if (!workspaceId) return "/";
  const root = `/workspaces/${encodeURIComponent(workspaceId)}`;

  if (page === "workspace") return root;

  if (page === "costs") return `${root}/costs${costTab === "documents" ? "/documents" : ""}`;

  if (packetId && page === "documents")
    return `${root}/packets/${encodeURIComponent(packetId)}${documentId ? `/documents/${encodeURIComponent(documentId)}` : ""}`;
  const id = page === "templates" ? templateId : page === "documents" ? documentId : "";

  return `${root}/${page}${id ? `/${encodeURIComponent(id)}` : ""}`;
}

export function followAppLink(event, navigate) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  navigate();
}
