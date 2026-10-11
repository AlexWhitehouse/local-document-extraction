export type McpConfiguration = { enabled: boolean; sensitiveActions: boolean; allowedRedirectUris: string[] };

export function validateMcpConfiguration(baseURL: string, configuration: McpConfiguration): void {
  if (!configuration.enabled) return;

  const safeUrl = (value: string) => {
    try {
      const url = new URL(value);

      return !url.username && !url.password && !url.hash && !value.includes("*") &&
        (url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)));
    } catch { return false; }
  };

  if (!safeUrl(baseURL) || configuration.allowedRedirectUris.length > 64 || !configuration.allowedRedirectUris.every(safeUrl)) {
    throw new Error("MCP_ENABLED requires an HTTPS BETTER_AUTH_URL and at most 64 exact HTTPS MCP_ALLOWED_REDIRECT_URIS; HTTP is allowed only on loopback.");
  }
}
