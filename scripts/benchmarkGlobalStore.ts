import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

export type GlobalStoreWorktreeResult = {
  cleanAfterInstall: boolean;
  globalStoreLinks: number;
  installMs: number;
  lockfileUnchanged: boolean;
  name: string;
  nativeCanvasPngBytes: number;
  nodeModulesDiskKiB: number;
  registryDenied: boolean;
};

export type GlobalStoreBenchmarkResult = {
  bunRevision: string;
  bunVersion: string;
  cacheDiskKiB: number;
  host: string;
  worktrees: [GlobalStoreWorktreeResult, GlobalStoreWorktreeResult];
};

const repositoryRoot = resolve(import.meta.dir, "..");
const evidencePath = resolve(repositoryRoot, ".scratch/bun-1-4-review/evidence/20-global-store-worktrees.md");

export function renderGlobalStoreBenchmark(result: GlobalStoreBenchmarkResult): string {
  return [
    "# Bun 1.4 global isolated-store worktree benchmark",
    "",
    `- Runtime: Bun ${result.bunVersion} (${result.bunRevision})`,
    `- Host: ${result.host}`,
    "- Shape: two clean dependency worktrees reuse one pre-warmed package cache; worktree A populates global-store entries and worktree B reuses them with the registry denied.",
    "- Scope: local install/link/disk evidence for this repository, not Bun's published 7× benchmark.",
    "",
    "| Worktree | Frozen install | Registry | Lockfile | Git state | Global-store links | Native canvas PNG | node_modules disk |",
    "| --- | ---: | --- | --- | --- | ---: | ---: | ---: |",
    ...result.worktrees.map((worktree) => `| ${worktree.name} | ${worktree.installMs.toFixed(2)} ms | ${worktree.registryDenied ? "registry denied" : "available"} | ${worktree.lockfileUnchanged ? "unchanged" : "CHANGED"} | ${worktree.cleanAfterInstall ? "clean" : "DIRTY"} | ${worktree.globalStoreLinks} | ${worktree.nativeCanvasPngBytes} bytes | ${worktree.nodeModulesDiskKiB.toLocaleString("en-GB")} KiB |`),
    "",
    `Shared cache plus global store: ${result.cacheDiskKiB.toLocaleString("en-GB")} KiB on disk after both installs.`,
    "",
    "The unmeasured seed install warms package tarballs with the global store disabled. Both measured directories are dependency-only Git worktrees committed inside a disposable temporary repository, ignore only `node_modules/`, begin clean, and must remain clean. The second install points the npm registry at a closed loopback port, so success demonstrates frozen/offline reuse rather than a hidden network fetch.",
    "",
  ].join("\n");
}

async function runGlobalStoreBenchmark(): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "document-extraction-global-store-"));
  const cacheDirectory = join(temporaryRoot, "bun-cache");
  const seed = join(temporaryRoot, "seed");
  const worktreeA = join(temporaryRoot, "worktree-a");
  const worktreeB = join(temporaryRoot, "worktree-b");
  try {
    await mkdir(cacheDirectory, { recursive: true });
    await Promise.all([seed, worktreeA, worktreeB].map(materializeDependencyWorktree));
    await installDependencies({ cacheDirectory, directory: seed, globalStore: false, registryDenied: false });
    const first = await measureWorktree({ cacheDirectory, directory: worktreeA, name: "worktree-a", registryDenied: false });
    const second = await measureWorktree({ cacheDirectory, directory: worktreeB, name: "worktree-b", registryDenied: true });
    const result: GlobalStoreBenchmarkResult = {
      bunRevision: Bun.revision,
      bunVersion: Bun.version,
      cacheDiskKiB: await diskKiB(cacheDirectory),
      host: `${platform()} ${arch()}`,
      worktrees: [first, second],
    };
    for (const worktree of result.worktrees) {
      if (!worktree.cleanAfterInstall || !worktree.lockfileUnchanged || worktree.globalStoreLinks === 0 || worktree.nativeCanvasPngBytes === 0) {
        throw new Error(`${worktree.name} failed global-store integrity checks: ${JSON.stringify(worktree)}`);
      }
    }
    await mkdir(resolve(evidencePath, ".."), { recursive: true });
    const markdown = renderGlobalStoreBenchmark(result);
    await writeFile(evidencePath, markdown, "utf8");
    process.stdout.write(markdown);
  } finally {
    if (process.env.GLOBAL_STORE_BENCH_KEEP === "1") {
      process.stderr.write(`Preserved diagnostic benchmark state at ${temporaryRoot}\n`);
    } else {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }
}

