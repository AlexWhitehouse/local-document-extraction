export const localRuntimeProxyConfig = {
  "/api/auth": {
    target: "http://localhost:8787",
    changeOrigin: true,
  },
  "/v1": {
    target: "http://localhost:8787",
    changeOrigin: true,
    ws: true,
  },
};
