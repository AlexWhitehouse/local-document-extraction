export function summarizeCoverage(summary) {
  return {
    branches: readPercentage(summary?.total?.branches),
    functions: readPercentage(summary?.total?.functions),
    lines: readPercentage(summary?.total?.lines),
  };
}

export function findAbsentModules(productionModules, lcov) {
  const loadedModules = new Set(
    lcov
      .split(/\r?\n/)
      .filter((line) => line.startsWith("SF:"))
      .map((line) => normalizeModulePath(line.slice(3))),
  );
  return productionModules
    .map(normalizeModulePath)
    .filter((module) => !loadedModules.has(module))
    .sort();
}

export function assertCoverageBaseline(current, baseline) {
  const regressions = [];
  for (const metric of ["lines", "functions", "branches"]) {
    if (current[metric] + Number.EPSILON < baseline[metric]) {
      const label = { branches: "branch", functions: "function", lines: "line" }[metric];
      regressions.push(
        `${label} coverage ${current[metric].toFixed(2)}% is below baseline ${baseline[metric].toFixed(2)}%`,
      );
    }
  }
  if (regressions.length > 0) throw new Error(regressions.join("; "));
}

function readPercentage(metric) {
  const percentage = Number(metric?.pct);
  return Number.isFinite(percentage) ? percentage : 0;
}

function normalizeModulePath(path) {
  const normalized = path.replaceAll("\\", "/");
  const sourceIndex = normalized.lastIndexOf("/src/");
  return sourceIndex >= 0 ? normalized.slice(sourceIndex + 1) : normalized;
}