async function materializeDependencyWorktree(directory: string): Promise<void> {
  await Promise.all([
    mkdir(join(directory, "backend"), { recursive: true }),
    mkdir(join(directory, "frontend"), { recursive: true }),
  ]);
  const copies = [
    ["package.json", "package.json"],
    ["bun.lock", "bun.lock"],
    ["bunfig.toml", "bunfig.toml"],
    ["backend/package.json", "backend/package.json"],
    ["frontend/package.json", "frontend/package.json"],
  ] as const;
  await Promise.all(copies.map(async ([source, destination]) => {
    await writeFile(join(directory, destination), await readFile(resolve(repositoryRoot, source)));
  }));
  await writeFile(join(directory, ".gitignore"), "node_modules/\n**/node_modules/\n", "utf8");
  await run(["git", "init", "--quiet"], directory);
  await run(["git", "config", "user.name", "Bun package benchmark"], directory);
  await run(["git", "config", "user.email", "benchmark.invalid@example.invalid"], directory);
  await run(["git", "add", "."], directory);
  await run(["git", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "dependency fixture"], directory);
}

async function measureWorktree({
  cacheDirectory,
  directory,
  name,
  registryDenied,
}: {
  cacheDirectory: string;
  directory: string;
  name: string;
  registryDenied: boolean;
}): Promise<GlobalStoreWorktreeResult> {
  const lockBefore = await fileSha256(join(directory, "bun.lock"));
  const startedAt = performance.now();
  await installDependencies({ cacheDirectory, directory, globalStore: true, registryDenied });
  const installMs = performance.now() - startedAt;
  const lockAfter = await fileSha256(join(directory, "bun.lock"));
  return {
    cleanAfterInstall: (await run(["git", "status", "--porcelain"], directory)).trim() === "",
    globalStoreLinks: await countGlobalStoreLinks(directory, cacheDirectory),
    installMs,
    lockfileUnchanged: lockBefore === lockAfter,
    name,
    nativeCanvasPngBytes: await nativeCanvasSmoke(directory),
    nodeModulesDiskKiB: await localTreeKiB(join(directory, "node_modules")),
    registryDenied,
  };
}

async function installDependencies({
  cacheDirectory,
  directory,
  globalStore,
  registryDenied,
}: {
  cacheDirectory: string;
  directory: string;
  globalStore: boolean;
  registryDenied: boolean;
}): Promise<void> {
  const arguments_ = [
    process.execPath,
    "--no-env-file",
    "ci",
    "--ignore-scripts",
    "--cache-dir",
    cacheDirectory,
    ...(registryDenied ? ["--registry", "http://127.0.0.1:9"] : []),
  ];
  const child = Bun.spawn(arguments_, {
    cwd: directory,
    env: {
      BUN_INSTALL_GLOBAL_STORE: globalStore ? "1" : "0",
      NO_COLOR: "1",
      PATH: process.env.PATH ?? "",
      TMPDIR: tmpdir(),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Frozen install failed in ${directory}:\n${(stderr || stdout).slice(-4_000)}`);
  }
}

async function countGlobalStoreLinks(directory: string, cacheDirectory: string): Promise<number> {
  const storeDirectory = join(directory, "node_modules/.bun");
  const canonicalLinkRoot = await realpath(join(cacheDirectory, "links"));
  const entries = await readdir(storeDirectory);
  let count = 0;
  for (const entry of entries) {
    if (entry === "node_modules") continue;
    const path = join(storeDirectory, entry);
    if (!(await lstat(path)).isSymbolicLink()) continue;
    const target = await realpath(path);
    if (target === canonicalLinkRoot || target.startsWith(`${canonicalLinkRoot}${sep}`)) count += 1;
  }
  return count;
}

async function nativeCanvasSmoke(directory: string): Promise<number> {
  const source = [
    'import { createCanvas } from "@napi-rs/canvas";',
    "const canvas = createCanvas(2, 2);",
    'const png = canvas.toBuffer("image/png");',
    "if (png.byteLength < 8) process.exit(2);",
    "process.stdout.write(String(png.byteLength));",
  ].join("\n");
  const child = Bun.spawn([process.execPath, "--no-env-file", "-e", source], {
    cwd: join(directory, "backend"),
    env: { NO_COLOR: "1", PATH: process.env.PATH ?? "", TMPDIR: tmpdir() },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Native canvas smoke failed: ${stderr}`);
  return Number(stdout.trim());
}

async function diskKiB(path: string): Promise<number> {
  const output = await run(["du", "-sk", path], repositoryRoot);
  const value = Number(output.trim().split(/\s+/, 1)[0]);
  if (!Number.isFinite(value)) throw new Error(`Could not read disk use for ${path}`);
  return value;
}

async function localTreeKiB(path: string): Promise<number> {
  return Math.ceil(await localTreeBytes(path) / 1024);
}

async function localTreeBytes(path: string): Promise<number> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) return metadata.size;
  const entries = await readdir(path);
  const childBytes = await Promise.all(entries.map((entry) => localTreeBytes(join(path, entry))));
  return metadata.size + childBytes.reduce((total, value) => total + value, 0);
}

async function fileSha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function run(command: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr || stdout}`);
  return stdout;
}

if (import.meta.main) await runGlobalStoreBenchmark();
