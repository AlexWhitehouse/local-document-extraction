import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
      from: { name: "Document Extraction", email: "no-reply@extract.t3m.uk" },
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
