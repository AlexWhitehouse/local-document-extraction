import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";

export function createRuntimeAuthClient() {
  return createAuthClient({
    baseURL: `${window.location.origin}/api/auth`,
    fetchOptions: { credentials: "include" },
    plugins: [adminClient()],
  });
}
