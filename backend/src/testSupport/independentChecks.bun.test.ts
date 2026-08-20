import { expect, test } from "bun:test";

import { runIndependentChecks } from "../../scripts/independentChecks";

test("aggregate agent checks start every independent check and retain a failing status", async () => {
  const started: string[] = [];
  const checks = [
    { command: ["bun", "typecheck"], name: "typecheck" },
    { command: ["bun", "lint"], name: "lint" },
    { command: ["bun", "test"], name: "test" },
  ];

  const aggregate = await runIndependentChecks(checks, async (check) => {
    started.push(check.name);
    await Promise.resolve();
    return {
      exitCode: check.name === "typecheck" ? 1 : 0,
      output: `${check.name} output`,
    };
  });

  expect(started).toEqual(["typecheck", "lint", "test"]);
  expect(aggregate.exitCode).toBe(1);
  expect(aggregate.results.map((result) => [result.name, result.exitCode])).toEqual([
    ["typecheck", 1],
    ["lint", 0],
    ["test", 0],
  ]);
});
