import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalRuntimeSmokeProcess } from "./testSupport/localRuntimeProcess";

async function withServer(trustedIpHeaders: string, run: (origin: string) => Promise<void>) {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-auth-throttle-"));
  let runtime: Awaited<ReturnType<typeof startLocalRuntimeSmokeProcess>> | undefined;
  try {
    runtime = await startLocalRuntimeSmokeProcess({
      backendDirectory: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      // Deliberately omit NODE_ENV: documented normal startup must be protected.
      env: { PATH: process.env.PATH, DOCUMENT_EXTRACTION_STATE_DIR: stateDirectory, LOCAL_ANALYTICS_ENABLED: "false", AUTH_TRUSTED_IP_HEADERS: trustedIpHeaders },
    });
    await run(runtime.origin);
  } finally {
    await runtime?.stop();
    await rm(stateDirectory, { recursive: true, force: true });
  }
}

async function signIn(origin: string, headers: Record<string, string>) {
  const response = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST", headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify({ email: "runtime@example.test", password: "Incorrect1!" }),
  });
  await response.text();
  return response;
}

test("normal server startup throttles auth using the socket address through bounded request parsing", async () => {
  await withServer("", async (origin) => {
    const signup = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": "203.0.113.1", "x-document-extraction-client-address": "203.0.113.2" },
      body: JSON.stringify({ name: "Runtime fixture", email: "runtime@example.test", password: "Strong1!" }),
    });
    expect(signup.status).toBe(200);
    await signup.text();
    const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const session = await fetch(`${origin}/api/auth/get-session`, { headers: { cookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ session: { ipAddress: "127.0.0.1" } });
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await signIn(origin, { "x-forwarded-for": `198.51.100.${attempt + 1}`, "x-document-extraction-client-address": `203.0.113.${attempt + 1}` })).status).toBe(401);
    }
    const rejected = await signIn(origin, { "x-forwarded-for": "198.51.100.90", "cf-connecting-ip": "203.0.113.90" });
    expect(rejected.status).toBe(429);
    expect(Number(rejected.headers.get("x-retry-after"))).toBeGreaterThan(0);
  });
});

test("configured proxy clients retain independent budgets on one Bun listener", async () => {
  await withServer("x-real-ip", async (origin) => {
    for (let attempt = 0; attempt < 3; attempt++) expect((await signIn(origin, { "x-real-ip": "192.0.2.30" })).status).toBe(401);
    expect((await signIn(origin, { "x-real-ip": "192.0.2.30" })).status).toBe(429);
    expect((await signIn(origin, { "x-real-ip": "192.0.2.31" })).status).toBe(401);
  });
});
