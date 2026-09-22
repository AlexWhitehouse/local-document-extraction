import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalAuthRuntime } from "./localAuthRuntime";

test("the local auth runtime persists auth data and captured mail under the local state directory", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-local-auth-"));
  const runtime = await createLocalAuthRuntime({
    baseURL: "http://127.0.0.1:8787",
    logger: {
      error: () => undefined,
      info: () => undefined,
    },
    stateDirectory,
  });

  try {
    const response = await runtime.auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
    }));

    expect(response.status).toBe(200);
    expect((await stat(join(stateDirectory, "data", "control.sqlite"))).isFile()).toBe(true);
    expect((await stat(join(stateDirectory, "data", "control.sqlite"))).mode & 0o777).toBe(0o600);
    expect((await readFile(join(stateDirectory, "data", "better-auth-secret"), "utf8")).trim()).not.toBe("");

    const mailFile = join(stateDirectory, "mail", `${new Date().toISOString().slice(0, 10)}.jsonl`);
    await waitForFile(mailFile);
    const mailRecord = JSON.parse((await readFile(mailFile, "utf8")).trim());
    expect((await stat(mailFile)).mode & 0o777).toBe(0o600);
    expect(mailRecord).toMatchObject({
      type: "account_email_verification",
      to: "ada@example.com",
      action_url: expect.stringContaining("/api/auth/verify-email?"),
    });
  } finally {
    runtime.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("Cloudflare mode sends through the selected transport without local mail capture or action-link logging", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-cloudflare-mail-"));
  const originalFetch = globalThis.fetch;
  const logs: unknown[][] = [];
  let sends = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toContain("https://api.cloudflare.com/client/v4/accounts/");
    const body = JSON.parse(String(init?.body));
    expect(body.from).toEqual({ address: "support@example.org", name: "My App" });
    expect(body.text).toContain("/api/auth/verify-email?");
    sends += 1;
    return Response.json({ success: true, result: { delivered: [body.to], queued: [], permanent_bounces: [] } });
  }) as typeof fetch;
  let runtime: Awaited<ReturnType<typeof createLocalAuthRuntime>> | undefined;
  try {
    runtime = await createLocalAuthRuntime({
      baseURL: "http://127.0.0.1:8787", stateDirectory,
      email: { provider: "cloudflare", fromAddress: "support@example.org", fromName: "My App", cloudflareAccountId: "a".repeat(32), cloudflareApiToken: "mock-token" },
      logger: { error: (...args) => { logs.push(args); }, info: (...args) => { logs.push(args); } },
    });
    const response = await runtime.auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada", email: "ada@example.org", password: "Strong1!" }),
    }));
    expect(response.status).toBe(200);
    expect(sends).toBe(1);
    expect(await readdir(join(stateDirectory, "mail"))).toEqual([]);
    expect(logs).toEqual([]);
  } finally {
    runtime?.close();
    globalThis.fetch = originalFetch;
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("auth state refuses linked data and mail directories without changing their targets", async () => {
  for (const child of ["data", "mail"]) {
    const fixture = await mkdtemp(join(tmpdir(), "document-extraction-auth-linked-directory-"));
    const stateDirectory = join(fixture, "state");
    const outside = join(fixture, "outside");
    try {
      await mkdir(stateDirectory);
      await mkdir(outside);
      await chmod(outside, 0o755);
      await writeFile(join(outside, "sentinel"), "unchanged");
      await symlink(outside, join(stateDirectory, child));
      await expect(createLocalAuthRuntime({ baseURL: "http://127.0.0.1:8787", stateDirectory })).rejects.toThrow("real directories");
      expect((await stat(outside)).mode & 0o777).toBe(0o755);
      expect(await readdir(outside)).toEqual(["sentinel"]);
      expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("unchanged");
    } finally { await rm(fixture, { recursive: true, force: true }); }
  }
});

test("auth state refuses linked database, secret and sidecar files without reading, writing or chmodding targets", async () => {
  for (const name of ["control.sqlite", "better-auth-secret", "control.sqlite-journal", "control.sqlite-wal", "control.sqlite-shm"]) {
    const fixture = await mkdtemp(join(tmpdir(), "document-extraction-auth-linked-file-"));
    const stateDirectory = join(fixture, "state");
    const outside = join(fixture, "outside-file");
    try {
      await mkdir(join(stateDirectory, "data"), { recursive: true });
      await writeFile(outside, "unchanged external file");
      await chmod(outside, 0o644);
      await symlink(outside, join(stateDirectory, "data", name));
      await expect(createLocalAuthRuntime({ baseURL: "http://127.0.0.1:8787", stateDirectory })).rejects.toThrow("regular files");
      expect((await stat(outside)).mode & 0o777).toBe(0o644);
      expect(await readFile(outside, "utf8")).toBe("unchanged external file");
    } finally { await rm(fixture, { recursive: true, force: true }); }
  }
});

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await stat(path).then(() => true).catch(() => false)) {
      return;
    }
    await Bun.sleep(10);
  }

  throw new Error(`Timed out waiting for ${path}`);
}
