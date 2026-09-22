import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalMailSink } from "./localMailSink";

test("the Local mail sink records transactional messages in a daily JSONL file and logs their action link", async () => {
  const directory = await mkdtemp(join(tmpdir(), "document-extraction-mail-"));
  const logLines: string[] = [];
  const logger = { info: (...args: unknown[]) => logLines.push(args.join(" ")) };
  const sink = createLocalMailSink({ directory, logger, now: () => new Date("2026-07-09T12:34:56.000Z") });

  try {
    await sink.capture({
      type: "account_email_verification",
      to: "ada@example.com",
      from: { name: "Document Extraction", email: "no-reply@example.com" },
      subject: "Verify your Document Extraction account",
      text: "Open http://127.0.0.1:8787/api/auth/verify-email?token=verification-token",
      html: "<a href=\"http://127.0.0.1:8787/api/auth/verify-email?token=verification-token\">Verify</a>",
    });

    const records = (await readFile(join(directory, "2026-07-09.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(records).toEqual([
      expect.objectContaining({
        occurred_at: "2026-07-09T12:34:56.000Z",
        type: "account_email_verification",
        to: "ada@example.com",
        subject: "Verify your Document Extraction account",
        action_url: "http://127.0.0.1:8787/api/auth/verify-email?token=verification-token",
      }),
    ]);
    expect(logLines).toEqual([
      "Local mail account_email_verification for ada@example.com: http://127.0.0.1:8787/api/auth/verify-email?token=verification-token",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("mail capture refuses linked directories and daily files without changing outside targets", async () => {
  for (const linkedDirectory of [true, false]) {
    const fixture = await mkdtemp(join(tmpdir(), "document-extraction-mail-linked-"));
    const directory = join(fixture, "mail");
    const outside = join(fixture, "outside");
    const logs: unknown[] = [];
    try {
      if (linkedDirectory) {
        await mkdir(outside);
        await chmod(outside, 0o755);
        await symlink(outside, directory);
      } else {
        await mkdir(directory);
        await writeFile(outside, "unchanged external file");
        await chmod(outside, 0o644);
        await symlink(outside, join(directory, "2026-07-09.jsonl"));
      }
      const sink = createLocalMailSink({ directory, logger: { info: (...args) => { logs.push(args); } }, now: () => new Date("2026-07-09T12:34:56Z") });
      await expect(sink.capture({ type: "account_email_verification", to: "ada@example.com", from: "no-reply@example.com", subject: "Verify", text: "https://example.com/verify?token=synthetic-test" })).rejects.toThrow("Local state");
      expect(logs).toEqual([]);
      expect((await stat(outside)).mode & 0o777).toBe(linkedDirectory ? 0o755 : 0o644);
      if (linkedDirectory) expect(await readdir(outside)).toEqual([]);
      else expect(await readFile(outside, "utf8")).toBe("unchanged external file");
    } finally { await rm(fixture, { recursive: true, force: true }); }
  }
});
