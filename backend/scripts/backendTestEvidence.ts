export interface CoverageBaseline {
  functions: number;
  lines: number;
}

export interface CoverageMetric {
  found: number;
  hit: number;
  percentage: number;
}

export interface LcovSummary {
  functions: CoverageMetric;
  lines: CoverageMetric;
  loadedModules: string[];
}

export function parseLcovSummary(lcov: string): LcovSummary {
  let functionsFound = 0;
  let functionsHit = 0;
  let linesFound = 0;
  let linesHit = 0;
  const loadedModules: string[] = [];
  for (const line of lcov.split(/\r?\n/)) {
    if (line.startsWith("SF:")) loadedModules.push(normalizePath(line.slice(3)));
    if (line.startsWith("FNF:")) functionsFound += parseCount(line.slice(4));
    if (line.startsWith("FNH:")) functionsHit += parseCount(line.slice(4));
    if (line.startsWith("LF:")) linesFound += parseCount(line.slice(3));
    if (line.startsWith("LH:")) linesHit += parseCount(line.slice(3));
  }
  return {
    functions: metric(functionsFound, functionsHit),
    lines: metric(linesFound, linesHit),
    loadedModules: [...new Set(loadedModules)].sort(),
  };
}

export function findMissingProductionModules(
  productionModules: string[],
  loadedModules: string[],
) {
  const loaded = new Set(loadedModules.map(normalizePath));
  return productionModules
    .map(normalizePath)
    .filter((module) => !loaded.has(module))
    .sort();
}

export function assertCoverageBaseline(
  summary: LcovSummary,
  baseline: CoverageBaseline,
) {
  const regressions: string[] = [];
  if (summary.lines.percentage + Number.EPSILON < baseline.lines) {
    regressions.push(
      `line coverage ${summary.lines.percentage.toFixed(2)}% is below baseline ${baseline.lines.toFixed(2)}%`,
    );
  }
  if (summary.functions.percentage + Number.EPSILON < baseline.functions) {
    regressions.push(
      `function coverage ${summary.functions.percentage.toFixed(2)}% is below baseline ${baseline.functions.toFixed(2)}%`,
    );
  }
  if (regressions.length > 0) throw new Error(regressions.join("; "));
}

export function sanitizeArtifact(text: string, sensitiveValues: string[]) {
  let sanitized = text;
  const values = [...new Set(sensitiveValues)]
    .filter((value) => value.length >= 4)
    .sort((left, right) => right.length - left.length);
  for (const value of values) sanitized = sanitized.replaceAll(value, "[REDACTED]");
  return sanitized;
}

function metric(found: number, hit: number): CoverageMetric {
  return {
    found,
    hit,
    percentage: found === 0 ? 100 : (hit / found) * 100,
  };
}

function parseCount(value: string) {
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}

function normalizePath(path: string) {
  return path.replaceAll("\\", "/");
}
