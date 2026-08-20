import { describe, expect, test } from "bun:test";

import {
  assertCoverageBaseline,
  findMissingProductionModules,
  parseLcovSummary,
  sanitizeArtifact,
} from "../../scripts/backendTestEvidence";

describe("backend test evidence", () => {
  test("summarizes loaded LCOV modules and names production modules with no record", () => {
    const summary = parseLcovSummary([
      "SF:src/loaded.ts",
      "FNF:4",
      "FNH:3",
      "LF:10",
      "LH:8",
      "end_of_record",
      "",
    ].join("\n"));

    expect(summary).toEqual({
      functions: { found: 4, hit: 3, percentage: 75 },
      lines: { found: 10, hit: 8, percentage: 80 },
      loadedModules: ["src/loaded.ts"],
    });
    expect(findMissingProductionModules(
      ["src/loaded.ts", "src/not-loaded.ts"],
      summary.loadedModules,
    )).toEqual(["src/not-loaded.ts"]);
  });

  test("rejects coverage below the checked line or function baseline", () => {
    expect(() => assertCoverageBaseline(
      {
        functions: { found: 4, hit: 2, percentage: 50 },
        lines: { found: 10, hit: 8, percentage: 80 },
        loadedModules: ["src/loaded.ts"],
      },
      { functions: 50, lines: 80 },
    )).not.toThrow();
    expect(() => assertCoverageBaseline(
      {
        functions: { found: 4, hit: 2, percentage: 50 },
        lines: { found: 10, hit: 7, percentage: 70 },
        loadedModules: ["src/loaded.ts"],
      },
      { functions: 50, lines: 80 },
    )).toThrow("line coverage 70.00% is below baseline 80.00%");
  });

  test("redacts sensitive values before diagnostics become artifacts", () => {
    expect(sanitizeArtifact(
      "Authorization: Bearer real-secret-value; password=hunter22",
      ["real-secret-value", "hunter22"],
    )).toBe("Authorization: Bearer [REDACTED]; password=[REDACTED]");
  });
});
