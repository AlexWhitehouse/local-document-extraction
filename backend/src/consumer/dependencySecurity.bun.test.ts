import { parseJson } from "../../../shared/json";
import { jsonObject, jsonText } from "../testing/jsonFixture";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "bun:test";

const require = createRequire(import.meta.url);

describe("security-sensitive parser dependencies", () => {
  it("ships no JavaScript PDF parser; PDFium in isolated workers is the only PDF engine", () => {
    const manifest = jsonObject(parseJson(readFileSync(new URL("../../package.json", import.meta.url), "utf8")));
    const dependencies = jsonObject(manifest.dependencies);

    for (const parser of ["pdfjs-dist", "pdf-lib"]) expect(dependencies[parser]).toBeUndefined();
  });

  it("uses a UUID release containing the buffer-bounds fix", () => {
    const excelJsPackagePath = require.resolve("exceljs/package.json");
    const excelJsRequire = createRequire(excelJsPackagePath);
    const packagePath = excelJsRequire.resolve("uuid/package.json");

    const packageMetadata = jsonObject(parseJson(readFileSync(packagePath, "utf8")));

    expect(compareVersions(jsonText(packageMetadata.version), "11.1.1")).toBeGreaterThanOrEqual(0);
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
