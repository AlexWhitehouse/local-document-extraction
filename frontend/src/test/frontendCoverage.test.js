import { describe, expect, test } from "vitest";

import {
  assertCoverageBaseline,
  findAbsentModules,
  summarizeCoverage,
} from "../../scripts/frontendCoverage.js";

describe("frontend coverage evidence", () => {
  test("summarizes line, function, and branch totals", () => {
    expect(summarizeCoverage({
      total: {
        branches: { covered: 7, pct: 70, total: 10 },
        functions: { covered: 8, pct: 80, total: 10 },
        lines: { covered: 9, pct: 90, total: 10 },
      },
    })).toEqual({ branches: 70, functions: 80, lines: 90 });
  });

  test("reports production modules absent from LCOV", () => {
    expect(findAbsentModules(
      ["src/App.jsx", "src/lib/notLoaded.js"],
      "SF:src/App.jsx\nend_of_record\n",
    )).toEqual(["src/lib/notLoaded.js"]);
  });

  test("rejects a deliberate measured-baseline regression", () => {
    expect(() => assertCoverageBaseline(
      { branches: 69.9, functions: 80, lines: 90 },
      { branches: 70, functions: 80, lines: 90 },
    )).toThrow("branch coverage 69.90% is below baseline 70.00%");
  });
});
