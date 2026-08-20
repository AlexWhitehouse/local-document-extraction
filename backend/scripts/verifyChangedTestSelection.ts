import { appendFile, cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const backendDirectory = resolve(import.meta.dir, "..");
const workspaceDirectory = resolve(backendDirectory, "..");
const fixtureRoot = await mkdtemp(join(tmpdir(), "bun-changed-selection-"));
const fixtureBackend = join(fixtureRoot, "backend");

try {
  await cp(backendDirectory, fixtureBackend, {
    recursive: true,
    filter(source) {
      const pathFromBackend = relative(backendDirectory, source);
      return pathFromBackend !== "node_modules"
        && !pathFromBackend.startsWith(`node_modules${pathSeparator()}`)
        && pathFromBackend !== "coverage"
        && !pathFromBackend.startsWith(`coverage${pathSeparator()}`);
    },
  });
  await symlink(resolve(backendDirectory, "node_modules"), join(fixtureBackend, "node_modules"), "dir");
  await symlink(resolve(workspaceDirectory, "frontend"), join(fixtureRoot, "frontend"), "dir");
  await writeFile(join(fixtureRoot, ".gitignore"), "node_modules\ncoverage\nfrontend\n");
  await writeFile(join(fixtureRoot, "changed-selection-probe.md"), "# Changed-selection probe\n");

  await runGit("init");
  await runGit("config", "user.email", "bun-changed-selection@example.invalid");
  await runGit("config", "user.name", "Bun changed-selection verifier");
  await runGit("add", ".");
  await runGit("commit", "-m", "baseline");

  const cases = [
    {
      changedFile: "backend/src/consumer/modelGateway.ts",
      expectedTest: "src/consumer/modelGateway.bun.test.ts",
      label: "Model gateway source",
    },
    {
      changedFile: "backend/src/localWorkspaceProductStore.ts",
      expectedTest: "src/localWorkspaceProductStore.bun.test.ts",
      label: "Workspace product-store source",
    },
    {
      changedFile: "changed-selection-probe.md",
      expectedTest: undefined,
      label: "Documentation only",
    },
  ] as const;

  const results: Array<{
    changedFile: string;
    expectedTest?: string;
    label: string;
    selectedFiles: string[];
  }> = [];
  for (const changedCase of cases) {
    const probe = changedCase.changedFile.endsWith(".ts")
      ? "\n// Bun changed-selection probe\n"
      : "\n<!-- Bun changed-selection probe -->\n";
    await appendFile(join(fixtureRoot, changedCase.changedFile), probe);
    const result = await runChangedTests();
    const selectedFiles = selectedTestFiles(result.output);
    if (result.exitCode !== 0) {
      throw new Error(`${changedCase.label} changed-test run failed (${result.exitCode}).\n${result.output}`);
    }
    if (changedCase.expectedTest && !selectedFiles.includes(changedCase.expectedTest)) {
      throw new Error(
        `${changedCase.label} did not select ${changedCase.expectedTest}. Selected: ${selectedFiles.join(", ") || "none"}.\n${result.output}`,
      );
    }
    if (!changedCase.expectedTest && selectedFiles.length > 0) {
      throw new Error(
        `${changedCase.label} selected unrelated backend tests: ${selectedFiles.join(", ")}.\n${result.output}`,
      );
    }
    results.push({ ...changedCase, selectedFiles });
    await runGit("restore", "--source=HEAD", "--", changedCase.changedFile);
  }

  const markdown = [
    "# Bun changed-test selection verification",
    "",
    `- Runtime: Bun ${Bun.version} (${Bun.revision})`,
    `- Platform: ${process.platform} ${process.arch}`,
    "- Mechanism: clean temporary Git snapshot of the current backend, then `bun test --changed=HEAD`",
    "",
    "| Change | Expected | Selected test files |",
    "| --- | --- | --- |",
    ...results.map((result) =>
      `| ${result.label} | ${result.expectedTest ?? "no backend tests"} | ${result.selectedFiles.join("<br>") || "none"} |`
    ),
    "",
  ].join("\n");
  const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
  if (outputArgument) {
    const outputPath = resolve(process.cwd(), outputArgument.slice("--output=".length));
    await writeFile(outputPath, markdown);
  }
  console.log(markdown);
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

async function runChangedTests() {
  const child = Bun.spawn([
    process.execPath,
    "test",
    "--changed=HEAD",
    "--pass-with-no-tests",
    "--isolate",
    "--max-concurrency=1",
    "--retry=0",
    "--no-orphans",
    "--path-ignore-patterns=**/localRuntimeSmoke.bun.test.ts",
  ], {
    cwd: fixtureBackend,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: `${stdout}\n${stderr}` };
}

async function runGit(...arguments_: string[]) {
  const result = Bun.spawnSync(["git", ...arguments_], {
    cwd: fixtureRoot,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${arguments_.join(" ")} failed.\n${result.stdout.toString()}\n${result.stderr.toString()}`,
    );
  }
}

function selectedTestFiles(output: string) {
  return [...output.matchAll(/(?:^|\n)([^\n]+\.bun\.test\.ts):(?:\n|$)/g)]
    .map((match) => match[1].trim())
    .filter((file, index, files) => files.indexOf(file) === index)
    .sort();
}

function pathSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}
