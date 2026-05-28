import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = new URL(".", import.meta.url);
const LEGACY_PRODUCT_TABLE_PATTERN = /\b(?:templates|template_fields|jobs|job_results)\b/;
const GLOBAL_D1_PREPARE_PATTERN = /\b(?:env\.)?(?:DB|db)\s*\.\s*prepare\(/;

describe("Workspace product data cutover", () => {
  it("keeps legacy global D1 product tables out of authoritative product paths", async () => {
    const files = await listProductionSourceFiles(SOURCE_ROOT);
    const offenders: string[] = [];

    for (const file of files) {
      const contents = await readFile(file, "utf8");
      if (GLOBAL_D1_PREPARE_PATTERN.test(contents) && LEGACY_PRODUCT_TABLE_PATTERN.test(contents)) {
        offenders.push(path.relative(fileURLToPath(SOURCE_ROOT), file));
      }
    }

    expect(offenders).toEqual([]);
  });
});

async function listProductionSourceFiles(root: URL): Promise<string[]> {
  const rootPath = fileURLToPath(root);
  const found: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && fullPath.endsWith(".ts") && !fullPath.endsWith(".test.ts")) {
        found.push(fullPath);
      }
    }
  }

  await walk(rootPath);
  return found.sort();
}
