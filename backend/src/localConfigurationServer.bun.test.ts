import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalRuntimeSmokeProcess } from "./testSupport/localRuntimeProcess";

test("the real server publishes runtime capabilities and keeps analytics disabled independently of upload limits", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-runtime-config-"));
  const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let runtime: Awaited<ReturnType<typeof startLocalRuntimeSmokeProcess>> | undefined;
  try {
    runtime = await startLocalRuntimeSmokeProcess({ backendDirectory, env: {
      PATH: process.env.PATH, DOCUMENT_EXTRACTION_STATE_DIR: stateDirectory,
      AUTH_REQUIRE_EMAIL_VERIFICATION: "false", LOCAL_ANALYTICS_ENABLED: "false",
      MAX_SOURCE_FILE_BYTES: "512", MAX_JSON_REQUEST_BYTES: "1048576",
      GOOGLE_CLIENT_ID: "private-client", GOOGLE_CLIENT_SECRET: "private-secret",
    } });
    const origin = runtime.origin;
    const response = await fetch(`${origin}/v1/config`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const config = await response.json();
    expect(config).toEqual({
      auth: { emailPasswordEnabled: true, googleEnabled: false, signupEnabled: true, requireEmailVerification: false, mailDelivery: "local" },
      limits: { maxSourceFileBytes: 512 },
    });
    expect(JSON.stringify(config)).not.toContain("private-");
    const signup = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Runtime User", email: "runtime@example.org", password: "Strong1!" }),
    });
    expect(signup.status).toBe(200);
    const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const workspaces = await (await fetch(`${origin}/v1/workspaces`, { headers: { cookie } })).json() as { workspaces: Array<{ id: string }> };
    const created = await fetch(`${origin}/v1/templates`, {
      method: "POST", headers: { cookie, "content-type": "application/json", "x-workspace-id": workspaces.workspaces[0]!.id },
      body: JSON.stringify({ name: "Runtime configuration", description: "x".repeat(1024), fields: [{ name: "Name", description: "Name", data_type: "string" }] }),
    });
    expect(created.status).toBe(201);
    expect(await runtime.stop()).toBe(0);
    expect(await readdir(join(stateDirectory, "analytics"))).toEqual([]);
    expect(await readdir(join(stateDirectory, "mail"))).toEqual([]);
  } finally {
    await runtime?.stop();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
