import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { localRuntimeProxyConfig } from "../../viteRuntimeConfig.js";

const frontendRequire = createRequire(import.meta.url);

describe("frontend Vite runtime contract", () => {
  it("uses one fixed Vite generation for build and test tooling", () => {
    const frontendVitePackage = readPackage(
      frontendRequire.resolve("vite/package.json"),
    );
    const vitestPackagePath = frontendRequire.resolve("vitest/package.json");
    const vitestRequire = createRequire(vitestPackagePath);
    const vitestVitePackage = readPackage(
      vitestRequire.resolve("vite/package.json"),
    );

    expect(compareVersions(frontendVitePackage.version, "6.4.3")).toBeGreaterThanOrEqual(0);
    expect(vitestVitePackage.version).toBe(frontendVitePackage.version);
  });

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

function readPackage(packagePath) {
  return JSON.parse(readFileSync(packagePath, "utf8"));
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }

  return 0;
}
