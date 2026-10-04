import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import process from "node:process";
import { relative, resolve } from "node:path";

const frontendDirectory = resolve(import.meta.dir, "..");

const workspaceDirectory = resolve(frontendDirectory, "..");

const artifactDirectory = resolve(
  process.env.FRONTEND_COVERAGE_ARTIFACT_DIR ?? resolve(workspaceDirectory, ".scratch/ci/frontend"),
);

const coverageDirectory = resolve(artifactDirectory, "coverage");

const lcovPath = resolve(coverageDirectory, "lcov.info");

const jsonSummaryPath = resolve(coverageDirectory, "coverage-summary.json");

const markdownPath = resolve(artifactDirectory, "frontend-coverage-summary.md");

const baseline = JSON.parse(
  await readFile(
    resolve(process.env.FRONTEND_COVERAGE_BASELINE_PATH ?? resolve(frontendDirectory, "coverage-baseline.json")),
    "utf8",
  ),
);

await mkdir(artifactDirectory, { recursive: true });

await rm(coverageDirectory, { recursive: true, force: true });

await mkdir(coverageDirectory, { recursive: true });

const child = globalThis.Bun.spawn(
  [
    process.execPath,
    "--no-env-file",
    "x",
    "vitest",
    "run",
    "--coverage",
    "--coverage.provider=v8",
    "--coverage.include=src/**/*.js",
    "--coverage.include=src/**/*.jsx",
    "--coverage.exclude=src/**/*.test.*",
    "--coverage.exclude=src/test/**",
    "--coverage.reporter=text",
    "--coverage.reporter=lcov",
    "--coverage.reporter=json-summary",
    `--coverage.reportsDirectory=${coverageDirectory}`,
    "--coverage.reportOnFailure",
    `--coverage.thresholds.lines=${baseline.lines}`,
    `--coverage.thresholds.functions=${baseline.functions}`,
    `--coverage.thresholds.branches=${baseline.branches}`,
  ],
  {
    cwd: frontendDirectory,
    env: sanitizedTestEnvironment(),
    stderr: "pipe",
    stdout: "pipe",
  },
);

const [stdout, stderr, testExitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);

const testOutput = `${stdout}\n${stderr}`.trim();

if (testOutput) console.log(testOutput);

if (!(await globalThis.Bun.file(lcovPath).exists())) await writeFile(lcovPath, "");

if (!(await globalThis.Bun.file(jsonSummaryPath).exists())) {
  await writeFile(
    jsonSummaryPath,
    JSON.stringify(
      {
        total: {
          branches: { covered: 0, pct: 0, total: 0 },
          functions: { covered: 0, pct: 0, total: 0 },
          lines: { covered: 0, pct: 0, total: 0 },
        },
      },
      null,
      2,
    ),
  );
}

const lcov = await readFile(lcovPath, "utf8");

const jsonSummary = JSON.parse(await readFile(jsonSummaryPath, "utf8"));

const current = {
  branches: readPercentage(jsonSummary.total?.branches),
  functions: readPercentage(jsonSummary.total?.functions),
  lines: readPercentage(jsonSummary.total?.lines),
};

const productionModules = await discoverProductionModules();

const absentModules = findAbsentModules(productionModules, lcov);

const zeroCoveredModules = Object.entries(jsonSummary)
  .filter(([path, value]) => path !== "total" && Number(value?.lines?.covered) === 0)
  .map(([path]) => normalizeModulePath(path))
  .sort();

const coverageFailure = coverageRegressions(current, baseline).join("; ") || undefined;

const markdown = coverageMarkdown({
  absentModules,
  baseline,
  coverageFailure,
  current,
  testExitCode,
  zeroCoveredModules,
});

await writeFile(markdownPath, markdown);

console.log(markdown);

console.log(`Frontend coverage artifacts: ${relative(workspaceDirectory, artifactDirectory)}`);

process.exitCode = testExitCode === 0 && !coverageFailure ? 0 : 1;

function readPercentage(metric) {
  const percentage = Number(metric?.pct);

  return Number.isFinite(percentage) ? percentage : 0;
}

function findAbsentModules(productionModules, lcov) {
  const loadedModules = new Set(
    lcov
      .split(/\r?\n/)
      .filter((line) => line.startsWith("SF:"))
      .map((line) => normalizeModulePath(line.slice(3))),
  );

  return productionModules.filter((module) => !loadedModules.has(module));
}

function coverageRegressions(current, baseline) {
  const labels = { lines: "line", functions: "function", branches: "branch" };

  return Object.entries(labels)
    .filter(([metric]) => current[metric] + Number.EPSILON < baseline[metric])
    .map(
      ([metric, label]) =>
        `${label} coverage ${current[metric].toFixed(2)}% is below baseline ${baseline[metric].toFixed(2)}%`,
    );
}

async function discoverProductionModules() {
  const modules = [];

  for (const pattern of ["src/**/*.js", "src/**/*.jsx"]) {
    const glob = new globalThis.Bun.Glob(pattern);

    for await (const path of glob.scan({ cwd: frontendDirectory, onlyFiles: true })) {
      const normalized = normalizeModulePath(path);

      if (normalized.includes("/test/") || normalized.includes(".test.")) continue;
      modules.push(normalized);
    }
  }

  return [...new Set(modules)].sort();
}

function coverageMarkdown({ absentModules, baseline, coverageFailure, current, testExitCode, zeroCoveredModules }) {
  return [
    "# Frontend coverage evidence",
    "",
    `- Runtime: Bun ${globalThis.Bun.version} (${globalThis.Bun.revision})`,
    `- Platform: ${process.platform} ${process.arch}`,
    `- Test exit code: ${testExitCode}`,
    `- Coverage gate: ${coverageFailure ? `FAIL — ${coverageFailure}` : "PASS"}`,
    "",
    "| Metric | Current | Checked baseline |",
    "| --- | ---: | ---: |",
    `| Lines | ${current.lines.toFixed(2)}% | ${baseline.lines.toFixed(2)}% |`,
    `| Functions | ${current.functions.toFixed(2)}% | ${baseline.functions.toFixed(2)}% |`,
    `| Branches | ${current.branches.toFixed(2)}% | ${baseline.branches.toFixed(2)}% |`,
    "",
    `## Production modules absent from LCOV (${absentModules.length})`,
    "",
    ...(absentModules.length > 0 ? absentModules.map((module) => `- \`${module}\``) : ["None."]),
    "",
    `## Production modules with zero covered lines (${zeroCoveredModules.length})`,
    "",
    ...(zeroCoveredModules.length > 0 ? zeroCoveredModules.map((module) => `- \`${module}\``) : ["None."]),
    "",
    "Thresholds are read from `frontend/coverage-baseline.json`; execution never auto-updates or lowers them.",
    "",
  ].join("\n");
}

function sanitizedTestEnvironment() {
  const environment = { NODE_ENV: "test" };

  for (const name of [
    "CI",
    "COMSPEC",
    "GITHUB_ACTIONS",
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "PATHEXT",
    "RUNNER_OS",
    "SHELL",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "TZ",
    "WINDIR",
  ]) {
    const value = process.env[name];

    if (value !== undefined) environment[name] = value;
  }

  return environment;
}

function normalizeModulePath(path) {
  const normalized = path.replaceAll("\\", "/");
  const sourceIndex = normalized.lastIndexOf("/src/");

  return sourceIndex >= 0 ? normalized.slice(sourceIndex + 1) : normalized;
}
