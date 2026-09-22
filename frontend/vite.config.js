import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = { ...loadEnv(mode, repositoryRoot, ""), ...process.env };
  const target = environment.DEV_API_ORIGIN || `http://127.0.0.1:${environment.PORT || 8787}`;
  const origin = new URL(target);
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("DEV_API_ORIGIN must be an HTTP(S) origin without credentials or a path.");
  }
  return {
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
    proxy: {
      "/api/auth": {
        target: origin.origin,
        changeOrigin: true,
      },
      "/v1": {
        target: origin.origin,
        changeOrigin: true,
        ws: true,
      },
    },
  }
  };
});
