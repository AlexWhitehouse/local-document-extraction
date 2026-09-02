import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { sanitizeArtifact } from "./backendTestEvidence";

const backendDirectory = resolve(import.meta.dir, "..");
const workspaceDirectory = resolve(backendDirectory, "..");
const artifactPath = resolve(
  process.env.BACKEND_FLAKE_ARTIFACT
    ?? resolve(workspaceDirectory, ".scratch/ci/backend/backend-flake.md"),
);
const seed = readPositiveInteger("BUN_TEST_SEED") ?? randomSeed();
const reruns = readPositiveInteger("BUN_TEST_RERUNS") ?? 20;
const reproduction = `BUN_TEST_SEED=${seed} BUN_TEST_RERUNS=${reruns} bun run --cwd backend test:bun:flake`;

console.log(`Backend flake seed: ${seed}`);
console.log(`Reproduce: ${reproduction}`);

const child = Bun.spawn([
  process.execPath,
  "--no-env-file",
  "test",
  "--only-failures",
  "--isolate",
  "--parallel=2",
  "--max-concurrency=1",
  "--retry=0",
  "--no-orphans",
  "--randomize",
  `--seed=${seed}`,
  `--rerun-each=${reruns}`,
  "--path-ignore-patterns=**/localRuntimeSmoke.bun.test.ts",
], {
  cwd: backendDirectory,
  env: sanitizedTestEnvironment(),
  stderr: "pipe",
  stdout: "pipe",
});
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
const output = sanitizeArtifact(`${stdout}\n${stderr}`.trim(), discoverSensitiveValues());
const evidence = [
  "# Backend flake-lane evidence",
  "",
  `- Runtime: Bun ${Bun.version} (${Bun.revision})`,
  `- Platform: ${process.platform} ${process.arch}`,
  `- Seed: ${seed}`,
  `- Repetitions per test file: ${reruns}`,
  `- Exit code: ${exitCode}`,
  `- Reproduce: \`${reproduction}\``,
  "",
  "## Test output",
  "",
  "```text",
  output,
  "```",
  "",
].join("\n");
await mkdir(dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, evidence);
if (output) console.log(output);
console.log(`Flake evidence: ${relative(workspaceDirectory, artifactPath)}`);
process.exitCode = exitCode;

function readPositiveInteger(name: string) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function randomSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] || 1;
}

function sanitizedTestEnvironment() {
  const environment: Record<string, string> = {
    NODE_ENV: "test",
  };
  for (const name of [
    "CI", "COMSPEC", "GITHUB_ACTIONS", "HOME", "LANG", "LC_ALL", "PATH",
    "PATHEXT", "RUNNER_OS", "SHELL", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR",
    "TZ", "WINDIR",
  ]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function discoverSensitiveValues() {
  return [
    "litellm-secret",
    "synthetic-test-key",
    ...Object.entries(process.env)
      .filter(([name, value]) => /(AUTH|COOKIE|CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN)/i.test(name) && value)
      .map(([, value]) => value as string),
  ];
}
