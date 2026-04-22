import { createAuthClient } from "better-auth/react";

export function authBaseFromApiBase(apiBase) {
  const browserOrigin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost:5173";

  const trimmed = String(apiBase || "").trim();
  if (!trimmed || trimmed === "/v1") {
    return `${browserOrigin}/api/auth`;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/v1\/?$/, "/");
    return new URL("/api/auth", url).toString().replace(/\/$/, "");
  }

  return `${browserOrigin}/api/auth`;
}

export function createRuntimeAuthClient(apiBase) {
  return createAuthClient({
    baseURL: authBaseFromApiBase(apiBase),
    fetchOptions: {
      credentials: "include"
    }
  });
}
