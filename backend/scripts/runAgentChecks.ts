import { resolve } from "node:path";

import {
  runIndependentChecks,
  type IndependentCheck,
} from "./independentChecks";

const backendDirectory = resolve(import.meta.dir, "..");
const workspaceDirectory = resolve(backendDirectory, "..");
const checks: IndependentCheck[] = [
  {
    command: [process.execPath, "run", "typecheck"],
    cwd: workspaceDirectory,
    name: "typecheck",
  },
  {
    command: [process.execPath, "run", "lint"],
    cwd: workspaceDirectory,
    name: "lint",
  },
  {
    command: [process.execPath, "run", "test:agent"],
    cwd: backendDirectory,
    name: "backend tests",
  },
  {
    command: [process.execPath, "run", "test"],
    cwd: resolve(workspaceDirectory, "frontend"),
    name: "frontend tests",
  },
];

const aggregate = await runIndependentChecks(checks, async (check) => {
  const child = Bun.spawn(check.command, {
    cwd: check.cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: `${stdout}\n${stderr}`.trim() };
});

for (const result of aggregate.results) {
  console.log(`\n## ${result.name}: ${result.exitCode === 0 ? "PASS" : `FAIL (${result.exitCode})`}`);
  if (result.output) console.log(result.output);
}
process.exitCode = aggregate.exitCode;
