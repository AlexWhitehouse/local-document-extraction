import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  PACKAGE_HYGIENE_COMMANDS,
  normalizeLicenseInventory,
  renderPackageHygieneSummary,
  validateProductionAudit,
} from "../../../scripts/packageHygiene";
import {
  sensitivePackageReviews,
  summarizePackageDiffEvidence,
  validatePackageDiffEvidence,
} from "../../../scripts/generatePackageDiffEvidence";
import {
  renderGlobalStoreBenchmark,
  type GlobalStoreBenchmarkResult,
} from "../../../scripts/benchmarkGlobalStore";

const repositoryRoot = resolve(import.meta.dir, "../../..");

describe("Bun package hygiene", () => {
  test("normalizes and sorts a portable production license inventory", () => {
    const normalized = normalizeLicenseInventory({
      MIT: [
        { name: "zeta", paths: [`${repositoryRoot}/node_modules/zeta`], versions: ["2.0.0"] },
        { name: "alpha", paths: [`${repositoryRoot}/backend/node_modules/alpha`], versions: ["1.0.0"] },
      ],
      "Apache-2.0": [{ name: "middle", paths: ["/outside/cache/middle"], versions: ["3.0.0"] }],
    }, repositoryRoot);

    expect(Object.keys(normalized)).toEqual(["Apache-2.0", "MIT"]);
    expect(normalized.MIT?.map((entry) => entry.name)).toEqual(["alpha", "zeta"]);
    expect(normalized.MIT?.[0]?.paths).toEqual(["<repo>/backend/node_modules/alpha"]);
    expect(normalized["Apache-2.0"]?.[0]?.paths).toEqual(["<external>/middle"]);
  });

  test("accepts an empty production audit and rejects actionable advisories", () => {
    expect(validateProductionAudit("{}")).toEqual({ advisoryCount: 0 });
    expect(() => validateProductionAudit(JSON.stringify({ GHSA_example: { severity: "high" } })))
      .toThrow("1 production advisory");
  });

  test("declares only non-mutating hygiene commands and renders actionable evidence", () => {
    const flattened = PACKAGE_HYGIENE_COMMANDS.flatMap((entry) => entry.arguments).join(" ");
    expect(PACKAGE_HYGIENE_COMMANDS).toEqual([
      { arguments: ["audit", "--prod", "--json"], name: "production audit" },
      { arguments: ["dedupe", "--check"], name: "dedupe check" },
      { arguments: ["pm", "licenses", "--prod", "--json"], name: "production licenses" },
    ]);
    expect(flattened).not.toMatch(/\bfix\b|--latest|--write/);
    expect(renderPackageHygieneSummary({
      auditAdvisories: 0,
      bunRevision: "revision",
      bunVersion: "1.4.0",
      dedupeOutput: "No duplicate versions found",
      licensePackageCount: 42,
      licenseTypes: 5,
      platform: "darwin arm64",
    })).toContain("non-mutating");
  });

  test("covers every actual sensitive package transition and records unchanged boundaries", () => {
    expect(sensitivePackageReviews.filter((review) => review.kind === "upgrade")).toEqual([
      expect.objectContaining({ category: "parser", from: "6.1.200", name: "pdfjs-dist", to: "6.2.108" }),
      expect.objectContaining({ category: "build-tool", from: "5.4.21", name: "vite", to: "8.2.2" }),
      expect.objectContaining({ category: "spreadsheet", from: "8.3.2", name: "uuid", to: "11.1.1" }),
      expect.objectContaining({ category: "networking", from: "7.28.0", name: "undici", to: "7.29.0" }),
    ]);
    expect(sensitivePackageReviews.filter((review) => review.kind === "unchanged")).toEqual([
      expect.objectContaining({ category: "authentication", name: "better-auth", to: "1.6.23" }),
      expect.objectContaining({ category: "native-binary", name: "@napi-rs/canvas", to: "1.0.2" }),
    ]);
    expect(() => validatePackageDiffEvidence({
      files: [],
      from: "pdfjs-dist@6.1.200",
      notes: ["new module imports: fs"],
      to: "pdfjs-dist@6.2.108",
      totals: { added: 0, deleted: 0, files: 1, linesAdded: 1, linesRemoved: 1 },
    })).not.toThrow();
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
    expect(summarized.files).toEqual([{
      linesAdded: 2,
      patchBytes: 33,
      patchSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      path: "dist/index.js",
      status: "modified",
    }]);
    expect(JSON.stringify(summarized)).not.toContain("credential-looking");
  });

  test("pins isolated/global-store installs, release cooling, CI evidence, and safe scripts", async () => {
    const [bunfig, workflow, packageJson] = await Promise.all([
      readFile(resolve(repositoryRoot, "bunfig.toml"), "utf8"),
      readFile(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8"),
      readFile(resolve(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
    ]);

    expect(bunfig).toContain('linker = "isolated"');
    expect(bunfig).toContain("globalStore = true");
    expect(bunfig).toContain("minimumReleaseAge = 259200");
    expect(bunfig).toContain('minimumReleaseAgeExcludes = ["bun-types"]');
    expect(workflow.match(/run: bun ci/g)).toHaveLength(3);
    expect(workflow.match(/git diff --exit-code -- bun\.lock/g)).toHaveLength(3);
    expect(workflow).toContain("bun run package:hygiene");
    expect(workflow).toContain(".scratch/ci/package-hygiene/");
    expect(workflow).not.toMatch(/bun audit fix|bun dedupe(?:\s|$)(?!.*--check)/);
    expect(packageJson.scripts).toMatchObject({
      "benchmark:global-store": "bun scripts/benchmarkGlobalStore.ts",
      "package:diff-evidence": "bun scripts/generatePackageDiffEvidence.ts",
      "package:hygiene": "bun scripts/packageHygiene.ts",
    });
  });

  test("renders two clean worktrees, offline proof, global links, native smoke, and disk evidence", () => {
    const worktree = (name: string, installMs: number) => ({
      cleanAfterInstall: true,
      globalStoreLinks: 300,
      installMs,
      lockfileUnchanged: true,
      name,
      nativeCanvasPngBytes: 100,
      nodeModulesDiskKiB: 4_000,
      registryDenied: name === "worktree-b",
    });
    const result: GlobalStoreBenchmarkResult = {
      bunRevision: "revision",
      bunVersion: "1.4.0",
      cacheDiskKiB: 300_000,
      host: "darwin arm64",
      worktrees: [worktree("worktree-a", 200), worktree("worktree-b", 50)],
    };
    const markdown = renderGlobalStoreBenchmark(result);

    expect(markdown).toContain("two clean dependency worktrees");
    expect(markdown).toContain("registry denied");
    expect(markdown).toContain("Native canvas PNG");
    expect(markdown).toContain("Global-store links");
    expect(markdown).toContain("4,000 KiB");
  });
});
