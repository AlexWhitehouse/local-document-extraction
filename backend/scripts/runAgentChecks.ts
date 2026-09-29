import { resolve } from "node:path";

const backendDirectory = resolve(import.meta.dir, "..");
const workspaceDirectory = resolve(backendDirectory, "..");
const checks = [
  { name: "typecheck", cwd: workspaceDirectory, script: "typecheck" },
  { name: "lint", cwd: workspaceDirectory, script: "lint" },
  { name: "backend tests", cwd: backendDirectory, script: "test:agent" },
  { name: "frontend tests", cwd: resolve(workspaceDirectory, "frontend"), script: "test" },
];

const results = await Promise.all(checks.map(async ({ cwd, name, script }) => {
  try {
    const child = Bun.spawn([process.execPath, "run", script], { cwd, stderr: "pipe", stdout: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { name, exitCode, output: `${stdout}\n${stderr}`.trim() };
  } catch (error) {
    return { name, exitCode: 1, output: error instanceof Error ? error.stack ?? error.message : String(error) };
  }
}));

for (const result of results) {
  console.log(`\n## ${result.name}: ${result.exitCode === 0 ? "PASS" : `FAIL (${result.exitCode})`}`);
  if (result.output) console.log(result.output);
}
process.exitCode = results.some((result) => result.exitCode !== 0) ? 1 : 0;
