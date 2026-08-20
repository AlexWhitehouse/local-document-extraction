import { performance } from "node:perf_hooks";

const workerCounts = [2, 4];
const results = [];

for (const workers of workerCounts) {
  results.push(await measureLane(workers));
}

console.log("# Backend Bun-native parallel benchmark\n");
console.log(`- Runtime: Bun ${Bun.version} (${Bun.revision})`);
console.log(`- Platform: ${process.platform} ${process.arch}`);
console.log("- Scope: isolated native files excluding the serial real-process smoke");
console.log("- Retries: 0\n");
console.log("| Workers | Wall time | Peak aggregate process-tree RSS | Tests | Assertions |");
console.log("| ---: | ---: | ---: | ---: | ---: |");
for (const result of results) {
  console.log(
    `| ${result.workers} | ${result.wallTimeMs.toFixed(1)} ms | ${(result.peakRssKiB / 1024).toFixed(1)} MiB | ${result.tests} | ${result.assertions} |`,
  );
}

async function measureLane(workers: number): Promise<{
  assertions: number;
  peakRssKiB: number;
  tests: number;
  wallTimeMs: number;
  workers: number;
}> {
  const startedAt = performance.now();
  const child = Bun.spawn([
    process.execPath,
    "test",
    "--isolate",
    `--parallel=${workers}`,
    "--max-concurrency=1",
    "--retry=0",
    "--no-orphans",
    "--path-ignore-patterns=**/localRuntimeSmoke.bun.test.ts",
  ], {
    cwd: new URL("..", import.meta.url).pathname,
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdoutPromise = new Response(child.stdout).text();
  const stderrPromise = new Response(child.stderr).text();
  let exited = false;
  const exitPromise = child.exited.then((exitCode) => {
    exited = true;
    return exitCode;
  });
  let peakRssKiB = 0;
  while (!exited) {
    peakRssKiB = Math.max(peakRssKiB, processTreeRssKiB(child.pid));
    await Bun.sleep(20);
  }
  const exitCode = await exitPromise;
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  if (exitCode !== 0) {
    throw new Error(`Parallel=${workers} failed\n${stdout}\n${stderr}`);
  }
  const summary = `${stdout}\n${stderr}`;
  const tests = Number(summary.match(/\n\s*(\d+) pass\n/)?.[1] || 0);
  const assertions = Number(summary.match(/\n\s*(\d+) expect\(\) calls\n/)?.[1] || 0);
  if (!tests || !assertions) {
    throw new Error(`Could not parse parallel=${workers} summary\n${summary}`);
  }
  return {
    assertions,
    peakRssKiB,
    tests,
    wallTimeMs: performance.now() - startedAt,
    workers,
  };
}

function processTreeRssKiB(rootPid: number): number {
  const result = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,rss="]);
  if (result.exitCode !== 0) return 0;
  const processes = new Map<number, { parentPid: number; rssKiB: number }>();
  for (const line of result.stdout.toString().trim().split("\n")) {
    const [pidText, parentPidText, rssText] = line.trim().split(/\s+/);
    const pid = Number(pidText);
    if (!Number.isInteger(pid)) continue;
    processes.set(pid, { parentPid: Number(parentPidText), rssKiB: Number(rssText) || 0 });
  }
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, process] of processes) {
      if (!descendants.has(pid) && descendants.has(process.parentPid)) {
        descendants.add(pid);
        changed = true;
      }
    }
  }
  return [...descendants].reduce(
    (total, pid) => total + (processes.get(pid)?.rssKiB || 0),
    0,
  );
}
