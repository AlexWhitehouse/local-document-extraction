import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environment: "jsdom",
  },
  server: {
    port: 5173,
    proxy: {
      "/api/auth": {
        target: "http://localhost:8787",
        changeOrigin: true
      },
      "/v1": {
        target: "http://localhost:8787",
        changeOrigin: true
      }
    }
  }
});
