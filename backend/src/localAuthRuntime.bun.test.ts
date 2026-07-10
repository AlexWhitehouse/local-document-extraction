import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
    expect((await readFile(join(stateDirectory, "data", "better-auth-secret"), "utf8")).trim()).not.toBe("");

    const mailFile = join(stateDirectory, "mail", `${new Date().toISOString().slice(0, 10)}.jsonl`);
    await waitForFile(mailFile);
    const mailRecord = JSON.parse((await readFile(mailFile, "utf8")).trim());
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

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await stat(path).then(() => true).catch(() => false)) {
      return;
    }
    await Bun.sleep(10);
  }

  throw new Error(`Timed out waiting for ${path}`);
}
