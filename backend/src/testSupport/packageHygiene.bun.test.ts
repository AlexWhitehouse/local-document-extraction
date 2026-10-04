import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  PACKAGE_HYGIENE_COMMANDS,
  normalizeLicenseInventory,
  validateProductionAudit,
} from "../../../scripts/packageHygiene";
import {
  summarizePackageDiffEvidence,
  validatePackageDiffEvidence,
} from "../../../scripts/generatePackageDiffEvidence";

const repositoryRoot = resolve(import.meta.dir, "../../..");

describe("Bun package hygiene", () => {
  test("normalizes and sorts a portable production license inventory", () => {
    const normalized = normalizeLicenseInventory(
      {
        MIT: [
          { name: "zeta", paths: [`${repositoryRoot}/node_modules/zeta`], versions: ["2.0.0"] },
          { name: "alpha", paths: [`${repositoryRoot}/backend/node_modules/alpha`], versions: ["1.0.0"] },
        ],
        "Apache-2.0": [{ name: "middle", paths: ["/outside/cache/middle"], versions: ["3.0.0"] }],
      },
      repositoryRoot,
    );

    expect(Object.keys(normalized)).toEqual(["Apache-2.0", "MIT"]);
    expect(normalized.MIT?.map((entry) => entry.name)).toEqual(["alpha", "zeta"]);
    expect(normalized.MIT?.[0]?.paths).toEqual(["<repo>/backend/node_modules/alpha"]);
    expect(normalized["Apache-2.0"]?.[0]?.paths).toEqual(["<external>/middle"]);
  });

  test("accepts an empty production audit and rejects actionable advisories", () => {
    expect(validateProductionAudit("{}")).toEqual({ advisoryCount: 0 });
    expect(() => validateProductionAudit(JSON.stringify({ GHSA_example: { severity: "high" } }))).toThrow(
      "1 production advisory",
    );
  });

  test("declares only non-mutating hygiene commands", () => {
    const flattened = PACKAGE_HYGIENE_COMMANDS.flatMap((entry) => entry.arguments).join(" ");
    expect(flattened).not.toMatch(/\bfix\b|--latest|--write/);
  });

  test("rejects package diff evidence without the reviewed shape", () => {
    expect(() =>
      validatePackageDiffEvidence({
        files: [],
        from: "pdfjs-dist@6.1.200",
        notes: ["new module imports: fs"],
        to: "pdfjs-dist@6.2.108",
        totals: { added: 0, deleted: 0, files: 1, linesAdded: 1, linesRemoved: 1 },
      }),
    ).not.toThrow();
    expect(() => validatePackageDiffEvidence({ from: "x", to: "y" })).toThrow("files");
  });

  test("keeps complete package patches raw and publishes bounded file metadata", () => {
    const summarized = summarizePackageDiffEvidence({
      files: [{ linesAdded: 2, patch: "credential-looking package source", path: "dist/index.js", status: "modified" }],
      from: "package@1.0.0",
      notes: ["new module imports: fs"],
      to: "package@2.0.0",
      totals: { added: 0, deleted: 0, files: 1, linesAdded: 2, linesRemoved: 0 },
    });

    expect(summarized.files).toEqual([
      {
        linesAdded: 2,
        patchBytes: 33,
        patchSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        path: "dist/index.js",
        status: "modified",
      },
    ]);
    expect(JSON.stringify(summarized)).not.toContain("credential-looking");
  });
});
