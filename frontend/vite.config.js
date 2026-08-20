import { defineConfig } from "vite";

import { localRuntimeProxyConfig } from "./viteRuntimeConfig.js";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost:5173",
      },
    },
    setupFiles: ["./src/test/setup.js"],
  },
  server: {
    port: 5173,
    proxy: localRuntimeProxyConfig,
  }
});
