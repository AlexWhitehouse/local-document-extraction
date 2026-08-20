const iterations = readPositiveInteger("FRONTEND_ISOLATION_ITERATIONS") ?? 5;
const firstSeed = readPositiveInteger("FRONTEND_ISOLATION_SEED") ?? 12_120;

for (let iteration = 0; iteration < iterations; iteration += 1) {
  const seed = firstSeed + iteration;
  console.log(`Frontend isolation run ${iteration + 1}/${iterations}, seed ${seed}`);
  const child = globalThis.Bun.spawn([
    process.execPath,
    "x",
    "vitest",
    "run",
    "--reporter=dot",
    "--retry=0",
    "--bail=0",
    "--sequence.shuffle",
    `--sequence.seed=${seed}`,
  ], {
    cwd: new URL("..", import.meta.url).pathname,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    console.error(`${stdout}\n${stderr}`.trim());
    console.error(`Reproduce with FRONTEND_ISOLATION_ITERATIONS=1 FRONTEND_ISOLATION_SEED=${seed} bun run --cwd frontend test:isolation`);
    process.exit(exitCode);
  }
  const summary = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .filter((line) => /Test Files|Tests\s|Duration/.test(line));
  console.log(summary.join("\n"));
}

function readPositiveInteger(name) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
import process from "node:process";
