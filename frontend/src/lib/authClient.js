import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

export function createRuntimeAuthClient() {
  return createAuthClient({
    baseURL: `${window.location.origin}/api/auth`,
    fetchOptions: { credentials: "include" },
    plugins: [adminClient()],
  });
}

// The MCP connect page signs in with this client. It adds the page's signed authorization
// request to sign-in and sign-up bodies, so the server resumes that request afterwards.
export function createDelegatedAuthClient() {
  return createAuthClient({
    baseURL: `${window.location.origin}/api/auth`,
    fetchOptions: { credentials: "include" },
    plugins: [adminClient(), oauthProviderClient()],
  });
}
