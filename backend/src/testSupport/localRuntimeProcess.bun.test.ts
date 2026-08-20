import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startLocalRuntimeSmokeProcess } from "./localRuntimeProcess";

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("smoke startup failures include bounded readiness diagnostics", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-smoke-failure-"));
  try {
    await expect(startLocalRuntimeSmokeProcess({
      backendDirectory,
      env: {
        ...process.env,
        DOCUMENT_EXTRACTION_STATE_DIR: stateDirectory,
        MAX_SOURCE_FILE_BYTES: "invalid",
      },
      timeoutMs: 2_000,
    })).rejects.toThrow(/elapsed_ms=.*origin=not reported.*last_health=not attempted.*stdout:.*stderr:/s);
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
