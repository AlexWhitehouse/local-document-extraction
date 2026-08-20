import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

test("backend Bun scripts isolate a capped lane and serialize real-process smoke", async () => {
  const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const packageMetadata = JSON.parse(
    await readFile(resolve(backendDirectory, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };

  expect(packageMetadata.scripts["test:bun:parallel"]).toContain("--isolate");
  expect(packageMetadata.scripts["test:bun:parallel"]).toContain("--parallel=2");
  expect(packageMetadata.scripts["test:bun:parallel"]).toContain("--max-concurrency=1");
  expect(packageMetadata.scripts["test:bun:parallel"]).toContain("--retry=0");
  expect(packageMetadata.scripts["test:bun:parallel"]).toContain("--no-orphans");
  expect(packageMetadata.scripts["test:bun:parallel"]).toContain("localRuntimeSmoke.bun.test.ts");
  expect(packageMetadata.scripts["test:bun:parallel"]).not.toContain("test .bun.test");
  expect(packageMetadata.scripts["test:bun:smoke"]).toContain("localRuntimeSmoke.bun.test.ts");
  expect(packageMetadata.scripts["test:bun"]).toContain("test:bun:parallel");
  expect(packageMetadata.scripts["test:bun"]).toContain("test:bun:smoke");
  expect(packageMetadata.scripts["test:bun:changed"]).toContain("--changed=");
  expect(packageMetadata.scripts["test:bun:changed"]).toContain("--pass-with-no-tests");
  expect(packageMetadata.scripts["test:agent"]).toContain("--only-failures");
  expect(packageMetadata.scripts["test:agent"]).not.toContain("--bail");
  expect(packageMetadata.scripts["test:target"]).toContain("--bail=1");
  expect(packageMetadata.scripts["test:bun:merge"]).toContain("--seed=9140001");
  expect(packageMetadata.scripts["test:bun:merge"]).toContain("--retry=0");
  expect(packageMetadata.scripts["test:bun:merge"]).not.toContain("--bail");
  expect(packageMetadata.scripts["test:bun:flake"]).toBe("bun scripts/runBackendFlake.ts");
  expect(packageMetadata.scripts["test:evidence"]).toBe("bun scripts/runBackendTestEvidence.ts");
  expect(packageMetadata.scripts.test).toBe("bun run test:bun");
});
