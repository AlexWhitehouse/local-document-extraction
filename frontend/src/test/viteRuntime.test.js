import { describe, expect, it } from "vitest";

import { localRuntimeProxyConfig } from "../../viteRuntimeConfig.js";

describe("frontend Vite runtime contract", () => {
  it("retains the Local Bun Runtime HTTP and live-update proxies", () => {
    expect(localRuntimeProxyConfig).toMatchObject({
      "/api/auth": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      "/v1": {
        target: "http://localhost:8787",
        changeOrigin: true,
        ws: true,
      },
    });
  });
});
