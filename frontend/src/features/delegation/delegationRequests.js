import { isString } from "../../../../shared/json.ts";

// Requests for delegated MCP access: consent, Connected apps, approvals and uploads.
// Every call uses the browser session cookie; none takes a Workspace header.
export function createDelegationRequests(request) {
  const json = (body) => ({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return {
    getConsent: (oauthQuery, signal) =>
      request(`/mcp/consent?oauth_query=${encodeURIComponent(oauthQuery)}`, { method: "GET", signal }),
    submitConsent: (body) => request("/mcp/consent", { method: "POST", ...json(body) }),
    listConnections: (signal) => request("/mcp/connections", { method: "GET", signal }),
    revokeConnection: (id) => request(`/mcp/connections/${encodeURIComponent(id)}`, { method: "DELETE" }),
    getApproval: (id, signal) => request(`/mcp/approvals/${encodeURIComponent(id)}`, { method: "GET", signal }),
    decideApproval: (id, body) => request(`/mcp/approvals/${encodeURIComponent(id)}`, { method: "POST", ...json(body) }),
    getUpload: (id, signal) => request(`/mcp/uploads/${encodeURIComponent(id)}`, { method: "GET", signal }),
    uploadFile: (id, file) => {
      const form = new FormData();
      form.append("file", file);

      return request(`/mcp/uploads/${encodeURIComponent(id)}`, { method: "POST", body: form });
    },
  };
}

// The signed authorization request is the connect page's whole query string. A nested
// oauth_query parameter is used as-is when present; nothing else from the query is trusted.
export function oauthQueryFromSearch(search) {
  const query = String(search || "").replace(/^\?/, "");
  const nested = new URLSearchParams(query).get("oauth_query");

  return nested || query;
}

// Only the backend's consent response chooses where the browser goes next. It is either
// the client's registered redirect or back to this app's connect page when sign-in has to
// happen again. Client redirects must be HTTPS, loopback HTTP, or a reverse-domain app
// scheme (com.example.app:/callback). Script, data and file URLs are refused.
export function consentRedirectTarget(value, origin = window.location.origin) {
  if (!isString(value) || !value.trim()) return null;

  let url;

  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }

  if (url.username || url.password) return null;

  if (url.origin === origin) return url.pathname === "/mcp/connect" ? url.href : null;

  if (url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname))) return url.href;

  return /^[a-z][a-z0-9+-]*(\.[a-z0-9+-]+)+:$/i.test(url.protocol) ? url.href : null;
}

// A delegated page returns to itself after sign-in or email verification. The path comes
// from the parsed route, never from a query parameter.
export function continuationPath(route, search = "") {
  if (route.page === "mcp-connect") return `/mcp/connect${search ? `?${String(search).replace(/^\?/, "")}` : ""}`;

  if (route.page === "mcp-approval") return `/mcp/approvals/${encodeURIComponent(route.approvalId)}`;

  if (route.page === "mcp-upload") return `/mcp/uploads/${encodeURIComponent(route.uploadId)}`;

  return "/";
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
