import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import {
  assertCoverageBaseline,
  findMissingProductionModules,
  parseLcovSummary,
  sanitizeArtifact,
  type CoverageBaseline,
} from "./backendTestEvidence";

const backendDirectory = resolve(import.meta.dir, "..");
const workspaceDirectory = resolve(backendDirectory, "..");
const artifactDirectory = resolve(
  process.env.BACKEND_TEST_ARTIFACT_DIR
    ?? resolve(workspaceDirectory, ".scratch/ci/backend"),
);
const coverageDirectory = resolve(artifactDirectory, "coverage");
const junitPath = resolve(artifactDirectory, "backend-junit-merged.xml");
const timingsPath = resolve(artifactDirectory, "backend-test-timings.json");
const outputPath = resolve(artifactDirectory, "backend-test-output.txt");
const summaryPath = resolve(artifactDirectory, "backend-coverage-summary.md");
const lcovPath = resolve(coverageDirectory, "lcov.info");
const deterministicSeed = 9_140_001;

await mkdir(artifactDirectory, { recursive: true });
await rm(coverageDirectory, { recursive: true, force: true });
await mkdir(coverageDirectory, { recursive: true });

const child = Bun.spawn([
  process.execPath,
  "--no-env-file",
  "test",
  "--isolate",
  "--max-concurrency=1",
  "--retry=0",
  "--no-orphans",
  "--randomize",
  `--seed=${deterministicSeed}`,
  "--coverage",
  "--coverage-reporter=text",
  "--coverage-reporter=lcov",
  `--coverage-dir=${coverageDirectory}`,
  "--reporter=junit",
  `--reporter-outfile=${junitPath}`,
  `--timings=${timingsPath}`,
  "--update-timings",
], {
  cwd: backendDirectory,
  env: sanitizedTestEnvironment(),
  stderr: "pipe",
  stdout: "pipe",
});
const [stdout, stderr, testExitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
const sensitiveValues = discoverSensitiveValues();
const testOutput = sanitizeArtifact(`${stdout}\n${stderr}`.trim(), sensitiveValues);
await writeFile(outputPath, `${testOutput}\n`);

if (!await Bun.file(junitPath).exists()) {
  await writeFile(
    junitPath,
    fallbackJunit(testExitCode, testOutput),
  );
} else {
  const junit = await readFile(junitPath, "utf8");
  await writeFile(
    junitPath,
    sanitizeArtifact(junit, sensitiveValues).replaceAll(/hostname="[^"]*"/g, 'hostname="synthetic-test-host"'),
  );
}
if (!await Bun.file(timingsPath).exists()) {
  await writeFile(timingsPath, JSON.stringify({ error: "Bun did not emit timings" }, null, 2));
}
if (!await Bun.file(lcovPath).exists()) await writeFile(lcovPath, "");

let coverageExitCode = 0;
let coverageFailure: string | undefined;
const lcov = await readFile(lcovPath, "utf8");
const productionModules = await discoverProductionModules();
const coverageSummary = parseLcovSummary(lcov, {
  includedModules: productionModules,
  normalizeModule: (module) => module.startsWith("/")
    ? normalizePath(relative(backendDirectory, module))
    : normalizePath(module),
});
const missingModules = findMissingProductionModules(
  productionModules,
  coverageSummary.loadedModules,
);
const baseline = JSON.parse(
  await readFile(resolve(backendDirectory, "coverage-baseline.json"), "utf8"),
) as CoverageBaseline;
try {
  assertCoverageBaseline(coverageSummary, baseline);
} catch (error) {
  coverageExitCode = 1;
  coverageFailure = error instanceof Error ? error.message : String(error);
}
const summary = coverageMarkdown({
  baseline,
  coverageFailure,
  coverageSummary,
  missingModules,
  testExitCode,
});
await writeFile(summaryPath, sanitizeArtifact(summary, sensitiveValues));

console.log(summary);
console.log(`Artifacts: ${relative(workspaceDirectory, artifactDirectory)}`);
if (testExitCode !== 0 && testOutput) console.log(testOutput);
process.exitCode = testExitCode === 0 && coverageExitCode === 0 ? 0 : 1;

async function discoverProductionModules() {
  const modules: string[] = [];
  const glob = new Bun.Glob("src/**/*.ts");
  for await (const path of glob.scan({ cwd: backendDirectory, onlyFiles: true })) {
    const normalized = normalizePath(path);
    if (normalized.includes("/testSupport/")) continue;
    if (normalized.endsWith(".test.ts") || normalized.endsWith(".bun.test.ts")) continue;
    modules.push(normalized);
  }
  return modules.sort();
}

function coverageMarkdown(options: {
  baseline: CoverageBaseline;
  coverageFailure?: string;
  coverageSummary: ReturnType<typeof parseLcovSummary>;
  missingModules: string[];
  testExitCode: number;
}) {
  const { baseline, coverageFailure, coverageSummary, missingModules, testExitCode } = options;
  return [
    "# Backend coverage evidence",
    "",
    `- Runtime: Bun ${Bun.version} (${Bun.revision})`,
    `- Platform: ${process.platform} ${process.arch}`,
    `- Deterministic test seed: ${deterministicSeed}`,
    `- Test exit code: ${testExitCode}`,
    `- Coverage gate: ${coverageFailure ? `FAIL — ${coverageFailure}` : "PASS"}`,
    "",
    "| Metric | Hit / found | Current | Checked baseline |",
    "| --- | ---: | ---: | ---: |",
    `| Lines | ${coverageSummary.lines.hit} / ${coverageSummary.lines.found} | ${coverageSummary.lines.percentage.toFixed(2)}% | ${baseline.lines.toFixed(2)}% |`,
    `| Functions | ${coverageSummary.functions.hit} / ${coverageSummary.functions.found} | ${coverageSummary.functions.percentage.toFixed(2)}% | ${baseline.functions.toFixed(2)}% |`,
    "",
    `## Production modules absent from LCOV (${missingModules.length})`,
    "",
    ...(missingModules.length > 0 ? missingModules.map((module) => `- \`${module}\``) : ["None."]),
    "",
    "The baseline is read-only during test execution. Raising it requires a reviewed edit to `backend/coverage-baseline.json`; lower measured coverage fails this command.",
    "",
  ].join("\n");
}

function sanitizedTestEnvironment() {
  const allowlistedNames = [
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
  ];
  const environment: Record<string, string> = {
    DOCUMENT_EXTRACTION_STATE_DIR: resolve(artifactDirectory, "synthetic-state"),
    LITELLM_KEY: "synthetic-test-key",
    MODEL_GATEWAY_URL: "https://gateway.example.invalid",
    NODE_ENV: "test",
  };
  for (const name of allowlistedNames) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function discoverSensitiveValues() {
  const sensitiveName = /(AUTH|COOKIE|CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN)/i;
  return [
    "litellm-secret",
    "synthetic-test-key",
    ...Object.entries(process.env)
      .filter(([name, value]) => sensitiveName.test(name) && value !== undefined)
      .map(([, value]) => value as string),
  ];
}

function fallbackJunit(exitCode: number, output: string) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="1" failures="1"><testsuite name="backend-evidence" tests="1" failures="1"><testcase name="Bun evidence process"><failure message="Bun exited ${exitCode}">${escapeXml(output)}</failure></testcase></testsuite></testsuites>`,
    "",
  ].join("\n");
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizePath(path: string) {
  return path.replaceAll("\\", "/");
}
