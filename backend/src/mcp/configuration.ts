export type McpConfiguration = { enabled: boolean; sensitiveActions: boolean };

export function isSecureMcpUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return /^https?:\/\//i.test(value) && !url.username && !url.password && !/[\s\p{Cc}*#\\]/u.test(value) &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)));
  } catch { return false; }
}

export function validateMcpConfiguration(baseURL: string, configuration: McpConfiguration): void {
  if (configuration.enabled && !isSecureMcpUrl(baseURL)) {
    throw new Error("MCP_ENABLED requires an HTTPS BETTER_AUTH_URL; HTTP is allowed only on loopback.");
  }
}
