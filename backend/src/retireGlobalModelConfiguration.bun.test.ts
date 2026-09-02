import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { retireGlobalModelConfiguration, RETIRED_MODEL_ENVIRONMENT_VARIABLES } from "./retireGlobalModelConfiguration";

test("cutover removes only the legacy file and reports ignored variable names without their values", async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), "model-cutover-"));
  const warnings: unknown[] = [];
  const original = console.warn;
  console.warn = (message) => { warnings.push(message); };
  try {
    mkdirSync(join(stateDirectory, "data"));
    const legacy = join(stateDirectory, "data", "model-gateway.json");
    const unrelated = join(stateDirectory, "data", "unrelated.json");
    writeFileSync(legacy, "invalid-json legacy-dummy-secret");
    writeFileSync(unrelated, "preserve");
    const environment = Object.fromEntries(RETIRED_MODEL_ENVIRONMENT_VARIABLES.map((name) => [name, "dummy-environment-secret"]));
    await retireGlobalModelConfiguration(stateDirectory, environment);
    expect(existsSync(legacy)).toBe(false);
    expect(readFileSync(unrelated, "utf8")).toBe("preserve");
    expect(warnings).toHaveLength(1);
    for (const name of RETIRED_MODEL_ENVIRONMENT_VARIABLES) expect(String(warnings[0])).toContain(name);
    expect(JSON.stringify(warnings)).not.toContain("dummy-environment-secret");
    await retireGlobalModelConfiguration(stateDirectory, {});
    expect(warnings).toHaveLength(1);
    mkdirSync(legacy);
    await retireGlobalModelConfiguration(stateDirectory, {});
    expect(warnings).toHaveLength(2);
    expect(String(warnings[1])).not.toContain(stateDirectory);
    expect(existsSync(legacy)).toBe(true);
  } finally { console.warn = original; rmSync(stateDirectory, { recursive: true, force: true }); }
});
