import { describe, expect, it } from "vitest";
import { consentRedirectTarget, continuationPath, oauthQueryFromSearch } from "./delegationRequests.js";
import { approvalGatewayUrl, callbackDestination, parameterRows } from "./delegationFormat.js";

const ORIGIN = "https://studio.example";

describe("consent redirect targets", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback?code=abc&state=s",
    "http://127.0.0.1:33418/callback?code=abc",
    "http://localhost:6274/oauth/callback?error=access_denied",
    "com.example.desktop:/oauth/callback?code=abc",
    `${ORIGIN}/mcp/connect?client_id=a&sig=b`,
  ])("accepts %s", (value) => expect(consentRedirectTarget(value, ORIGIN)).toBe(new URL(value).href));

  it.each([
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "vbscript:msgbox",
    "http://evil.example/callback",
    "https://user:pass@claude.ai/callback",
    `${ORIGIN}/workspaces/ws_a`,
    `${ORIGIN}/api/auth/sign-out`,
    "",
    null,
  ])("refuses %s", (value) => expect(consentRedirectTarget(value, ORIGIN)).toBeNull());
});

describe("continuation", () => {
  it("keeps the connect page's signed query and ignores everything else for other pages", () => {
    expect(continuationPath({ page: "mcp-connect" }, "?a=1&sig=x")).toBe("/mcp/connect?a=1&sig=x");
    expect(continuationPath({ page: "mcp-approval", approvalId: "a/b" }, "?returnTo=https://evil")).toBe("/mcp/approvals/a%2Fb");
    expect(continuationPath({ page: "mcp-upload", uploadId: "u1" })).toBe("/mcp/uploads/u1");
    expect(continuationPath({ page: "workspace" }, "?returnTo=https://evil")).toBe("/");
  });

  it("uses the whole query as the signed request unless a nested one is supplied", () => {
    expect(oauthQueryFromSearch("?client_id=a&sig=b")).toBe("client_id=a&sig=b");
    expect(oauthQueryFromSearch(`?oauth_query=${encodeURIComponent("client_id=a&sig=b")}`)).toBe("client_id=a&sig=b");
  });
});

describe("approval parameters", () => {
  it("hides anything named like a secret and shows nested values as text", () => {
    expect(parameterRows({ role: "admin", gateway_api_key: "sk", token: "t", limits: { pages: 2 }, empty: "" })).toEqual([
      { name: "role", value: "admin" },
      { name: "gateway_api_key", value: "Hidden" },
      { name: "token", value: "Hidden" },
      { name: "limits", value: '{"pages":2}' },
      { name: "empty", value: "—" },
    ]);
    expect(parameterRows(["a"])).toEqual([]);
  });

  it("shows the replace-key switch but still hides a secret value under that name or nested in a value", () => {
    expect(
      parameterRows({
        replace_api_key: true,
        configuration: { gateway_url: "https://g.example/v1", credential: "sk", nested: { api_key: "k", ok: false } },
      }),
    ).toEqual([
      { name: "replace_api_key", value: "Yes" },
      { name: "configuration", value: '{"gateway_url":"https://g.example/v1","credential":"Hidden","nested":{"api_key":"Hidden","ok":false}}' },
    ]);
    expect(parameterRows({ replace_api_key: "sk-live" })).toEqual([{ name: "replace_api_key", value: "Hidden" }]);
  });

  it("reads the gateway address only from a configuration", () => {
    expect(approvalGatewayUrl({ configuration: { gateway_url: "https://g.example/v1" } })).toBe("https://g.example/v1");
    expect(approvalGatewayUrl({ gateway_url: "https://top.example" })).toBe("");
    expect(approvalGatewayUrl({ configuration: { gateway_url: 3 } })).toBe("");
    expect(approvalGatewayUrl(null)).toBe("");
  });
});

describe("consent callback destination", () => {
  it.each([
    ["https://claude.ai/api/mcp/auth_callback", { host: "claude.ai", url: "https://claude.ai/api/mcp/auth_callback", local: false }],
    ["http://localhost:6274/cb", { host: "localhost:6274", url: "http://localhost:6274/cb", local: true }],
    ["http://[::1]:9000/cb", { host: "[::1]:9000", url: "http://[::1]:9000/cb", local: true }],
    ["com.example.desktop:/oauth/callback", { host: "com.example.desktop", url: "com.example.desktop:/oauth/callback", local: false }],
  ])("describes %s", (value, expected) => expect(callbackDestination(value)).toEqual(expected));

  it.each([undefined, null, "", "not a url", 42, "https://user:pass@claude.ai/cb"])("has no destination for %s", (value) =>
    expect(callbackDestination(value)).toBeNull(),
  );
});
