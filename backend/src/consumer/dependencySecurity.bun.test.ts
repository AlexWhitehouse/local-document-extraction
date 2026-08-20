import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "bun:test";

const require = createRequire(import.meta.url);

describe("security-sensitive parser dependencies", () => {
  it("uses a PDF.js release containing the malicious-PDF execution fix", () => {
    const packagePath = require.resolve("pdfjs-dist/package.json");
    const packageMetadata = JSON.parse(readFileSync(packagePath, "utf8")) as {
      version: string;
    };

    expect(compareVersions(packageMetadata.version, "6.2.108")).toBeGreaterThanOrEqual(0);
  });

  it("uses a UUID release containing the buffer-bounds fix", () => {
    const excelJsPackagePath = require.resolve("exceljs/package.json");
    const excelJsRequire = createRequire(excelJsPackagePath);
    const packagePath = excelJsRequire.resolve("uuid/package.json");
    const packageMetadata = JSON.parse(readFileSync(packagePath, "utf8")) as {
      version: string;
    };

    expect(compareVersions(packageMetadata.version, "11.1.1")).toBeGreaterThanOrEqual(0);
  });
});

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }

  return 0;
}
